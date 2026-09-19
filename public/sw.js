/**
 * Service Worker "update-only".
 *
 * SCOPO: garantire che ogni deploy venga recepito al primo caricamento utile.
 * Non memorizza NULLA in cache e non intercetta NESSUNA richiesta: così è
 * impossibile che serva HTML/bundle vecchi o che interferisca con Firestore,
 * Firebase Auth e le API serverless (/api/*).
 *
 * Il meccanismo di aggiornamento è doppio:
 *  1. Il file viene registrato con un URL diverso ad ogni build
 *     (`/sw.js?v=<buildId>`), quindi il browser è obbligato a riscaricarlo.
 *  2. skipWaiting() + clients.claim(): il nuovo SW prende subito il controllo
 *     delle finestre/PWA aperte, facendo scattare 'controllerchange' nel
 *     client (che a quel punto ricarica la pagina con il bundle nuovo).
 */

self.addEventListener('install', () => {
  // Non aspetta la chiusura delle tab: entra subito in attesa di attivazione.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Questo SW non scrive in cache: eliminiamo solo l'eventuale spazzatura
        // rimasta da versioni precedenti del progetto.
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      } catch (error) {
        console.warn('[SW] Pulizia delle cache fallita:', error);
      }
      // Prende il controllo immediato di tutte le finestre/PWA già aperte.
      await self.clients.claim();
    })()
  );
});

// NESSUN listener 'fetch' è registrato di proposito.
// Senza fetch handler il browser manda ogni richiesta direttamente in rete,
// quindi Firestore / Auth / /api/* non vengono mai toccati da questo file.
