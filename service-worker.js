// service-worker.js
const PRECACHE = "dalitrail-precache-v3";     // bump when asset list changes
const RUNTIME  = "dalitrail-runtime-v3";

const PRECACHE_ASSETS = [
  // ⚠️ No "/" and no "/index.html" here
  "/manifest.webmanifest",
  "/assets/style.css",
  "/assets/js/main.js",
  "/assets/js/location.js",   
  "/assets/js/track.js",              
  "/assets/icons/icon-180.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  const accept = req.headers.get("accept") || "";

  // 1) HTML -> network-first
  if (req.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Optionally cache a copy of the latest HTML in RUNTIME (not required)
          const copy = res.clone();
          caches.open(RUNTIME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)) // fallback to cache if offline
    );
    return;
  }

  // 2) Same-origin static assets -> cache-first, populate runtime cache
  if (new URL(req.url).origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          // only cache good, basic responses
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(RUNTIME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
  }
});
