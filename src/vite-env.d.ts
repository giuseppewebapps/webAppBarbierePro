/// <reference types="vite/client" />

// Costanti iniettate a build time da vite.config.ts (define + plugin version.json).
// __APP_VERSION__  -> versione "umana" e ordinata presa da package.json (es. "1.0.0")
// __APP_BUILD_ID__ -> identificativo univoco del deploy (commit SHA o timestamp)
declare const __APP_VERSION__: string;
declare const __APP_BUILD_ID__: string;
