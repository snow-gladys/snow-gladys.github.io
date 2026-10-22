/* 本地资料先可用，联网刷新与离线网页准备均不阻塞播放器。 */
(function (root) {
    'use strict';
    const PREFIX = 'sg_builtin_catalog_v1:';
    const PATHS = ['songs.json', 'songs_live.json', 'catalogs/fiona.json', 'catalogs/fiona-live.json'];
    function online() { return !root.navigator || root.navigator.onLine !== false; }
    async function resource(url, options = {}) {
        const controller = new AbortController(), external = options.signal;
        let timer;
        const abort = () => controller.abort();
        if (external && external.aborted) abort();
        else if (external) external.addEventListener('abort', abort, { once: true });
        try {
            return await Promise.race([
                (async () => {
                    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
                    if (!response.ok) throw new Error('Resource unavailable: ' + response.status);
                    return options.type === 'text' ? await response.text() : await response.json();
                })(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        const error = new Error('读取超时，请检查网络后重试。'); error.name = 'TimeoutError';
                        reject(error); controller.abort();
                    }, options.timeout || 4000);
                }),
                new Promise((_, reject) => {
                    if (controller.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
                    else controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
                }),
            ]);
        } finally {
            clearTimeout(timer);
            if (external) external.removeEventListener('abort', abort);
        }
    }
    function clean(values) {
        if (!Array.isArray(values) || values.length > 5000) return null;
        if (values.some(item => !item || typeof item.bvid !== 'string' || !/^BV[0-9a-zA-Z]{10}$/.test(item.bvid) || typeof (item.name || item.title) !== 'string')) return null;
        return values.map(item => ({ bvid: item.bvid, name: String(item.name || item.title).slice(0, 300) }));
    }
    function catalogs(storage) {
        const inflight = new Map();
        return {
            read(path, fallback = []) {
                if (!PATHS.includes(path)) return fallback;
                try { return clean(JSON.parse(storage.getItem(PREFIX + path))) || fallback; } catch (_) { return fallback; }
            },
            refresh(path, changed) {
                if (!PATHS.includes(path) || !online()) return Promise.resolve(false);
                if (inflight.has(path)) return inflight.get(path);
                const pending = resource('./' + path).then(value => {
                    const songs = clean(value); if (!songs) return false;
                    const text = JSON.stringify(songs);
                    if (text.length > 256 * 1024) return false;
                    try { storage.setItem(PREFIX + path, text); } catch (_) {}
                    changed(songs); return true;
                }).catch(() => false).finally(() => inflight.delete(path));
                inflight.set(path, pending); return pending;
            },
        };
    }
    root.SG_OFFLINE = { resource, catalogs, online };
    if (!root.document || !root.navigator || !root.navigator.serviceWorker) return;
    function initialize() {
        const status = document.getElementById('offline-status');
        const message = text => { if (status) status.textContent = text; };
        let registering = null;
        function register() {
            if (registering) return registering;
            message('正在准备离线网页，播放器可照常使用。');
            const task = online() ? navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }) : navigator.serviceWorker.getRegistration('./');
            registering = task.then(registration => {
                if (!registration) { registering = null; message('离线网页尚未准备完成，下次联网时会重试。'); return; }
                function sync() {
                    message(registration.active ? registration.waiting ? '网页离线可用，新版本将在关闭所有页面后启用。' : '网页已保存，可离线打开；歌曲需先缓存音频。' : '正在保存网页资源，播放器可照常使用。');
                }
                function watch(worker) {
                    if (worker) worker.addEventListener('statechange', () => {
                        if (worker.state === 'redundant' && !registration.active) {
                            registering = null; message('离线网页尚未保存完成，下次联网时会重试。');
                        } else sync();
                    });
                }
                watch(registration.installing); registration.addEventListener('updatefound', () => { watch(registration.installing); sync(); });
                sync(); return registration;
            }).catch(() => { registering = null; message('离线网页尚未准备完成，下次联网时会重试。'); });
            return registering;
        }
        register(); root.addEventListener('online', () => { register().then(registration => { if (registration) registration.update().catch(() => {}); }); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})(window);
