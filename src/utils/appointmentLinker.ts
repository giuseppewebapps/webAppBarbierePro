import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase'; // Assicurati che il percorso sia corretto

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
      
      // Normalizziamo i nomi per il confronto (tutto minuscolo, senza spazi extra)
      const appName = (app.customer?.displayName || '').toLowerCase().trim();
      const registeredName = userProfile.displayName.toLowerCase().trim();

      // LOGICA DI MATCHING: 
      // Se il nome è identico (es. "Aldo Lops" == "aldo lops") 
      // OPPURE se il nome registrato contiene quello segnato dal barbiere (es. "Gialluisi" è contenuto in "Marco Gialluisi")
      if (appName === registeredName || registeredName.includes(appName) || appName.includes(registeredName)) {
        
        // BOOM! Colleghiamo l'appuntamento al vero utente!
        await updateDoc(doc(db, 'appointments', document.id), {
          customerId: userProfile.uid,
          'customer.phoneNumber': userProfile.phoneNumber, // Inietta il vero numero per WhatsApp!
          'customer.displayName': userProfile.displayName, // Sostituisce eventuali soprannomi con il nome reale
          isManual: false // Lo trasforma in un appuntamento digitale al 100%
        });
        
        console.log(`✅ Appuntamento orfano ricollegato con successo a ${userProfile.displayName}!`);
      }
    });

    await Promise.all(updates);
  } catch (error) {
    console.error("Errore durante la riconciliazione degli appuntamenti:", error);
  }
}