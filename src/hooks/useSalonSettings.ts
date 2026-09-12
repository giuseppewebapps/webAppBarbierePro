import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { SalonPublicSettings } from '../types';

export function useSalonSettings(tenantId: string) {
  const [settings, setSettings] = useState<SalonPublicSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    const docRef = doc(db, 'salons', tenantId, 'settings', 'public');

    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setSettings(docSnap.data() as SalonPublicSettings);
        } else {
          // Fallback robusto SaaS: previene i crash se mancano i campi seeded
          const fallbackName = tenantId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          setSettings({
            name: fallbackName,
            phone: '',
            whatsapp: '',
            instagram: '',
            instagramUrl: '',
            address: '',
            mapsUrl: '',
            email: '',
            notificationEmail: '',
            services: [], // Previene il crash del .map() nel frontend
            weeklySchedule: {},
            yieldConfig: { URGENCY_CURRENT_WEEK: true, MIN_SATURATION_RATE: 0.75 }
          } as unknown as SalonPublicSettings); 
        }
        setLoading(false);
      },
      (error) => {
        console.error("Errore caricamento dati salone:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId]);

  return { settings, loading };
}