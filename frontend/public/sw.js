// Service Worker v9.1 - NO CACHING - ALWAYS FRESH
console.log('SW v9.1: NO CACHE MODE - Always fetch fresh');

const SW_VERSION = 'v9.1-NO-CACHE-20250116-1205';

// Unregister this service worker on install
self.addEventListener('install', (event) => {
  console.log('🔧 SW v9.1: Unregistering service worker - no caching needed');
  event.waitUntil(
    self.registration.unregister().then(() => {
      console.log('✅ SW: Unregistered successfully');
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('✅ SW v9.1: Cleaning up and unregistering');
  
  event.waitUntil(
    Promise.all([
      // Delete ALL caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            console.log('🗑️ Deleting cache:', cacheName);
            return caches.delete(cacheName);
          })
        );
      }),
      // Take control briefly before unregistering
      self.clients.claim(),
      // Unregister self
      self.registration.unregister()
    ]).then(() => {
      console.log('🎉 SW: All caches deleted and service worker unregistered');
    })
  );
});

// NO FETCH HANDLING - Just let browser handle everything
self.addEventListener('fetch', (event) => {
  // Do nothing - let browser fetch directly
  return;
});

// Message handler for manual cache refresh
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('SW: Manual cache clear requested');
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => {
        if (cacheName.includes('casino-battle')) {
          caches.delete(cacheName);
          console.log('SW: Deleted cache:', cacheName);
        }
      });
    });
  }
});

// Push notification handler
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New game starting!',
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Join Now',
        icon: '/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icon-192x192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Casino Battle Royale', options)
  );
});

console.log('🚀 SW v9.1: Service Worker loaded - Will unregister to disable caching');