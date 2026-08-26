import { collection, query, where, getDocs, doc, writeBatch, Timestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase'; 
import { logSystemError } from './logger';

export async function autoLinkAppointments(userProfile: { uid: string; displayName: string; email: string; phoneNumber?: string }) {
  // 1. Sanitizziamo i dati in ingresso
  const userEmail = userProfile.email?.trim().toLowerCase();
  const rawPhone = (userProfile.phoneNumber || '').replace(/\D/g, '');
  const cleanUserPhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.substring(2) : rawPhone.slice(-10);

  // Sicurezza: Se non abbiamo né email né un telefono valido, interrompiamo.
  if (!userEmail && cleanUserPhone.length < 9) return;

  try {
    // 2. Cerchiamo gli appuntamenti manuali
    const q = query(
      collection(db, 'appointments'),
      where('customerId', '==', 'manual_entry')
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) return;

    // Inizializziamo il Batch per fare un'unica mega-operazione sicura
    const batch = writeBatch(db);
    let matchCount = 0;

    snapshot.docs.forEach((document) => {
      const app = document.data();
      let matchFound = false;

      // CONTROLLO A: Match per Email
      if (app.customer?.email && userEmail) {
        if (app.customer.email.trim().toLowerCase() === userEmail) matchFound = true;
      }

      // CONTROLLO B: Match per Telefono 
      if (!matchFound && app.customer?.phoneNumber && cleanUserPhone.length >= 9) {
        const rawAppPhone = app.customer.phoneNumber.replace(/\D/g, '');
        const cleanAppPhone = (rawAppPhone.startsWith('39') && rawAppPhone.length > 10) ? rawAppPhone.substring(2) : rawAppPhone.slice(-10);
        if (cleanAppPhone === cleanUserPhone) {
          matchFound = true;
        }
      }

      // 3. MERGE: Prepariamo l'assegnazione
      if (matchFound) {
        batch.update(document.ref, {
          customerId: userProfile.uid,
          'customer.phoneNumber': userProfile.phoneNumber || app.customer?.phoneNumber || '', 
          'customer.displayName': userProfile.displayName, 
          'customer.email': userProfile.email,
          isManual: false 
        });
        matchCount++;
      }
    });

    // Se abbiamo trovato e collegato appuntamenti, chiudiamo il cerchio
    if (matchCount > 0) {
      // 4. PURGE: Polverizziamo il contatto ombra dalla rubrica del barbiere
      if (cleanUserPhone.length >= 9) {
        const contactRef = doc(db, 'contacts', cleanUserPhone);
        batch.delete(contactRef);
      }

      // Eseguiamo il salvataggio massivo
      await batch.commit();

      // 5. EFFETTO WOW: Inviamo la notifica al cliente
      await addDoc(collection(db, 'notifications'), {
        userId: userProfile.uid,
        title: 'Appuntamenti Sincronizzati 💈',
        message: `Abbiamo trovato ${matchCount} appuntamento/i fissato dal barbiere e lo abbiamo collegato al tuo account!`,
        type: 'booking',
        read: false,
        createdAt: Timestamp.now()
      });
      
      console.log(`✅ [Merge & Purge] Completato! Assegnati ${matchCount} appuntamenti a ${userProfile.displayName}.`);
    }
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