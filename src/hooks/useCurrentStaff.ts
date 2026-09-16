import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { StaffProfile } from '../types';

/**
 * Nome dello staff autenticato (owner o barbiere) per l'header.
 *
 * Legge la scheda `salons/{tenant}/staff/{uid}` e ne restituisce il
 * `displayName`. Ritorna `null` quando non c'è una scheda staff
 * (es. mono-postazione senza doc, o ruolo cliente): il chiamante
 * usa in quel caso il fallback `profile.displayName`.
 *
 * Prende i parametri espliciti (non usa useAuth) perché viene
 * chiamato in App.tsx, che è il provider di AuthContext.
 */
export function useCurrentStaff(tenantId: string, uid: string | undefined, isBarber: boolean) {
  const [staffName, setStaffName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!tenantId || !uid || !isBarber) {
      setStaffName(null);
      return () => { active = false; };
    }

    getDoc(doc(db, 'salons', tenantId, 'staff', uid))
      .then((snap) => {
        if (active) {
          setStaffName(snap.exists() ? ((snap.data() as StaffProfile).displayName || null) : null);
        }
      })
      .catch(() => {
        if (active) setStaffName(null);
      });

    return () => { active = false; };
  }, [tenantId, uid, isBarber]);

  return staffName;
}
