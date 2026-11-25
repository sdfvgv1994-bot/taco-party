// taco 派對兔的 service worker：有網路就拿最新的，沒網路時至少打得開畫面（歌要有網路才能播）。
// 只處理這個網站自己的檔案；YouTube 的播放器、縮圖、歌名都直接連線，不經過這裡，也不存。
const PREFIX = 'taco-party';
const CACHE = PREFIX + '-v1';
const APP_SHELL = [
  './',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './core/event-bus.js',
  './core/store.js',
  './core/block-registry.js',
  './core/yt-core.js',
  './core/yt-api.js',
  './blocks/player-block.js',
  './blocks/playlist-importer-block.js',
  './blocks/queue-block.js',
  './blocks/party-room-block.js',
  './blocks/sleep-timer-block.js',
  './blocks/cue-points-block.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // 一個檔案存不到不影響其他檔案
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(APP_SHELL.map((u) => c.add(u)))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  const root = new URL('./', self.registration.scope);
  const isHome = req.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html');
  // 存的時候不看 ?v= 版本號，每個檔案只留最新的一份；首頁統一存在根目錄
  const key = isHome ? root.href : url.origin + url.pathname;

  event.respondWith(
    // no-cache：每次都跟網站確認有沒有新版（GitHub Pages 預設會讓瀏覽器用 10 分鐘的舊檔）
    // （打開頁面的請求不能直接加設定，要重新建一個）
    fetch(
      req.mode === 'navigate'
        ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        : new Request(req, { cache: 'no-cache' })
    )
      .then((res) => {
        const isHtml = (res.headers.get('content-type') || '').includes('text/html');
        if (res.ok && res.status === 200 && (!isHome || isHtml)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches
          .open(CACHE)
          .then((c) => c.match(key))
          .then((hit) => hit || Promise.reject(new Error('offline')))
      )
  );
});
