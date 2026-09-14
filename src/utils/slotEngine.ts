import { addMinutes, isBefore, isAfter, isSameWeek } from 'date-fns';
import { YieldConfig, StaffProfile, Service as AppService } from '../types';

/**
 * ============================================================================
 * MOTORE DI YIELD MANAGEMENT & SCHEDULING (Slot Engine)
 * ============================================================================
 * 
 * Questo algoritmo puro (senza dipendenze esterne) calcola gli orari disponibili 
 * bilanciando la massima saturazione dell'agenda (profitti) con la sostenibilità 
 * del carico di lavoro del salone.
 * 
 * LE 7 REGOLE ARCHITETTURALI:
 * 
 * 1. CLAMPING (Isolamento Turni)
 *    Gli appuntamenti vengono "tagliati" ai bordi del turno che si sta calcolando. 
 *    Questo evita che un appuntamento esterno (es. pomeridiano) falsi il calcolo 
 *    di una finestra interna (es. mattutina).
 * 
 * 2. COMPRESSIONE PROATTIVA (Elasticità)
 *    Il motore tenta di incastrare il servizio usando la sua Durata Nominale. Se fallisce 
 *    (per colpa dello Scudo o della frammentazione), ritenta immediatamente nella stessa 
 *    esecuzione usando la Durata Compressa (Nominale - Flessibilità).
 * 
 * 3. ANTI-BURNOUT (Tutela Operativa)
 *    L'algoritmo non permette la concatenazione di due servizi compressi ("affannati").
 *    Se si tenta di comprimere un appuntamento, si verifica se questo toccherà un appuntamento 
 *    già compresso ai suoi bordi. In tal caso, la flessibilità viene vietata per garantire respiro.
 * 
 * 4. FILTRO ANTI-BUCO DINAMICO (Grid Snapping)
 *    - In grandi spazi (> 120 min): Il sistema vieta rigorosamente la creazione di buchi 
 *      inferiori a 30 minuti per mantenere intatta la griglia.
 *    - In spazi frammentati (<= 120 min): Il sistema allenta la presa e accetta incastri 
 *      che generano buchi fino al limite minimo fisiologico consentito dal listino (es. 15 min).
 * 
 * 5. REGOLA DEI MICRO-SERVIZI (Tappi)
 *    Qualsiasi servizio "corto" (es. durata inferiore ai 30 minuti) è costretto ad 
 *    ancorarsi ESCLUSIVAMENTE all'apertura o alla chiusura di un turno libero. 
 *    Questo impedisce che piccoli servizi sfilaccino il centro produttivo della giornata.
 * 
 * 6. SCUDO DI PRIORITÀ IBRIDO (Costo Opportunità + Yield Management)
 *    Il motore analizza il residuo di tempo generato dall'inserimento di uno slot. 
 *    Se quel residuo "distrugge" lo spazio vitale per un servizio Premium che 
 *    inizialmente ci stava perfettamente (es. inserire un 45 min in un buco da 60), 
 *    lo slot viene scartato per proteggere gli incassi futuri.
 *    ECCEZIONE DINAMICA: Lo Scudo si abbassa automaticamente se si verificano due condizioni:
 *    A) Urgenza: L'appuntamento cade nella settimana solare in corso.
 *    B) Saturazione: Il servizio richiesto copre un'alta percentuale dello spazio 
 *       disponibile (es. >= 75%). 
 *    Questo garantisce agende blindate sul lungo periodo, ma flessibili a ridosso della scadenza.
 * 
 * 7. AGGREGAZIONE MULTI-POSTAZIONE (Concorrenza & Load Balancing)
 *    Se l'utente non seleziona un barbiere specifico, l'engine scala su una matrice n-dimensionale:
 *    - Skill Matching: Filtra a monte i barbieri che non sanno eseguire i servizi richiesti.
 *    - Priority Fill: Ordina i barbieri idonei per priorità (es. Apprendista prima del Boss) 
 *      per ottimizzare la saturazione del team e liberare i senior.
 *    - Legacy Fallback: Protezione retroattiva. Se un appuntamento storico non ha 'staffId', 
 *      viene considerato un blocco globale e disabilita tutti i barbieri per quella frazione.
 *    - Short-Circuiting: Restituisce un singolo slot univoco alla UI appena trova il primo 
 *      barbiere libero, evitando di renderizzare slot duplicati al cliente.
 * ============================================================================
 */

export interface Service {
  id: string;
  duration: number;
  flexibility: number;
}

export interface AppointmentRange {
  start: Date;
  end: Date;
  isCompressed?: boolean; 
}

export interface Shift {
  start: Date;
  end: Date;
}

export function calculateOptimalSlots(
  requestedService: Service,
  catalog: Service[],
  appointments: AppointmentRange[],
  shift: Shift,
  yieldConfig: YieldConfig, 
  isManualBooking: boolean = false,
  allowEverySlot: boolean = false 
): Date[] {
  const validSlots: Date[] = [];
  
  const M_min = Math.min(...catalog.map(s => s.duration - s.flexibility));
  const D_req = requestedService.duration;
  const D_min_req = requestedService.duration - requestedService.flexibility;

  // 1. Clamping degli appuntamenti
  const shiftApps = appointments
    .filter(app => isBefore(app.start, shift.end) && isAfter(app.end, shift.start))
    .map(app => ({
      start: isBefore(app.start, shift.start) ? shift.start : app.start,
      end: isAfter(app.end, shift.end) ? shift.end : app.end,
      isCompressed: app.isCompressed 
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // 2. Identificazione Finestre Libere (W) e tracciamento dello "stress" ai bordi
  const freeWindows: { start: Date; end: Date; length: number; prevCompressed: boolean; nextCompressed: boolean }[] = [];
  let currentMarker = shift.start;
  let prevWasCompressed = false;

  for (const app of shiftApps) {
    if (isBefore(currentMarker, app.start)) {
      const lengthMins = (app.start.getTime() - currentMarker.getTime()) / 60000;
      freeWindows.push({ 
        start: currentMarker, 
        end: app.start, 
        length: lengthMins,
        prevCompressed: prevWasCompressed,
        nextCompressed: app.isCompressed || false
      });
    }
    if (isAfter(app.end, currentMarker)) {
      currentMarker = app.end;
      prevWasCompressed = app.isCompressed || false;
    }
  }

  if (isBefore(currentMarker, shift.end)) {
    const lengthMins = (shift.end.getTime() - currentMarker.getTime()) / 60000;
    freeWindows.push({ 
      start: currentMarker, 
      end: shift.end, 
      length: lengthMins,
      prevCompressed: prevWasCompressed,
      nextCompressed: false
    });
  }

  // 3. Analisi e Iterazione
  for (const window of freeWindows) {
    if (window.length < D_min_req) continue;

    let slotStart = window.start;
    const windowEnd = window.end;

    while (!isAfter(addMinutes(slotStart, D_min_req), windowEnd)) {
      let approved_D_eff = null;
      const durationsToTry = D_req === D_min_req ? [D_req] : [D_req, D_min_req];

      for (const dur of durationsToTry) {
        if (isAfter(addMinutes(slotStart, dur), windowEnd)) continue;

        if (isManualBooking) {
          approved_D_eff = dur;
          break;
        }

        // 🔧 Barbiere dedicato a servizi brevi (≤ 30 min): ogni fascia oraria è valida
        if (allowEverySlot) {
          approved_D_eff = dur;
          break;
        }

        const slotEnd = addMinutes(slotStart, dur);
        const L_rem_before = (slotStart.getTime() - window.start.getTime()) / 60000;
        const L_rem_after = (window.end.getTime() - slotEnd.getTime()) / 60000;

        const isCompressing = dur < D_req;
        if (isCompressing) {
          const touchesPrev = slotStart.getTime() === window.start.getTime();
          const touchesNext = slotEnd.getTime() === window.end.getTime();
          
          if ((touchesPrev && window.prevCompressed) || (touchesNext && window.nextCompressed)) {
            continue; 
          }
        }

        const minGapAllowed = window.length > 120 ? 30 : M_min;

        if ((L_rem_before > 0 && L_rem_before < minGapAllowed) || (L_rem_after > 0 && L_rem_after < minGapAllowed)) {
          continue; 
        }

        if (D_req < 30) {
          const isAtShiftStart = slotStart.getTime() === shift.start.getTime();
          const isAtShiftEnd = slotEnd.getTime() === shift.end.getTime();
          if (!isAtShiftStart && !isAtShiftEnd) continue;
        } else {
          let shieldActivated = false;
          
          if (D_req <= 30) {
            for (const s_higher of catalog) {
              const D_min_higher = s_higher.duration - s_higher.flexibility;
              if (window.length >= D_min_higher && D_min_req < D_min_higher) {
                const destroysBefore = L_rem_before > 0 && L_rem_before < D_min_higher;
                const destroysAfter = L_rem_after > 0 && L_rem_after < D_min_higher;
                
                if (destroysBefore || destroysAfter) {
                  const now = new Date();
                  const saturation = D_req / window.length;
                  
                  const isUrgent = yieldConfig.URGENCY_CURRENT_WEEK 
                    ? isSameWeek(slotStart, now, { weekStartsOn: 1 })
                    : false;

                  const isHighlySaturated = saturation >= yieldConfig.MIN_SATURATION_RATE;

                  if (isUrgent && isHighlySaturated) {
                    continue; 
                  }

                  shieldActivated = true;
                  break;
                }
              }
            }
          }
          
          if (shieldActivated) continue; 
        }

        approved_D_eff = dur;
        break; 
      }

      if (approved_D_eff !== null) {
        validSlots.push(new Date(slotStart));
      }

      slotStart = addMinutes(slotStart, 15);
    }
  }

  const uniqueSlots = Array.from(new Set(validSlots.map(d => d.getTime()))).map(t => new Date(t));
  return uniqueSlots.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * ============================================================================
 * AGGREGATORE MULTI-POSTAZIONE E PRIORITÀ
 * ============================================================================
 */
export function calculateMultiStaffSlots(
  requestedServices: AppService[],
  catalog: AppService[],
  rawAppointments: any[], 
  staffMembers: StaffProfile[],
  selectedStaffId: string | null,
  shift: Shift,
  yieldConfig: YieldConfig,
  isManualBooking: boolean = false
): Date[] {
  const D_req = requestedServices.reduce((acc, s) => acc + s.duration, 0);
  const flex_req = requestedServices.reduce((acc, s) => acc + (s.flexibility || 0), 0);
  const requestedCombo = { id: 'combo', duration: D_req, flexibility: flex_req };

  // 🚀 FALLBACK MONO-POSTAZIONE (Retrocompatibilità Antiproiettile)
  // Se il salone non ha lo staff attivo o non ha dipendenti, calcola per il salone intero.
  if (!staffMembers || staffMembers.length === 0) {
    const legacyAppointments = rawAppointments.map(app => {
      const actualDuration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / 60000;
      const nominalDuration = (app.services || []).reduce((acc: number, s: any) => acc + s.duration, 0);
      return {
        start: app.startTime.toDate(),
        end: app.endTime.toDate(),
        isCompressed: actualDuration < nominalDuration
      };
    });
    return calculateOptimalSlots(requestedCombo, catalog, legacyAppointments, shift, yieldConfig, isManualBooking);
  }

  // --- INIZIO LOGICA MULTI-POSTAZIONE ---
  let eligibleStaff = staffMembers.filter(staff => staff.active);

  if (selectedStaffId) {
    eligibleStaff = eligibleStaff.filter(s => s.uid === selectedStaffId);
  } else {
    const requestedIds = requestedServices.map(s => s.id);
    eligibleStaff = eligibleStaff.filter(staff => 
      requestedIds.every(id => staff.assignedServices.includes(id))
    );
  }

  eligibleStaff.sort((a, b) => a.order - b.order);

  const allAvailableSlots = new Map<number, Date>();

  for (const staff of eligibleStaff) {
    const staffAppointments = rawAppointments.filter(app => 
      app.staffId === staff.uid || !app.staffId
    ).map(app => {
      const actualDuration = (app.endTime.toDate().getTime() - app.startTime.toDate().getTime()) / 60000;
      const nominalDuration = (app.services || []).reduce((acc: number, s: any) => acc + s.duration, 0);
      return {
        start: app.startTime.toDate(),
        end: app.endTime.toDate(),
        isCompressed: actualDuration < nominalDuration
      };
    });

    // 🔧 Se il barbiere fa SOLO servizi brevi (≤ 30 min), rende disponibili tutti gli orari
    const staffAllShort = (Array.isArray(staff.assignedServices) && staff.assignedServices.length > 0) &&
      staff.assignedServices.every(id => {
        const s = catalog.find(c => c.id === id);
        return !!s && s.duration <= 30;
      });

    const staffSlots = calculateOptimalSlots(
      requestedCombo,
      catalog,
      staffAppointments,
      shift,
      yieldConfig,
      isManualBooking,
      staffAllShort
    );

    for (const slot of staffSlots) {
      const timeKey = slot.getTime();
      if (!allAvailableSlots.has(timeKey)) {
        allAvailableSlots.set(timeKey, slot);
      }
    }
  }

  return Array.from(allAvailableSlots.values()).sort((a, b) => a.getTime() - b.getTime());
}