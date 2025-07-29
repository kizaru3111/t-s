const CACHE_NAME = 'gallery-v2';
const API_CACHE_NAME = 'api-cache-v1';
const ASSETS = [
  '/',
  '/login',
  '/static/style.css',
  '/static/script.js',
  '/static/icon.png',
  '/static/qr icon.png',
  '/static/send icon.png',
  '/static/copy_icon.png',
  '/static/manifest.json'
];

// Добавляем состояние сессии
let lastSessionCheck = Date.now();
const SESSION_CHECK_INTERVAL = 30000;
let sessionStatus = null;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== API_CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Функция для управления API запросами
async function handleApiRequest(request) {
  const now = Date.now();
  
  // Если запрос к check_session, проверяем интервал
  if (request.url.includes('/api/check_session')) {
    if (now - lastSessionCheck < SESSION_CHECK_INTERVAL) {
      // Возвращаем кэшированный статус
      if (sessionStatus) {
        return new Response(JSON.stringify(sessionStatus), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Обновляем время последней проверки
    lastSessionCheck = now;
  }

  try {
    const response = await fetch(request.clone());
    
    // Кэшируем только успешные ответы
    if (response.ok) {
      const responseToCache = response.clone();
      caches.open(API_CACHE_NAME).then(cache => {
        cache.put(request, responseToCache);
      });
      
      // Сохраняем статус сессии
      if (request.url.includes('/api/check_session')) {
        const data = await response.clone().json();
        sessionStatus = data;
      }
    }
    
    return response;
  } catch (error) {
    // При ошибке сети пробуем получить из кэша
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Функция для проверки истечения сессии
async function checkSessionExpiration() {
  const clients = await self.clients.matchAll();
  const token = await getTokenFromClient();
  
  if (!token) return;
  
  try {
    const response = await fetch('/api/check_session', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.status === 401) {
      // Сессия истекла, уведомляем все вкладки
      clients.forEach(client => {
        client.postMessage({ type: 'SESSION_EXPIRED' });
      });
    }
  } catch (error) {
    console.error('Session check failed:', error);
  }
}

// Добавляем периодическую проверку сессии
setInterval(checkSessionExpiration, 10000);

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Пропускаем запросы к статическим файлам и логину
  if (url.pathname.startsWith('/static/') || url.pathname === '/login') {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
    return;
  }

  // Для API запросов используем специальную обработку
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(event.request));
    return;
  }

  // Проверяем истечение сессии для запросов к dashboard без перезагрузки страницы
  if (url.pathname === '/dashboard' || url.pathname === '/') {
    event.respondWith(
      (async () => {
        try {
          const token = await getTokenFromClient();
          if (!token) {
            return Response.redirect('/login', 302);
          }

          // Если нет необходимости в проверке сессии, просто возвращаем запрос
          if (Date.now() - lastSessionCheck < SESSION_CHECK_INTERVAL) {
            return fetch(event.request);
          }

          // Проверяем сессию, но не перезагружаем страницу
          const response = await fetch('/api/check_session', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (response.status === 401) {
            lastSessionCheck = Date.now();
            self.clients.matchAll().then(clients => {
              clients.forEach(client => {
                client.postMessage({ type: 'SESSION_EXPIRED' });
              });
            });
            return Response.redirect('/login', 302);
          }

          // Обновляем время последней проверки
          lastSessionCheck = Date.now();
          return fetch(event.request);
        } catch (error) {
          console.error('Error checking session:', error);
          return fetch(event.request);
        }
      })()
    );
    return;
  }

  // Все остальные запросы
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

async function getTokenFromClient() {
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    const token = await new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = e => resolve(e.data);
      client.postMessage({ type: 'GET_TOKEN' }, [channel.port2]);
    });
    if (token) return token;
  }
  return null;
}

// Очистка старого кэша при обновлении
async function cleanupOldCaches() {
  const cacheNames = await caches.keys();
  const validCacheNames = [CACHE_NAME, API_CACHE_NAME];
  return Promise.all(
    cacheNames
      .filter(cacheName => !validCacheNames.includes(cacheName))
      .map(cacheName => caches.delete(cacheName))
  );
}