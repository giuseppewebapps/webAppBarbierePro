import { collection, doc, setDoc, deleteDoc, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { logSystemError } from './logger';

/**
 * ============================================================================
 *  busyBlocks — indice SANIFICATO degli orari occupati (Fase 1b)
 * ============================================================================
 *
 * Problema: per calcolare gli slot liberi il cliente deve conoscere SOLO gli
 * orari occupati, ma oggi e costretto a leggere l intera collezione
 * `appointments` (nomi, telefoni, email dei clienti = dati personali).
 *
 * Soluzione: `salons/{tenantId}/busyBlocks/{appointmentId}`, un documento per
 * ogni appuntamento ATTIVO con i soli campi necessari a calcolare gli slot:
 *
 *   staffId        uid del barbiere (o null = qualsiasi operatore)
 *   start / end    Timestamp inizio/fine
 *   nominalMinutes durata nominale dei servizi (serve al motore slot per capire
 *                  se l appuntamento e stato "compresso" dal barbiere)
 *   updatedAt      Timestamp di ultimo aggiornamento
 *
 * Regole di coerenza:
 *  - il documento ha lo STESSO id dell appuntamento (idempotente, niente orfani)
 *  - esiste SOLO per gli appuntamenti attivi: alla cancellazione viene eliminato
 *    (cosi le query restano a campo singolo, senza indici compositi)
 *  - nessun dato personale: niente nome, telefono, email, note o importi
 *
 * L ordine di attivazione in produzione e: 1) dual-write (scrittura sia su
 * appointments sia su busyBlocks), 2) backfill degli appuntamenti esistenti,
 * 3) passaggio delle letture del cliente su busyBlocks.
 */

export interface BusyBlockSource {
  staffId?: string | null;
  startTime?: any; // Timestamp
  endTime?: any; // Timestamp
  services?: Array<{ duration?: number } | null> | null;
  status?: string;
}

function blocksCollection(tenantId: string) {
  return collection(db, 'salons', tenantId, 'busyBlocks');
}

function nominalMinutesOf(src: BusyBlockSource): number {
  const services = Array.isArray(src.services) ? src.services : [];
  return services.reduce((acc, s) => acc + (Number(s?.duration) || 0), 0);
}

/**
 * Crea o aggiorna il blocco di occupazione di un appuntamento.
 * Se l appuntamento non occupa piu tempo (cancellato o senza orari) elimina il blocco.
 * Non solleva mai eccezioni: un errore qui non deve far fallire la prenotazione.
 */
export async function syncBusyBlock(tenantId: string, appointmentId: string, src: BusyBlockSource): Promise<void> {
  if (!tenantId || !appointmentId) return;

  try {
    if (!src || src.status === 'cancelled' || !src.startTime || !src.endTime) {
      await removeBusyBlock(tenantId, appointmentId);
      return;
    }

    await setDoc(doc(db, 'salons', tenantId, 'busyBlocks', appointmentId), {
      staffId: src.staffId || null,
      start: src.startTime,
      end: src.endTime,
      nominalMinutes: nominalMinutesOf(src),
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Errore syncBusyBlock:', error);
    await logSystemError({ type: 'busy_block_sync_failure', tenantId, error });
  }
}

/** Elimina il blocco (appuntamento cancellato o eliminato). */
export async function removeBusyBlock(tenantId: string, appointmentId: string): Promise<void> {
  if (!tenantId || !appointmentId) return;

  try {
    await deleteDoc(doc(db, 'salons', tenantId, 'busyBlocks', appointmentId));
  } catch (error) {
    console.error('Errore removeBusyBlock:', error);
    await logSystemError({ type: 'busy_block_sync_failure', tenantId, error });
  }
}

/**
 * Converte i blocchi nella forma attesa dal motore slot (`rawAppointments`):
 * il motore legge startTime/endTime/services/staffId, quindi ricostruiamo
 * services con la sola durata nominale per preservare il calcolo di isCompressed.
 */
function toEngineRange(id: string, data: any) {
  const nominalMinutes = Number(data?.nominalMinutes) || 0;
  return {
    id,
    staffId: data?.staffId || null,
    startTime: data?.start,
    endTime: data?.end,
    services: nominalMinutes ? [{ id: 'busy', duration: nominalMinutes, flexibility: 0 }] : [],
    status: 'booked',
  };
}

/**
 * Blocchi di occupazione compresi in un intervallo, gia pronti per il motore slot.
 * Query a campo singolo su `start` (indice automatico, nessun indice composito).
 */
export async function fetchBusyBlocks(tenantId: string, from: Date, to: Date): Promise<any[]> {
  const q = query(
    blocksCollection(tenantId),
    where('start', '>=', Timestamp.fromDate(from)),
    where('start', '<=', Timestamp.fromDate(to))
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toEngineRange(d.id, d.data()));
}
