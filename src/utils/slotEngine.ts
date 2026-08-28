import { addMinutes, isBefore, isAfter } from 'date-fns';

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
 *    Questo evita che un appuntamento pomeridiano falsi il calcolo di una finestra mattutina.
 * 
 * 2. COMPRESSIONE PROATTIVA (Elasticità)
 *    Il motore tenta di incastrare il servizio usando la sua Durata Nominale. Se fallisce 
 *    (per colpa dello Scudo o dei Buchi), ritenta immediatamente nella stessa esecuzione 
 *    usando la Durata Compressa (Nominale - Flessibilità).
 * 
 * 3. ANTI-BURNOUT (Tutela Operativa)
 *    L'algoritmo non permette la concatenazione di due servizi compressi ("affannati").
 *    Se si tenta di comprimere un appuntamento, si verifica se tocca un appuntamento già 
 *    compresso. In tal caso, la flessibilità viene vietata e si usa la durata standard.
 * 
 * 4. FILTRO ANTI-BUCO DINAMICO (Grid Snapping)
 *    - In grandi spazi (> 120 min): Il sistema vieta la creazione di buchi inferiori a 30 min.
 *    - In spazi frammentati (<= 120 min): Il sistema allenta la presa e accetta incastri 
 *      fino al limite minimo consentito dal catalogo (M_min, es. 15 min).
 * 
 * 5. REGOLA DEI MICRO-SERVIZI (Tappi)
 *    Qualsiasi servizio inferiore ai 30 minuti nominali (es. Solo Barba) è forzato ad 
 *    ancorarsi ESCLUSIVAMENTE all'apertura o alla chiusura esatta del turno, agendo da 
 *    tappo per non sfilacciare il centro della giornata.
 * 
 * 6. SCUDO DI PRIORITÀ (Costo Opportunità)
 *    Analizza il residuo (L_rem) che avanza dopo aver piazzato un appuntamento. Se quel 
 *    residuo è "tossico" (cioè distrugge lo spazio vitale per un servizio Premium che 
 *    prima ci stava perfettamente), lo slot viene scartato per proteggere gli incassi.
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