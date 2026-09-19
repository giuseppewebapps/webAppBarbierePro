import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { useMinVersionGate } from '../hooks/useMinVersionGate';

/** Secondi di attesa prima dell'aggiornamento automatico del banner. */
const AUTO_UPDATE_SECONDS = 20;

/**
 * Guardia anti-loop: se il dispositivo continuasse a ricevere la build vecchia
 * (es. CDN ancora in propagazione) evitiamo un ciclo infinito di refresh,
 * lasciando all'utente il pulsante manuale.
 */
const AUTO_UPDATE_GUARD_KEY = 'app-auto-update-attempted';

/**
 * Montato alla radice (fratello di <App />), così è visibile su ogni schermata:
 * login, caricamento, dashboard cliente e dashboard barbiere.
 *
 * - Banner non bloccante quando esiste una versione nuova (si aggiorna da solo).
 * - Overlay bloccante quando il salone richiede una versione minima (kill switch).
 */
export default function UpdateOverlay() {
  const { updateAvailable, applyUpdate } = useVersionCheck();
  const { blocked, message } = useMinVersionGate();
  const [secondsLeft, setSecondsLeft] = useState(AUTO_UPDATE_SECONDS);
  const [autoUpdateAllowed, setAutoUpdateAllowed] = useState(false);

  // Il tentativo automatico è concesso una sola volta per sessione.
  useEffect(() => {
    try {
      setAutoUpdateAllowed(sessionStorage.getItem(AUTO_UPDATE_GUARD_KEY) === null);
    } catch {
      setAutoUpdateAllowed(true);
    }
  }, []);

  const runUpdate = () => {
    try {
      sessionStorage.setItem(AUTO_UPDATE_GUARD_KEY, '1');
    } catch {
      // sessionStorage non disponibile (Safari in modalità privata): procediamo.
    }
    applyUpdate();
  };

  // Auto-aggiornamento del banner: dopo 20 secondi l'app si aggiorna da sola,
  // così anche l'utente meno attento non resta su una versione vecchia.
  useEffect(() => {
    if (!updateAvailable || blocked || !autoUpdateAllowed) return;

    const intervalId = window.setInterval(() => {
      setSecondsLeft((previous) => (previous <= 1 ? 0 : previous - 1));
    }, 1000);
    const timeoutId = window.setTimeout(runUpdate, AUTO_UPDATE_SECONDS * 1000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateAvailable, blocked, autoUpdateAllowed]);

  if (blocked) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Aggiornamento necessario</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            {message || 'È disponibile una nuova versione dell\'app. Aggiorna per continuare a prenotare.'}
          </p>
          <button
            type="button"
            onClick={runUpdate}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
          >
            <RefreshCw className="h-4 w-4" />
            Aggiorna ora
          </button>
          <p className="mt-3 text-xs text-gray-400">
            Se non funziona: chiudi e riapri l'app, oppure rimuovi l'icona dalla schermata home e aggiungila di nuovo.
          </p>
        </div>
      </div>
    );
  }

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-3">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-black px-4 py-3 shadow-2xl">
        <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Nuova versione disponibile</p>
          <p className="text-xs text-gray-400">
            {autoUpdateAllowed
              ? `Aggiornamento automatico tra ${secondsLeft}s…`
              : 'Tocca “Aggiorna” per completare l\'aggiornamento'}
          </p>
        </div>
        <button
          type="button"
          onClick={runUpdate}
          className="shrink-0 rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-black transition hover:bg-amber-300"
        >
          Aggiorna
        </button>
      </div>
    </div>
  );
}
