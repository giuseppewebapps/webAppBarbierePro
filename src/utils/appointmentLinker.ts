import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase'; 
import { logSystemError } from './logger';

export async function autoLinkAppointmentsByPhone(userProfile: { uid: string; displayName: string; phoneNumber?: string }) {
  // Se l'utente non ha un numero di telefono, è impossibile fare un'associazione sicura
  if (!userProfile?.phoneNumber) return;

  // Puliamo il numero da spazi o prefissi per fare un match perfetto (ultime 10 cifre)
  const cleanUserPhone = userProfile.phoneNumber.replace(/\D/g, '').slice(-10);

  if (cleanUserPhone.length < 9) return; // Sicurezza: numero troppo corto

  try {
    const q = query(
      collection(db, 'appointments'),
      where('customerId', '==', 'manual_entry'),
      where('isManual', '==', true)
    );

    const snapshot = await getDocs(q);

    const updates = snapshot.docs.map(async (document) => {
      const app = document.data();
      
      // Controlla se l'appuntamento importato ha un numero di telefono
      if (app.customer?.phoneNumber) {
        const cleanAppPhone = app.customer.phoneNumber.replace(/\D/g, '').slice(-10);
        
        // MATCH PERFETTO SUL TELEFONO
        if (cleanAppPhone === cleanUserPhone) {
          await updateDoc(doc(db, 'appointments', document.id), {
            customerId: userProfile.uid,
            'customer.phoneNumber': userProfile.phoneNumber, 
            'customer.displayName': userProfile.displayName, 
            isManual: false 
          });
          
          console.log(`✅ Appuntamento ricollegato via telefono a ${userProfile.displayName}!`);
        }
      }
    });

    await Promise.all(updates);
    
  } catch (error: any) {
    console.error("Errore riconciliazione appuntamenti:", error);
    await logSystemError({
      type: 'auto_link_phone_error',
      userId: userProfile.uid,
      userName: userProfile.displayName,
      error
    });
  }
}