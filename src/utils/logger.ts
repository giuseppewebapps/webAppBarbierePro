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