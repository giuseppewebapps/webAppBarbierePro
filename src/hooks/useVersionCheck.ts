import { useCallback, useEffect, useState } from 'react';

/** Ogni quanto ricontrollare la versione sul server (5 minuti). */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

type VersionPayload = {
  version?: string;
  buildId?: string;
};

/**
 * Rileva se sul server gira una build diversa da quella dell'app aperta.
 *
 * Copre i casi in cui NON avviene mai una navigazione (che è il vero motivo per
 * cui alcuni utenti restavano sulla versione vecchia):
 *  - PWA aggiunta alla schermata home, riaperta dalla memoria di iOS/Android
 *  - tab/browser lasciati aperti per giorni
 *  - pagine ripristinate dalla bfcache (pageshow con event.persisted)
 *
 * Il confronto avviene su buildId: è univoco per deploy, quindi non serve
 * ricordarsi di cambiare nulla a mano ad ogni rilascio.
 */
export function useVersionCheck(): { updateAvailable: boolean; applyUpdate: () => void } {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const applyUpdate = useCallback(() => {
    // Puliamo le cache prima di ricaricare: garantisce che il bundle nuovo
    // arrivi davvero dalla rete e non dalla copia locale del dispositivo.
    const reload = () => window.location.reload();
    if (typeof caches === 'undefined') {
      reload();
      return;
    }
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(reload)
      .catch(reload);
  }, []);

  useEffect(() => {
    // In sviluppo non ha senso: il server HMR non ha un version.json.
    if (!import.meta.env.PROD) return;

    let disposed = false;
    let inFlight = false;

    const checkVersion = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;

        // Fail-safe: se una regola di rewrite rispondesse con index.html
        // (content-type html) non proviamo nemmeno a interpretarlo come JSON.
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('json')) return;

        const data = (await response.json()) as VersionPayload;
        if (!disposed && data.buildId && data.buildId !== __APP_BUILD_ID__) {
          setUpdateAvailable(true);
        }
      } catch {
        // Offline o rete instabile: non è un errore, riproviamo al prossimo giro.
      } finally {
        inFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkVersion();
    };

    // pageshow con persisted === true significa "ripristinata dalla bfcache":
    // la pagina non ha fatto nessuna richiesta, quindi ricontrolliamo subito.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void checkVersion();
    };

    void checkVersion();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkVersion();
    }, CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', checkVersion);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkVersion);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  return { updateAvailable, applyUpdate };
}
