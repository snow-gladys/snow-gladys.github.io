/* 只缓存播放器网页与已读取的内置歌词；音频仍由 IndexedDB 管理。 */
importScripts('./offline-assets.js');
const SHELL_PREFIX = 'sg-player-shell-', CACHE = SHELL_PREFIX + self.SG_OFFLINE_ASSETS.version;
const LYRICS = 'sg-player-lyrics-v1', ROOT = self.registration.scope;
const HOME = new URL('./index.html', ROOT).href;
const ASSETS = new Set(self.SG_OFFLINE_ASSETS.paths.map(path => new URL(path, ROOT).href));
const CATALOGS = new Set(['songs.json', 'songs_live.json', 'catalogs/fiona.json', 'catalogs/fiona-live.json'].map(path => new URL(path, ROOT).href));
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        try { await cache.addAll([...ASSETS].map(url => new Request(url, { cache: 'no-cache' }))); }
        catch (error) { await caches.delete(CACHE); throw error; }
        // 不强制接管旧页面；避免播放中换成一半新、一半旧的代码。
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) if (name.startsWith(SHELL_PREFIX) && name !== CACHE) await caches.delete(name);
        await self.clients.claim();
    })());
});
async function network(request) {
    const controller = new AbortController();
    let timer;
    try {
        return await Promise.race([
            fetch(request, { signal: controller.signal }),
            new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error('Offline resource timeout')); controller.abort(); }, 3500); }),
        ]);
    } finally { clearTimeout(timer); }
}
async function staticResource(request, event, catalog) {
    const cache = await caches.open(CACHE), saved = await cache.match(request);
    if (saved && !catalog) return saved;
    // 曲库先交回本地副本；后台更新不会拖慢界面或等待网络超时。
    const refresh = network(request).then(async response => {
        if (response.ok) await cache.put(request, response.clone());
        return response;
    });
    if (saved) { event.waitUntil(refresh.catch(() => {})); return saved; }
    try { return await refresh; } catch (_) { return Response.error(); }
}
async function lyricResource(request, event) {
    const cache = await caches.open(LYRICS), saved = await cache.match(request);
    async function refresh() {
        const response = await network(request);
        const size = Number(response.headers.get('Content-Length') || 0);
        if (response.ok && size <= 256 * 1024) {
            const text = await response.clone().text();
            if (text.length <= 128 * 1024) {
                try {
                    await cache.put(request, response.clone());
                    const keys = await cache.keys();
                    for (const key of keys.slice(0, Math.max(0, keys.length - 128))) await cache.delete(key);
                } catch (_) { /* 存储已满也交回在线歌词。 */ }
            }
        }
        return response;
    }
    if (saved) {
        if (!self.navigator || self.navigator.onLine !== false) event.waitUntil(refresh().catch(() => {}));
        return saved;
    }
    try { return await refresh(); } catch (_) { return Response.error(); }
}
self.addEventListener('fetch', event => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== 'GET' || request.headers.has('Range') || url.origin !== self.location.origin) return;
    if (request.mode === 'navigate' && (url.pathname === new URL(ROOT).pathname || url.pathname === new URL(HOME).pathname)) {
        event.respondWith(caches.open(CACHE).then(async cache => await cache.match(HOME) || await network(request)).catch(() => Response.error()));
    } else if (ASSETS.has(url.href)) event.respondWith(staticResource(request, event, CATALOGS.has(url.href)));
    else if (url.href.startsWith(new URL('./lyrics/', ROOT).href) && /\.(?:lrc|json)$/i.test(url.pathname)) event.respondWith(lyricResource(request, event));
});
