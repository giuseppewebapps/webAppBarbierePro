import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export async function logSystemError(params: {
  type: string;
  userId?: string;
  userName?: string;
  error: any;
}) {
  try {
    await addDoc(collection(db, 'system_logs'), {
      type: params.type,
      userId: params.userId || 'anonimo',
      userName: params.userName || 'Sconosciuto',
      errorMessage: params.error?.message || String(params.error),
      timestamp: Timestamp.now(),
      resolved: false
    });
    console.log("📝 Errore registrato nella Scatola Nera!");
  } catch (e) {
    console.warn("Impossibile inviare il log a Firestore:", e);
  }
}