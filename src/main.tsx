import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import UpdateOverlay from './components/UpdateOverlay';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Mostrato sopra ogni schermata: banner di aggiornamento o blocco versione minima */}
    <UpdateOverlay />
  </StrictMode>,
);

// ==========================================
// AGGIORNAMENTO AUTOMATICO DELLA VERSIONE (solo produzione)
// ==========================================
// Il service worker viene registrato con un URL diverso ad ogni build
// (/sw.js?v=<buildId>): così il browser è obbligato a riscaricarlo ad ogni
// deploy, senza dover incrementare a mano nessuna costante.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Va letto PRIMA della registrazione: se è null significa che questo
  // dispositivo non aveva ancora nessun service worker attivo.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Primo ingresso in assoluto: non c'è una versione vecchia da sostituire,
    // quindi non ricarichiamo (eviteremmo un refresh inutile al primo utente).
    if (!hadController || reloading) return;

    // Guardia anti-loop: se il dispositivo continuasse a ricevere il bundle
    // vecchio, non entriamo in un ciclo infinito di refresh.
    const guardKey = `sw-reload-${__APP_BUILD_ID__}`;
    try {
      if (sessionStorage.getItem(guardKey)) return;
      sessionStorage.setItem(guardKey, '1');
    } catch {
      // sessionStorage non disponibile: procediamo comunque con il reload.
    }

    reloading = true;
    window.location.reload();
  });

  const registerServiceWorker = () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${__APP_BUILD_ID__}`, { updateViaCache: 'none' })
      .then((registration) => registration.update().catch(() => undefined))
      .catch((error) => console.warn('[SW] Registrazione non riuscita:', error));
  };

  // Lo script è un modulo (quindi già "deferred"), ma se per qualsiasi motivo
  // l'evento load fosse già scattato registriamo subito senza aspettare invano.
  if (document.readyState === 'complete') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker);
  }
}
