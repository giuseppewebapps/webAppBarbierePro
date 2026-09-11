import { collection, query, where, getDocs, doc, writeBatch, Timestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase'; 
import { logSystemError } from './logger';

export async function autoLinkAppointments(
  userProfile: { uid: string; displayName: string; email: string; phoneNumber?: string },
  tenantId: string 
) {
  const userEmail = userProfile.email?.trim().toLowerCase();
  const rawPhone = (userProfile.phoneNumber || '').replace(/\D/g, '');
  const cleanUserPhone = (rawPhone.startsWith('39') && rawPhone.length > 10) ? rawPhone.substring(2) : rawPhone.slice(-10);

  if (!userEmail && cleanUserPhone.length < 9) return;

  try {
    const q = query(
      collection(db, 'salons', tenantId, 'appointments'),
      where('customerId', '==', 'manual_entry')
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) return;

    const batch = writeBatch(db);
    let matchCount = 0;

    snapshot.docs.forEach((document) => {
      const app = document.data();
      let matchFound = false;

      if (app.customer?.email && userEmail) {
        if (app.customer.email.trim().toLowerCase() === userEmail) matchFound = true;
      }

      if (!matchFound && app.customer?.phoneNumber && cleanUserPhone.length >= 9) {
        const rawAppPhone = app.customer.phoneNumber.replace(/\D/g, '');
        const cleanAppPhone = (rawAppPhone.startsWith('39') && rawAppPhone.length > 10) ? rawAppPhone.substring(2) : rawAppPhone.slice(-10);
        if (cleanAppPhone === cleanUserPhone) {
          matchFound = true;
        }
      }

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

    if (matchCount > 0) {
      // 🚀 Purge mirato: eliminiamo il contatto ombra SOLO dalla rubrica di questo specifico barbiere
      if (cleanUserPhone.length >= 9) {
        const contactRef = doc(db, 'salons', tenantId, 'contacts', cleanUserPhone);
        batch.delete(contactRef);
      }

      await batch.commit();

      // 🚀 Notifica confinata al salone
      await addDoc(collection(db, 'salons', tenantId, 'notifications'), {
        userId: userProfile.uid,
        title: 'Appuntamenti Sincronizzati 💈',
        message: `Abbiamo trovato ${matchCount} appuntamento/i fissato dal barbiere e lo abbiamo collegato al tuo account!`,
        type: 'booking',
        read: false,
        createdAt: Timestamp.now()
      });
      
      console.log(`✅ [Merge & Purge] Completato! Assegnati ${matchCount} appuntamenti a ${userProfile.displayName} nel salone ${tenantId}.`);
    }
  } catch (error: any) {
    console.error("Errore riconciliazione appuntamenti:", error);
    await logSystemError({
      type: 'auto_link_error',
      userId: userProfile.uid,
      userName: userProfile.displayName,
      tenantId,
      error
    });
  }
}