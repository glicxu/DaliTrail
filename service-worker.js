// service-worker.js
// DaliTrail PWA Service Worker
// Strategy:
// - Precache app shell + static assets (cache-first)
// - Navigations: network-first, fallback to cached /index.html when offline
// - Runtime cache for other same-origin GET requests
// - Supports update flow via postMessage("SKIP_WAITING")

const PRECACHE = "dalitrail-precache-v6";  // bump when asset list changes
const RUNTIME  = "dalitrail-runtime-v6";

const PRECACHE_ASSETS = [
  // App shell (precached so first launch can work offline)
  "/",
  "/index.html",

  // Manifest & icons
  "/manifest.webmanifest",
  "/assets/icons/icon-180.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",

  // Styles
  "/assets/style.css",

  // JS entry + modules
  "/assets/js/main.js",
  "/assets/js/location.js",
  "/assets/js/track.js",
  "/assets/js/utils.js",
  "/assets/js/sketch-map.js",
  "/assets/js/kml-import.js",
  "/assets/js/walk.js",
  "/assets/js/search.js",
  "/assets/js/vendor/sql-wasm.js",
  "/assets/js/vendor/sql-wasm.wasm",
  "/assets/js/vendor/vision_wasm_internal.wasm",
  "/assets/js/vendor/tasks.min.js",

  // NEW: Precache the plant identification model for offline use
  "/assets/models/plant_classifier/plants_V1.tflite", // Canonical path
  "/assets/models/plant_classifier/plant_labels.csv", // Canonical path
  "/assets/js/identifier.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await Promise.all(
      PRECACHE_ASSETS.map(async (asset) => {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn("[SW] Failed to precache", asset, error);
        }
      })
    );
  })());
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

// Optional: allow page to trigger SW to take control immediately
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const accept = req.headers.get("accept") || "";

  // 1) HTML / navigations -> network-first with offline fallback to app shell
  //    Use navigate mode OR HTML accept header as heuristic.
  if (req.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        // Optionally cache latest HTML in runtime cache
        const copy = res.clone();
        caches.open(RUNTIME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      } catch {
        // Fallback to the cached app shell for offline
        const shell = await caches.match("/index.html");
        if (shell) return shell;
        // As a last resort, try any cached match for the request
        const any = await caches.match(req);
        if (any) return any;
        // Nothing cached; return a basic fallback response
        return new Response("<h1>Offline</h1><p>The app shell is not cached yet.</p>", {
          status: 503,
          headers: { "Content-Type": "text/html" }
        });
      }
    })());
    return;
  }

  // 2) Same-origin static assets -> cache-first, then network; populate runtime cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            // only cache good, basic responses
            if (res && res.status === 200 && res.type === "basic") {
              const copy = res.clone();
              caches.open(RUNTIME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(async () => {
            // If we can't fetch and it's an asset we precached, serve that
            const precached = await caches.match(req);
            if (precached) return precached;
            // Otherwise just fail gracefully
            return new Response("", { status: 504 });
          });
      })
    );
    return;
  }

  // 3) Cross-origin requests -> pass-through (you could add custom strategies here)
  //    We skip caching for cross-origin by default to avoid opaque responses clutter.
  //    If you later add tile servers or APIs, consider a separate runtime strategy.
});
