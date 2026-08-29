// Service worker MÍNIMO: existe para que la app sea instalable.
// A propósito SIN handler de fetch — las teselas ya las cachea el navegador
// (CDN con cache-control) y un caché propio aquí solo puede servir datos
// rancios del mapa colaborativo sin que nadie lo vea.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
