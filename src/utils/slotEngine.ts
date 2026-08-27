import { addMinutes, isBefore, isAfter } from 'date-fns';

export interface Service {
  id: string;
  duration: number;
  flexibility: number;
}

export interface AppointmentRange {
  start: Date;
  end: Date;
  isCompressed?: boolean; // 🚀 NUOVO PARAMETRO ANTI-BURNOUT
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
      isCompressed: app.isCompressed // Passiamo lo stato
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

        // 🚀 LA REGOLA ANTI-BURNOUT
        const isCompressing = dur < D_req;
        if (isCompressing) {
          const touchesPrev = slotStart.getTime() === window.start.getTime();
          const touchesNext = slotEnd.getTime() === window.end.getTime();
          
          if ((touchesPrev && window.prevCompressed) || (touchesNext && window.nextCompressed)) {
            // Se cerchiamo di applicare un "Flex" ma l'appuntamento toccato è GIÀ un Flex, lo vietiamo.
            continue; 
          }
        }

        // Filtro Anti-Micro-Buco
        if ((L_rem_before > 0 && L_rem_before < M_min) || (L_rem_after > 0 && L_rem_after < M_min)) {
          continue; 
        }

        // Regola Custom: Servizi < 30 min ai poli
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