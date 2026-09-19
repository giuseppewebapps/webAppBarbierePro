import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { StaffProfile } from '../types';
import { useAuth } from '../context/AuthContext';
import { useSalonSettings } from './useSalonSettings';

/**
 * RBAC: determina se l'utente autenticato è il Titolare del salone.
 *
 * - Mono-postazione: l'unico operatore è considerato titolare.
 * - Multi-staff: titolare = chi ha `role === 'owner'` nella propria scheda staff
 *   (letto per uid, SENZA filtro `active`, così vale anche se l'owner è disattivato).
 */
export function useIsOwner() {
  const { profile, tenantId } = useAuth();
  const { settings, loading: settingsLoading } = useSalonSettings(tenantId);
  const uid = profile?.uid;
  const multiStaff = settings?.hasMultiStaff === true;

  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Attendiamo i settings per conoscere la modalità (evita falsi stati iniziali)
    if (settingsLoading) return;

    let active = true;

    if (!tenantId || !uid) {
      if (active) setLoading(false);
      return () => { active = false; };
    }

    if (!multiStaff) {
      // Mono-postazione: unico operatore = titolare
      setIsOwner(true);
      setLoading(false);
      return () => { active = false; };
    }

    // Multi-staff: verifica la scheda staff dell'utente per uid
    setLoading(true);
    getDoc(doc(db, 'salons', tenantId, 'staff', uid))
      .then((snap) => {
        if (active) {
          setIsOwner(!!(snap.exists() && (snap.data() as StaffProfile).role === 'owner'));
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setIsOwner(false);
          setLoading(false);
        }
      });

    return () => { active = false; };
  }, [tenantId, uid, multiStaff, settingsLoading]);

  return { isOwner, loading };
}