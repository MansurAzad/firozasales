export function refuseServiceWorker(production: boolean, framed: boolean, disabled: boolean) {
  return !production || framed || disabled;
}
export async function registerOfflineApp() {
  if (!("serviceWorker" in navigator)) return;
  const refuse = refuseServiceWorker(
    import.meta.env.PROD,
    window.self !== window.top,
    new URLSearchParams(window.location.search).get("sw") === "off",
  );
  if (refuse) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((r) =>
          [r.active, r.waiting, r.installing].some(
            (w) => w && new URL(w.scriptURL).pathname === "/sw.js",
          ),
        )
        .map((r) => r.unregister()),
    );
    return;
  }
  await navigator.serviceWorker.register("/sw.js");
  if (navigator.storage?.persist) await navigator.storage.persist();
}
