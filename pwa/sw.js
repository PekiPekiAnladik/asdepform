// Service Worker for Sosyal Hizmet Formu PWA
// Version 2.0.0

const CACHE_NAME = 'sh-formu-pwa-v2.0.0';
const OFFLINE_URL = '/offline.html';

// Critical files to cache
const CORE_CACHE_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html'
];

// Data cache for form submissions
const DATA_CACHE_NAME = 'sh-formu-data-v1';

// Install event - cache core files
self.addEventListener('install', event => {
  console.log('🔧 Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching core files...');
        return cache.addAll(CORE_CACHE_FILES);
      })
      .then(() => {
        console.log('✅ Core files cached successfully');
        // Force the waiting service worker to become active
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ Failed to cache core files:', error);
      })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  console.log('🚀 Service Worker activating...');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
              console.log('🗑️ Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients
      self.clients.claim()
    ])
  );
});

// Fetch event - network first for API calls, cache first for static assets
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle different types of requests
  if (request.url.includes('/api/') || request.url.includes('form-data')) {
    // API calls - network first, cache as fallback
    event.respondWith(networkFirstStrategy(request));
  } else if (request.destination === 'document') {
    // HTML documents - network first with offline fallback
    event.respondWith(documentStrategy(request));
  } else {
    // Static assets - cache first
    event.respondWith(cacheFirstStrategy(request));
  }
});

// Network First Strategy (for API calls)
async function networkFirstStrategy(request) {
  const cache = await caches.open(DATA_CACHE_NAME);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('🌐 Network failed, trying cache:', request.url);
    
    // Fallback to cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return error response if no cache available
    return new Response(
      JSON.stringify({ 
        error: 'Offline', 
        message: 'Bu işlem için internet bağlantısı gereklidir.' 
      }),
      { 
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Document Strategy (for HTML pages)
async function documentStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    
    throw new Error('Network response not ok');
  } catch (error) {
    console.log('🌐 Network failed, trying cache for document:', request.url);
    
    // Try cache
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback to offline page
    return cache.match(OFFLINE_URL) || new Response(
      getOfflineHTML(),
      { 
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }
}

// Cache First Strategy (for static assets)
async function cacheFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  
  // Try cache first
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    // Fallback to network
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache the response
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('❌ Failed to fetch:', request.url);
    
    // Return empty response for failed requests
    return new Response('', { 
      status: 404,
      statusText: 'Not Found'
    });
  }
}

// Background Sync for form submissions
self.addEventListener('sync', event => {
  console.log('🔄 Background sync triggered:', event.tag);
  
  if (event.tag === 'form-submission') {
    event.waitUntil(syncFormSubmissions());
  }
});

// Sync queued form submissions when online
async function syncFormSubmissions() {
  try {
    const db = await openDB();
    const tx = db.transaction(['pending-forms'], 'readonly');
    const store = tx.objectStore('pending-forms');
    const pendingForms = await store.getAll();
    
    console.log(`📤 Syncing ${pendingForms.length} pending forms...`);
    
    for (const formData of pendingForms) {
      try {
        // Attempt to submit the form
        const response = await fetch('/api/submit-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData.data)
        });
        
        if (response.ok) {
          // Remove from pending queue
          const deleteTx = db.transaction(['pending-forms'], 'readwrite');
          const deleteStore = deleteTx.objectStore('pending-forms');
          await deleteStore.delete(formData.id);
          
          console.log('✅ Form synced successfully:', formData.id);
          
          // Notify user
          self.registration.showNotification('Form Gönderildi', {
            body: 'Kaydedilen formunuz başarıyla gönderildi.',
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            tag: 'form-sync-success',
            vibrate: [200, 100, 200]
          });
        }
      } catch (error) {
        console.error('❌ Failed to sync form:', formData.id, error);
      }
    }
  } catch (error) {
    console.error('❌ Background sync failed:', error);
  }
}

// Push notification handler
self.addEventListener('push', event => {
  console.log('📱 Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'Yeni bir bildirim aldınız.',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [200, 100, 200],
    data: {
      timestamp: Date.now()
    },
    actions: [
      {
        action: 'open',
        title: 'Aç',
        icon: '/action-open.png'
      },
      {
        action: 'close',
        title: 'Kapat',
        icon: '/action-close.png'
      }
    ],
    requireInteraction: false,
    silent: false
  };
  
  event.waitUntil(
    self.registration.showNotification('Sosyal Hizmet Formu', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  console.log('🔔 Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    // Open the app
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Message handler for communication with main thread
self.addEventListener('message', event => {
  console.log('💬 Message received:', event.data);
  
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CACHE_FORM_DATA':
      cacheFormData(payload);
      break;
      
    case 'GET_CACHE_INFO':
      getCacheInfo().then(info => {
        event.ports[0].postMessage(info);
      });
      break;
      
    case 'CLEAR_CACHE':
      clearAllCaches().then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;
      
    default:
      console.log('Unknown message type:', type);
  }
});

// Cache form data locally
async function cacheFormData(formData) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = new Response(JSON.stringify(formData));
    const key = `form-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await cache.put(key, response);
    console.log('💾 Form data cached:', key);
  } catch (error) {
    console.error('❌ Failed to cache form data:', error);
  }
}

// Get cache information
async function getCacheInfo() {
  try {
    const cacheNames = await caches.keys();
    const info = {
      totalCaches: cacheNames.length,
      caches: []
    };
    
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      info.caches.push({
        name: cacheName,
        size: keys.length,
        items: keys.map(req => req.url)
      });
    }
    
    return info;
  } catch (error) {
    console.error('❌ Failed to get cache info:', error);
    return { error: error.message };
  }
}

// Clear all caches
async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => caches.delete(cacheName))
    );
    console.log('🗑️ All caches cleared');
  } catch (error) {
    console.error('❌ Failed to clear caches:', error);
    throw error;
  }
}

// IndexedDB helper for offline form storage
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SHFormDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      
      // Create object stores
      if (!db.objectStoreNames.contains('pending-forms')) {
        const store = db.createObjectStore('pending-forms', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      if (!db.objectStoreNames.contains('completed-forms')) {
        const store = db.createObjectStore('completed-forms', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('formType', 'formType', { unique: false });
      }
    };
  });
}

// Store form data offline
async function storeFormOffline(formData) {
  try {
    const db = await openDB();
    const tx = db.transaction(['pending-forms'], 'readwrite');
    const store = tx.objectStore('pending-forms');
    
    const data = {
      id: `form-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      data: formData,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    await store.add(data);
    console.log('💾 Form stored offline:', data.id);
    
    // Register for background sync
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('form-submission');
    }
    
    return data.id;
  } catch (error) {
    console.error('❌ Failed to store form offline:', error);
    throw error;
  }
}

// Inline offline HTML template
function getOfflineHTML() {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Çevrimdışı - Sosyal Hizmet Formu</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #4a90e2, #357abd);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
      padding: 20px;
    }
    
    .offline-container {
      max-width: 400px;
      padding: 40px;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }
    
    .offline-icon {
      font-size: 4rem;
      margin-bottom: 20px;
      opacity: 0.8;
    }
    
    h1 {
      font-size: 1.5rem;
      margin-bottom: 15px;
      font-weight: 600;
    }
    
    p {
      font-size: 1rem;
      line-height: 1.6;
      opacity: 0.9;
      margin-bottom: 25px;
    }
    
    .retry-btn {
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    
    .retry-btn:hover {
      background: rgba(255,255,255,0.3);
      transform: translateY(-2px);
    }
    
    .features {
      margin-top: 30px;
      text-align: left;
    }
    
    .feature {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      font-size: 0.9rem;
      opacity: 0.8;
    }
    
    .feature-icon {
      margin-right: 10px;
      font-size: 1.2rem;
    }
  </style>
</head>
<body>
  <div class="offline-container">
    <div class="offline-icon">📴</div>
    <h1>İnternet Bağlantısı Yok</h1>
    <p>Şu anda çevrimdışısınız. İnternet bağlantınızı kontrol edin ve tekrar deneyin.</p>
    
    <button class="retry-btn" onclick="window.location.reload()">
      🔄 Tekrar Dene
    </button>
    
    <div class="features">
      <div class="feature">
        <span class="feature-icon">💾</span>
        <span>Formlarınız yerel olarak kaydedilir</span>
      </div>
      <div class="feature">
        <span class="feature-icon">🔄</span>
        <span>Bağlantı kurulduğunda otomatik senkronizasyon</span>
      </div>
      <div class="feature">
        <span class="feature-icon">📱</span>
        <span>Çevrimdışı çalışma desteği</span>
      </div>
    </div>
  </div>
  
  <script>
    // Auto-retry when online
    window.addEventListener('online', () => {
      window.location.reload();
    });
    
    // Check connection status
    function checkConnection() {
      if (navigator.onLine) {
        window.location.reload();
      }
    }
    
    // Check every 30 seconds
    setInterval(checkConnection, 30000);
  </script>
</body>
</html>
  `;
}

// Periodic cleanup of old cached data
self.addEventListener('periodicsync', event => {
  if (event.tag === 'cleanup-cache') {
    event.waitUntil(cleanupOldCache());
  }
});

// Clean up old cache entries
async function cleanupOldCache() {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const requests = await cache.keys();
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    for (const request of requests) {
      const response = await cache.match(request);
      const dateHeader = response.headers.get('date');
      
      if (dateHeader) {
        const cacheDate = new Date(dateHeader).getTime();
        if (now - cacheDate > maxAge) {
          await cache.delete(request);
          console.log('🗑️ Cleaned up old cache entry:', request.url);
        }
      }
    }
  } catch (error) {
    console.error('❌ Cache cleanup failed:', error);
  }
}

// Error handler
self.addEventListener('error', event => {
  console.error('🚨 Service Worker error:', event.error);
});

// Unhandled rejection handler
self.addEventListener('unhandledrejection', event => {
  console.error('🚨 Unhandled rejection in Service Worker:', event.reason);
});

console.log('🎉 Service Worker loaded successfully!');

// Export functions for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    networkFirstStrategy,
    cacheFirstStrategy,
    documentStrategy,
    storeFormOffline,
    openDB
  };
}