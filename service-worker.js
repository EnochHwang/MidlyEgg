const CACHE_NAME = "midlyegg-pos-v4";

const CACHE_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const cachePromises = CACHE_FILES.map(async (url) => {
        const response = await fetch(
          new Request(url, { cache: "reload" })
        );

        if (!response.ok) {
          throw new Error(`Network response was not OK for ${url}`);
        }

        await cache.put(url, response);
      });

      await Promise.all(cachePromises);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter((cacheName) => {
            return (
              cacheName.startsWith("midlyegg-pos-") &&
              cacheName !== CACHE_NAME
            );
          })
          .map((cacheName) => caches.delete(cacheName))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);

      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        return await fetch(event.request);
      } catch (error) {
        if (event.request.mode === "navigate") {
          return (
            (await cache.match("./index.html")) ||
            (await cache.match("./"))
          );
        }

        return new Response("Offline resource not available", {
          status: 503,
          statusText: "Offline"
        });
      }
    })()
  );
});

/* =========================================================
   APP VERSION
   ========================================================= */

self.addEventListener(
  "message",
  (event) => {

    if (
      event.data?.type ===
      "GET_VERSION"
    ) {

      const version =
        CACHE_NAME.match(
          /v\d+$/
        )?.[0] || CACHE_NAME;

      event.source?.postMessage({
        type: "APP_VERSION",
        version: version
      });
    }
  }
);