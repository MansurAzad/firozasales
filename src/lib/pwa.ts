export function refuseServiceWorker(hostname: string, production: boolean, framed: boolean, disabled: boolean) {
  const host = hostname.toLowerCase();
  const lovableHost = /\.(lovable\.app|gpt-eng\.com|gptengineer\.run)$/.test(host);
  const label = host.split('.')[0] ?? '';
  return !production || framed || disabled ||
    (lovableHost && /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/.test(label)) ||
    (lovableHost && /^project--.+-dev$/.test(label)) ||
    /(^|\.)(lovableproject\.com|lovableproject-dev\.com|beta\.lovable\.dev)$/.test(host);
}
export async function registerOfflineApp() {
  if (!('serviceWorker' in navigator)) return;
  const refuse = refuseServiceWorker(window.location.hostname, import.meta.env.PROD, window.self !== window.top, new URLSearchParams(window.location.search).get('sw') === 'off');
  if (refuse) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(r => [r.active,r.waiting,r.installing].some(w => w && new URL(w.scriptURL).pathname === '/sw.js')).map(r => r.unregister()));
    return;
  }
  await navigator.serviceWorker.register('/sw.js');
  if (navigator.storage?.persist) await navigator.storage.persist();
}