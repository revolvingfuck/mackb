// Service Worker for Portfolio Website
const CACHE_NAME = 'portfolio-v1.0.0';
const STATIC_CACHE = 'static-v1.0.0';
const DYNAMIC_CACHE = 'dynamic-v1.0.0';

// Files to cache immediately
const STATIC_FILES = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/Resume.html',
    '/3d-viewer.html',
    '/works.html',
    '/wrestle_demo.html',
    '/airport.mp4',
    '/mb.mp4',
    '/background.png',
    '/loading.gif'
];

// Install event - cache static files
self.addEventListener('install', event => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('Caching static files');
                return cache.addAll(STATIC_FILES);
            })
            .catch(error => {
                console.error('Error caching static files:', error);
            })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
    );
    self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Handle different types of requests
    if (request.destination === 'document' || request.destination === '') {
        // HTML pages - cache first, then network
        event.respondWith(
            caches.match(request)
                .then(response => {
                    if (response) {
                        // Return cached version and update in background
                        fetch(request)
                            .then(fetchResponse => {
                                if (fetchResponse.status === 200) {
                                    caches.open(DYNAMIC_CACHE)
                                        .then(cache => cache.put(request, fetchResponse.clone()));
                                }
                            })
                            .catch(() => {
                                // Network failed, keep using cached version
                            });
                        return response;
                    }
                    // Not in cache, fetch from network
                    return fetch(request)
                        .then(response => {
                            if (response.status === 200) {
                                const responseClone = response.clone();
                                caches.open(DYNAMIC_CACHE)
                                    .then(cache => cache.put(request, responseClone));
                            }
                            return response;
                        })
                        .catch(() => {
                            // Network failed, return offline page
                            return caches.match('/index.html');
                        });
                })
        );
    } else if (request.destination === 'style' || request.destination === 'script') {
        // CSS and JS files - cache first
        event.respondWith(
            caches.match(request)
                .then(response => {
                    return response || fetch(request)
                        .then(fetchResponse => {
                            if (fetchResponse.status === 200) {
                                const responseClone = fetchResponse.clone();
                                caches.open(STATIC_CACHE)
                                    .then(cache => cache.put(request, responseClone));
                            }
                            return fetchResponse;
                        });
                })
        );
    } else if (request.destination === 'image' || request.destination === 'video') {
        // Images and videos - network first, then cache
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(DYNAMIC_CACHE)
                            .then(cache => cache.put(request, responseClone));
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(request);
                })
        );
    } else {
        // Other resources - network first
        event.respondWith(
            fetch(request)
                .catch(() => {
                    return caches.match(request);
                })
        );
    }
});

// Background sync for offline actions
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync') {
        event.waitUntil(doBackgroundSync());
    }
});

// Push notifications
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'New update available!',
        icon: '/favicon-32x32.png',
        badge: '/favicon-16x16.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'View Portfolio',
                icon: '/favicon-32x32.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: '/favicon-32x32.png'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('Brian MacAdam Portfolio', options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Background sync function
function doBackgroundSync() {
    // Implement background sync logic here
    console.log('Background sync completed');
}

// Message handler for communication with main thread
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
});




