import { collection, query, where, getDocs, updateDoc, doc, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase'; 

export async function autoLinkAppointments(userProfile: { uid: string; displayName: string; phoneNumber?: string }) {
  if (!userProfile?.displayName || !userProfile?.phoneNumber) return;

  try {
    // 1. Cerca tutti gli appuntamenti manuali o importati
    const q = query(
      collection(db, 'appointments'),
      where('customerId', '==', 'manual_entry'),
      where('isManual', '==', true)
    );

    const snapshot = await getDocs(q);

    // 2. Controlla e aggiorna
    const updates = snapshot.docs.map(async (document) => {
      const app = document.data();
      
      const appName = (app.customer?.displayName || '').toLowerCase().trim();
      const registeredName = userProfile.displayName.toLowerCase().trim();

      if (appName === registeredName || registeredName.includes(appName) || appName.includes(registeredName)) {
        await updateDoc(doc(db, 'appointments', document.id), {
          customerId: userProfile.uid,
          'customer.phoneNumber': userProfile.phoneNumber, 
          'customer.displayName': userProfile.displayName, 
          isManual: false 
        });
        
        console.log(`✅ Appuntamento orfano ricollegato con successo a ${userProfile.displayName}!`);
      }
    });

    await Promise.all(updates);
    
  } catch (error: any) {
    // IL CLIENTE NON VEDE NULLA, MA NOI REGISTRIAMO TUTTO
    console.error("Errore durante la riconciliazione degli appuntamenti:", error);
    
    // -- NUOVO: SCATOLA NERA (ERROR LOGGING) --
    try {
      await addDoc(collection(db, 'system_logs'), {
        type: 'auto_link_error',
        userId: userProfile.uid,
        userName: userProfile.displayName,
        errorMessage: error.message || String(error),
        timestamp: Timestamp.now(),
        resolved: false
      });
    } catch (logError) {
      // Se fallisce anche il salvataggio del log, non possiamo fare altro dal client
      console.warn("Impossibile salvare il log di errore in Firestore", logError);
    }
  }
}