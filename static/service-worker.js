const CACHE_NAME = 'gallery-v2';
const API_CACHE_NAME = 'api-cache-v1';
const ASSETS = [
  '/',
  '/login',
  '/static/styles.css',
  '/static/script.js',
  '/static/icon.png',
  '/static/manifest.json'
];

// Добавляем состояние сессии
let lastSessionCheck = Date.now();
const SESSION_CHECK_INTERVAL = 60 * 1000; // 1 минута
let sessionStatus = null;
let authToken = null;

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
  const token = await getTokenFromClient();
  
  // Добавляем токен к запросу, если он есть
  if (token && !request.headers.has('Authorization')) {
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Authorization', `Bearer ${token}`);
    request = new Request(request.url, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      mode: request.mode,
      credentials: request.credentials,
      cache: request.cache,
      redirect: request.redirect,
      referrer: request.referrer,
      integrity: request.integrity
    });
  }
  
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
// Функция для получения токена из клиентского хранилища
async function getTokenFromClient() {
  const clients = await self.clients.matchAll();
  if (clients.length === 0) return null;
  
  // Запрашиваем токен у первого активного клиента
  const response = await clients[0].evaluate(() => {
    return localStorage.getItem('auth_token');
  });
  
  return response;
}

setInterval(checkSessionExpiration, 60 * 1000); // Проверяем каждую минуту

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

  // Проверяем истечение сессии для всех запросов к dashboard
  if (url.pathname === '/dashboard' || url.pathname === '/') {
    event.respondWith(
      (async () => {
        try {
          await checkSessionExpiration();
          const token = await getTokenFromClient();
          if (!token) {
            return Response.redirect('/login', 302);
          }

          // Проверяем сессию только если прошло достаточно времени
          if (Date.now() - lastSessionCheck >= SESSION_CHECK_INTERVAL) {
            const response = await fetch('/api/check_session', {
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            if (response.status === 401) {
              self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                  client.postMessage({ type: 'SESSION_EXPIRED' });
                });
              });
              return Response.redirect('/login', 302);
            }
          }

          return fetch(event.request);
        } catch (error) {
          console.error('Error checking session:', error);
          return fetch(event.request);
        }
      })()
    );
    return;
  }
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