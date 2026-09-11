export function getTenantId(): string {
  const hostname = window.location.hostname;

  // 1. Ambiente di Sviluppo (Localhost)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'dev-salon'; 
  }

  // 2. Ambiente di Produzione (Vercel Wildcard)
  const parts = hostname.split('.');
  if (parts.length >= 3) {
    return parts[0]; 
  }

  // 3. Fallback d'emergenza
  return 'default';
}