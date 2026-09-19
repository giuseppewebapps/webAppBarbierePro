import { addHours, isAfter, isBefore } from 'date-fns';

/**
 * Minuti dell'appuntamento effettivamente visibili nella riga oraria che inizia a `rowStart`.
 * (Es. appuntamento 08:50-09:50 nella riga 08:00 -> 10 minuti)
 */
export function getVisiblePortion(appStart: Date, appEnd: Date, rowStart: Date): number {
  const rowEnd = addHours(rowStart, 1);
  const start = isBefore(appStart, rowStart) ? rowStart : appStart;
  const end = isAfter(appEnd, rowEnd) ? rowEnd : appEnd;
  return Math.max(0, (end.getTime() - start.getTime()) / 60000);
}

/**
 * 🚀 CARD LEGGIBILE: inizio della riga oraria dove disegnare la CARD COMPLETA.
 * Regola: la card sta dove l'appuntamento ha la porzione visibile maggiore, così
 * un appuntamento che parte a fine ora (es. 08:50-09:50) non viene schiacciato a
 * 10 minuti ma si legge nella riga dove ha più spazio (09:00), mentre la riga
 * precedente mostra il box compatto "INIZIO SERVIZIO HH:mm".
 *
 * - `currentRowStart`: riga in corso; la griglia procede a passi di 1 ora, quindi
 *   risalgo a ritroso fino alla riga di partenza senza assumere l'allineamento all'ora.
 * - `isRowBreak`: riga da NON eleggere (es. PAUSA SALONE, dove le card non vengono
 *   renderizzate affatto) così la card non può "sparire".
 */
export function getCardRowStart(
  appStart: Date,
  appEnd: Date,
  currentRowStart: Date,
  isRowBreak: (rowStart: Date) => boolean = () => false
): Date {
  let rowStart = currentRowStart;
  while (isBefore(appStart, rowStart)) rowStart = addHours(rowStart, -1); // riga di partenza

  let best = rowStart;
  let bestPortion = -1;
  while (isBefore(rowStart, appEnd)) {
    const portion = getVisiblePortion(appStart, appEnd, rowStart);
    if (portion > bestPortion && !isRowBreak(rowStart)) {
      bestPortion = portion;
      best = rowStart;
    }
    rowStart = addHours(rowStart, 1);
  }
  return best;
}
