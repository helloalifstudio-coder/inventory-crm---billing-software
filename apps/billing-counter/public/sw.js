const CACHE_NAME = "agm-showroom-v2";
const SHELL_ASSETS = [
    "/",
    "/index.html",
    "/app.js",
    "/manifest.json",
    "/assets/app_icon.png",
    "/assets/alif-growth-media-logo.png",
    "/vendor/chart.umd.min.js",
    "/vendor/JsBarcode.all.min.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(fetch(req));
        return;
    }
    event.respondWith(
        caches.match(req).then((cached) => {
            const networkFetch = fetch(req)
                .then((res) => {
                    if (res && res.status === 200 && url.origin === self.location.origin) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
