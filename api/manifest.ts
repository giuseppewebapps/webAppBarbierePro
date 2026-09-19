import type { VercelRequest, VercelResponse } from '@vercel/node';

// Stesse variabili già usate dal client (nessun nuovo segreto da configurare:
// la API key di Firebase è pubblica, è già dentro il bundle del browser).
const PROJECT_ID =
  process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'eureka-hair-dev';
const API_KEY = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '';

/** Stessa logica di src/utils/tenantResolver.ts + i domini di anteprima Vercel. */
function resolveTenantId(host: string): string {
  const hostname = host.split(':')[0].toLowerCase().replace(/^www\./, '');
  if (!hostname) return 'demo';
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'demo';
  // I domini *.vercel.app non contengono il tenant: usiamo il salone demo.
  if (hostname.endsWith('vercel.app')) return 'demo';
  const parts = hostname.split('.');
  if (parts.length >= 3) return parts[0];
  return 'default';
}

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
};

const DEFAULT_ICONS: ManifestIcon[] = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tenantId = resolveTenantId(req.headers.host || '');

  // id fisso: evita che Android/iOS considerino la PWA come una NUOVA app
  // (doppia icona) quando cambiano nome o logo del salone.
  const manifest = {
    id: '/',
    name: 'Eureka Hair',
    short_name: 'Eureka',
    description: 'Prenota il tuo appuntamento in pochi click',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
    icons: DEFAULT_ICONS,
  };

  // Nome e logo dinamici del salone, letti dallo stesso documento pubblico
  // usato dal frontend (regola Firestore: settings -> allow read: if true).
  // Qui si usa la REST API e non l'SDK perché in una function Node
  // `import.meta.env` non esiste: le variabili vanno lette da process.env.
  if (API_KEY) {
    try {
      const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/salons/${encodeURIComponent(tenantId)}/settings/public`;
      const response = await fetch(`https://firestore.googleapis.com/v1/${docPath}?key=${API_KEY}`);

      if (response.ok) {
        const payload = (await response.json()) as {
          fields?: Record<string, { stringValue?: string } | undefined>;
        };
        const name = payload.fields?.name?.stringValue;
        const logoUrl = payload.fields?.logoUrl?.stringValue;

        if (name) {
          manifest.name = name;
          // Limite di lunghezza: sulle icone di sistema il nome viene troncato.
          manifest.short_name = name.slice(0, 12).trim();
        }

        if (logoUrl) {
          // purpose "any" e non "any maskable": se dichiarato maskable, Android
          // ritaglia a cerchio il logo e un'immagine rettangolare viene tagliata.
          manifest.icons = [
            { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' },
          ];
        }
      } else {
        console.warn(`[MANIFEST] Firestore ha risposto ${response.status} per il tenant "${tenantId}"`);
      }
    } catch (error) {
      // Fail-safe: se il database non risponde restituiamo il manifest di
      // default. Mai un 500, altrimenti l'installazione della PWA si rompe.
      console.error(`[MANIFEST] Lettura settings/public fallita per "${tenantId}":`, error);
    }
  }

  res.setHeader('Content-Type', 'application/manifest+json');
  // Cache breve sul CDN: il manifest cambia solo se il salone modifica nome/logo.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).send(JSON.stringify(manifest));
}
