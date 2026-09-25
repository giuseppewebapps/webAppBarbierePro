import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export async function logSystemError(params: {
  type: string;
  userId?: string;
  userName?: string;
  tenantId?: string; // 🚀 Fondamentale nel SaaS per rintracciare il salone
  error: any;
}) {
  try {
    await addDoc(collection(db, 'system_logs'), {
      type: params.type,
      tenantId: params.tenantId || 'global', // 🚀 Etichetta del salone
      userId: params.userId || 'anonimo',
      userName: params.userName || 'Sconosciuto',
      errorMessage: params.error?.message || String(params.error),
      timestamp: Timestamp.now(),
      resolved: false
    });
    console.log(`📝 Errore registrato nella Scatola Nera! (Salone: ${params.tenantId || 'global'})`);
  } catch (e) {
    console.warn("Impossibile inviare il log a Firestore:", e);
  }
}

/**
 * Errori di PERMESSO delle regole Firestore.
 *
 * Perche serve: gli errori di regole finiscono solo nella console del browser,
 * quindi da remoto non si sa se un dispositivo sta sbattendo contro le regole.
 * Qui li marchiamo e li mandiamo in `system_logs`, cosi `migrations/checkLogs.cjs`
 * diventa il cruscotto "tutti i dispositivi funzionano?".
 *
 * Anti-rumore: solo errori di permesso, massimo 10 segnalazioni per sessione.
 */
const PERMISSION_CODES = ['permission-denied', 'firestore/permission-denied', 'storage/unauthorized'];
let permessiSegnalati = 0;

export function isPermissionError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  if (e.code && PERMISSION_CODES.indexOf(e.code) !== -1) return true;
  const msg = String(e.message || error).toLowerCase();
  return msg.indexOf('permission') !== -1 || msg.indexOf('insufficient permissions') !== -1 || msg.indexOf('permessi negati') !== -1;
}

export async function logPermissionDenied(tenantId: string | undefined, error: unknown, context?: string) {
  if (!isPermissionError(error)) return;
  if (permessiSegnalati >= 10) return;
  permessiSegnalati++;
  const e = error as { message?: string };
  await logSystemError({
    type: 'permission_denied',
    tenantId,
    error: new Error((context ? context + ' -- ' : '') + String(e?.message || error).slice(0, 300)),
  });
}
