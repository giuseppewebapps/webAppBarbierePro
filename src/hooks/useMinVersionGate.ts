import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

type AppVersionConfig = {
  minRequiredVersion?: string;
  message?: string;
};

/**
 * Confronto semver minimale (non lessicografico):
 * "1.10.0" viene correttamente considerata più recente di "1.9.0".
 */
function compareVersions(current: string, required: string): number {
  const parse = (value: string) =>
    value.split('.').map((part) => parseInt(part.replace(/\D/g, ''), 10) || 0);
  const left = parse(current);
  const right = parse(required);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Kill switch versioni, in ascolto live su config/appVersion.
 *
 * Perché serve: è l'UNICO meccanismo in grado di fermare un client aggiornato
 * "a metà" o rimasto indietro anche quando la PWA resta aperta per giorni senza
 * fare nessuna navigazione (caso in cui nessun controllo su file/HTTP scatta).
 * Il canale Firestore dell'app è già aperto, quindi la notifica arriva subito.
 *
 * È volutamente FAIL-OPEN: se il documento non esiste, se le regole lo negano
 * o se il dispositivo è offline non viene bloccato nulla.
 */
export function useMinVersionGate(): { blocked: boolean; message: string | null } {
  const [config, setConfig] = useState<AppVersionConfig | null>(null);

  useEffect(() => {
    // In sviluppo non vogliamo bloccare nulla.
    if (!import.meta.env.PROD) return;

    const unsubscribe = onSnapshot(
      doc(db, 'config', 'appVersion'),
      (snapshot) => {
        setConfig(snapshot.exists() ? (snapshot.data() as AppVersionConfig) : null);
      },
      (error) => {
        // Regola non ancora pubblicata o documento non leggibile:
        // non è mai un buon motivo per bloccare l'attività del salone.
        console.warn('[VersionGate] Impossibile leggere config/appVersion:', error);
        setConfig(null);
      }
    );

    return () => unsubscribe();
  }, []);

  const minRequired = config?.minRequiredVersion?.trim();
  const blocked = !!minRequired && compareVersions(__APP_VERSION__, minRequired) < 0;
  const message = blocked ? config?.message?.trim() || null : null;

  return { blocked, message };
}
