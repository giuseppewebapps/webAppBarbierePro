import { collection, query, where, getDocs, doc, writeBatch, Timestamp, addDoc } from 'firebase/firestore';
import { db } from '../firebase'; 
import { logSystemError } from './logger';

export async function autoLinkAppointments(
  userProfile: { uid: string; displayName: string; email: string; phoneNumber?: string },
  tenantId: string 
) {
  const userEmail = userProfile.email?.trim().toLowerCase();
  
  // Normalizzazione rigorosa del telefono (Formato E.164: +393331234567)
  let normalizedPhone = userProfile.phoneNumber?.trim() || '';
  if (normalizedPhone && !normalizedPhone.startsWith('+')) {
    normalizedPhone = `+${normalizedPhone.replace(/\D/g, '')}`;
  }

  if (!userEmail && !normalizedPhone) return;

  try {
    const appointmentsRef = collection(db, 'salons', tenantId, 'appointments');
    
    // 1. Eseguiamo 3 query in parallelo per coprire tutti gli scenari (Nuovi manuali + Vecchi migrati)
    const queries = [];
    queries.push(getDocs(query(appointmentsRef, where('customerId', '==', 'manual_entry'))));
    
    if (normalizedPhone) {
      queries.push(getDocs(query(appointmentsRef, where('customer.phoneNumber', '==', normalizedPhone))));
    }
    if (userEmail) {
      queries.push(getDocs(query(appointmentsRef, where('customer.email', '==', userEmail))));
    }

    const snapshots = await Promise.all(queries);
    
    // 2. Unifichiamo i risultati rimuovendo i duplicati
    const uniqueDocs = new Map();
    snapshots.forEach(snapshot => {
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        // Escludiamo gli appuntamenti già linkati al nuovo UID
        if (data.customerId !== userProfile.uid) {
          uniqueDocs.set(doc.id, { ref: doc.ref, data });
        }
      });
    });

    if (uniqueDocs.size === 0) return;

    const batch = writeBatch(db);
    let matchCount = 0;

    uniqueDocs.forEach(({ ref, data }) => {
      // Verifica definitiva di sicurezza per evitare falsi positivi sui manual_entry
      const isEmailMatch = userEmail && data.customer?.email?.trim().toLowerCase() === userEmail;
      const isPhoneMatch = normalizedPhone && data.customer?.phoneNumber?.trim() === normalizedPhone;
      const isManualUnassigned = data.customerId === 'manual_entry' && (isEmailMatch || isPhoneMatch);
      const isOldMigrationMatch = data.customerId !== 'manual_entry' && (isEmailMatch || isPhoneMatch);

      if (isManualUnassigned || isOldMigrationMatch) {
        batch.update(ref, {
          customerId: userProfile.uid,
          'customer.phoneNumber': normalizedPhone || data.customer?.phoneNumber || '', 
          'customer.displayName': userProfile.displayName, 
          'customer.email': userEmail || data.customer?.email || '',
          isManual: false 
        });
        matchCount++;
      }
    });

    if (matchCount > 0) {

      await batch.commit();

      await addDoc(collection(db, 'salons', tenantId, 'notifications'), {
        userId: userProfile.uid,
        title: 'Appuntamenti Sincronizzati 💈',
        message: `Abbiamo trovato e collegato ${matchCount} appuntamento/i al tuo account!`,
        type: 'booking',
        read: false,
        createdAt: Timestamp.now()
      });
      
      console.log(`✅ [Auto-Link] Assegnati ${matchCount} appuntamenti a ${userProfile.displayName}.`);
    }
  } catch (error: any) {
    console.error("Errore riconciliazione appuntamenti:", error);
    await logSystemError({ type: 'auto_link_error', userId: userProfile.uid, tenantId, error });
  }
}