import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase'; 
import { logSystemError } from './logger';

// Passiamo anche l'email per abilitare il doppio controllo
export async function autoLinkAppointments(userProfile: { uid: string; displayName: string; email: string; phoneNumber?: string }) {
  // 1. Sanitizziamo i dati in ingresso per un match perfetto
  const userEmail = userProfile.email?.trim().toLowerCase();
  const cleanUserPhone = userProfile.phoneNumber ? userProfile.phoneNumber.replace(/\D/g, '').slice(-10) : '';

  // Sicurezza: Se non abbiamo né email né un telefono valido, interrompiamo.
  if (!userEmail && cleanUserPhone.length < 9) return;

  try {
    // 2. Cerchiamo gli appuntamenti "orfani" (importati da Calendar o inseriti a mano)
    const q = query(
      collection(db, 'appointments'),
      where('customerId', '==', 'manual_entry'),
      where('isManual', '==', true)
    );

    const snapshot = await getDocs(q);

    const updates = snapshot.docs.map(async (document) => {
      const app = document.data();
      let matchFound = false;

      // CONTROLLO A: Match per Email
      if (app.customer?.email) {
        const appEmail = app.customer.email.trim().toLowerCase();
        if (userEmail && appEmail === userEmail) {
          matchFound = true;
        }
      }

      // CONTROLLO B: Match per Telefono (se l'email non ha già fatto centro)
      if (!matchFound && app.customer?.phoneNumber && cleanUserPhone.length >= 9) {
        const cleanAppPhone = app.customer.phoneNumber.replace(/\D/g, '').slice(-10);
        if (cleanAppPhone === cleanUserPhone) {
          matchFound = true;
        }
      }

      // 3. Se troviamo una corrispondenza, ASSEGNIAMO L'APPUNTAMENTO AL CLIENTE
      if (matchFound) {
        await updateDoc(doc(db, 'appointments', document.id), {
          customerId: userProfile.uid,
          // Allineiamo i dati con il profilo ufficiale del cliente
          'customer.phoneNumber': userProfile.phoneNumber || app.customer?.phoneNumber || '', 
          'customer.displayName': userProfile.displayName, 
          'customer.email': userProfile.email,
          isManual: false 
        });
        
        console.log(`✅ Appuntamento orfano assegnato con successo a ${userProfile.displayName}!`);
      }
    });

    await Promise.all(updates);
    
  } catch (error: any) {
    console.error("Errore riconciliazione appuntamenti:", error);
    await logSystemError({
      type: 'auto_link_error',
      userId: userProfile.uid,
      userName: userProfile.displayName,
      error
    });
  }
}