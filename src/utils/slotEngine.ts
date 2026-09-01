import { addMinutes, isBefore, isAfter, isSameWeek } from 'date-fns';
import { YIELD_CONFIG } from '../constants';
/**
 * ============================================================================
 * MOTORE DI YIELD MANAGEMENT & SCHEDULING (Slot Engine)
 * ============================================================================
 * 
 * Questo algoritmo puro (senza dipendenze esterne) calcola gli orari disponibili 
 * bilanciando la massima saturazione dell'agenda (profitti) con la sostenibilità 
 * del carico di lavoro del salone.
 * 
 * LE 6 REGOLE ARCHITETTURALI:
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
  shift: Shift
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

        const slotEnd = addMinutes(slotStart, dur);
        const L_rem_before = (slotStart.getTime() - window.start.getTime()) / 60000;
        const L_rem_after = (window.end.getTime() - slotEnd.getTime()) / 60000;

        // LA REGOLA ANTI-BURNOUT
        const isCompressing = dur < D_req;
        if (isCompressing) {
          const touchesPrev = slotStart.getTime() === window.start.getTime();
          const touchesNext = slotEnd.getTime() === window.end.getTime();
          
          if ((touchesPrev && window.prevCompressed) || (touchesNext && window.nextCompressed)) {
            continue; 
          }
        }

       // FILTRO ANTI-BUCO DINAMICO
        const minGapAllowed = window.length > 120 ? 30 : M_min;

        if ((L_rem_before > 0 && L_rem_before < minGapAllowed) || (L_rem_after > 0 && L_rem_after < minGapAllowed)) {
          continue; 
        }

        // Regola Micro-Servizi
        if (D_req < 30) {
          const isAtShiftStart = slotStart.getTime() === shift.start.getTime();
          const isAtShiftEnd = slotEnd.getTime() === shift.end.getTime();
          if (!isAtShiftStart && !isAtShiftEnd) continue;
        } else {
          // Regola Scudo
          let shieldActivated = false;
          for (const s_higher of catalog) {
            const D_min_higher = s_higher.duration - s_higher.flexibility;
            if (window.length >= D_min_higher && D_min_req < D_min_higher) {
              const destroysBefore = L_rem_before > 0 && L_rem_before < D_min_higher;
              const destroysAfter = L_rem_after > 0 && L_rem_after < D_min_higher;
              
              if (destroysBefore || destroysAfter) {
                // 🚀 IBRIDO: Settimana in Corso + Soglia di Saturazione
                const now = new Date();
                const saturation = D_req / window.length;
                
                // Verifica se lo slot cade nella stessa settimana solare di oggi (inizia di Lunedì)
                const isUrgent = YIELD_CONFIG.URGENCY_CURRENT_WEEK 
                  ? isSameWeek(slotStart, now, { weekStartsOn: 1 })
                  : false;

                const isHighlySaturated = saturation >= YIELD_CONFIG.MIN_SATURATION_RATE;

                // Se l'appuntamento è in questa settimana E satura gran parte del buco, IGNORA LO SCUDO
                if (isUrgent && isHighlySaturated) {
                  continue; 
                }

                shieldActivated = true;
                break;
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