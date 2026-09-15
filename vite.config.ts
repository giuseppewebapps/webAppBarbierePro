import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {execSync} from 'child_process';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Versione "umana" e ORDINABILE (package.json), usata dal kill switch versioni:
// in Firebase Console si confronta "minRequiredVersion" con questo valore.
// Va incrementata a mano quando si vuole forzare l'aggiornamento dei client.
function resolveAppVersion(): string {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8');
    return (JSON.parse(raw).version as string) || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Identificativo univoco del deploy: cambia ad OGNI build.
// Serve per invalidare service worker e cache senza toccare la versione.
function resolveBuildId(): string {
  const vercelSha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha) return vercelSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']})
      .toString()
      .trim();
  } catch {
    // Fuori da un repository git (build particolari): usiamo il timestamp.
    return String(Date.now());
  }
}

const APP_VERSION = resolveAppVersion();
const APP_BUILD_ID = resolveBuildId();

// Scrive dist/version.json: è il "campanello" che avvisa le app già aperte
// (PWA in schermata home, tab aperte da giorni) che esiste una build nuova.
function versionFilePlugin(): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(outDir)) return;
      const payload = JSON.stringify(
        {version: APP_VERSION, buildId: APP_BUILD_ID, builtAt: new Date().toISOString()},
        null,
        2
      );
      fs.writeFileSync(path.join(outDir, 'version.json'), payload, 'utf8');
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), versionFilePlugin()],
    base: '/',
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __APP_BUILD_ID__: JSON.stringify(APP_BUILD_ID),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: {
        host: 'localhost',
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
      }
    },
  };
});