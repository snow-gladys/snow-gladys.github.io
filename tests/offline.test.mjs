import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const A = 'BV17uZQBHEDo', B = 'BV1Sf421Q7Rt';
function memory() {
    const rows = new Map();
    return { getItem: key => rows.get(key) || null, setItem: (key, value) => rows.set(key, value), rows };
}
function offline(fetch, extra = {}) {
    const window = { navigator: { onLine: true } };
    const sandbox = vm.createContext({ window, fetch, AbortController, DOMException, setTimeout, clearTimeout, ...extra });
    vm.runInContext(read('offline.js'), sandbox);
    return { api: window.SG_OFFLINE, window, sandbox };
}
test('local catalog snapshots remain immediately readable while a network request hangs', async () => {
    const local = memory(); let expire;
    const { api } = offline(() => new Promise(() => {}), { setTimeout(fn) { expire = fn; }, clearTimeout() {} });
    local.setItem('sg_builtin_catalog_v1:songs.json', JSON.stringify([{ bvid: A, name: '本地标题' }]));
    const catalog = api.catalogs(local);
    const pending = catalog.refresh('songs.json', () => assert.fail('timeout cannot replace the saved catalog'));
    assert.equal(catalog.read('songs.json')[0].name, '本地标题');
    expire(); assert.equal(await pending, false);
    assert.equal(catalog.read('songs.json')[0].name, '本地标题');
});
test('independent catalogs update without waiting for another failed source, and survive reload', async () => {
    const local = memory(), timers = [], changed = [];
    const { api } = offline(url => url.includes('songs.json') ? new Promise(() => {}) : Promise.resolve(new Response(JSON.stringify([{ bvid: B, name: '心宜歌库' }]))), { setTimeout(fn) { timers.push(fn); }, clearTimeout() {} });
    const catalog = api.catalogs(local), first = catalog.refresh('songs.json', () => assert.fail('pending source'));
    const second = catalog.refresh('catalogs/fiona.json', songs => changed.push(songs));
    assert.equal(await second, true); assert.equal(changed[0][0].name, '心宜歌库');
    assert.equal(api.catalogs(local).read('catalogs/fiona.json')[0].bvid, B);
    timers[0](); assert.equal(await first, false);
});
test('offline startup does not request catalog updates, and storage failures retain in-memory updates', async () => {
    const { api, window } = offline(() => assert.fail('offline must not request a catalog'));
    window.navigator.onLine = false;
    assert.equal(await api.catalogs(null).refresh('songs.json', () => assert.fail('no update')), false);
    assert.equal(api.catalogs(null).read('songs.json', ['fallback'])[0], 'fallback');
    const online = offline(() => Promise.resolve(new Response(JSON.stringify([{ bvid: A, name: '可使用' }]))));
    let value;
    assert.equal(await online.api.catalogs(null).refresh('songs.json', songs => { value = songs; }), true);
    assert.equal(value[0].name, '可使用');
});
test('malformed upstream data never replaces a valid saved catalog', async () => {
    const local = memory(); local.setItem('sg_builtin_catalog_v1:songs.json', JSON.stringify([{ bvid: A, name: '原曲库' }]));
    for (const bad of [{ error: true }, [{ bvid: 'bad', name: '错误' }], [{ bvid: A, name: 123 }]]) {
        const { api } = offline(() => Promise.resolve(new Response(JSON.stringify(bad))));
        assert.equal(await api.catalogs(local).refresh('songs.json', () => assert.fail('invalid update')), false);
        assert.equal(api.catalogs(local).read('songs.json')[0].name, '原曲库');
    }
});
test('resource deadline covers both stalled headers and stalled bodies and releases requests', async () => {
    for (const body of [false, true]) {
        let expire, signal, cleared = false;
        const { api } = offline((_, options) => {
            signal = options.signal;
            return body ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) }) : new Promise(() => {});
        }, { setTimeout(fn) { expire = fn; return 5; }, clearTimeout(id) { cleared = id === 5; } });
        const pending = api.resource('/data'); expire();
        await assert.rejects(pending, { name: 'TimeoutError' });
        assert.equal(signal.aborted, true); assert.equal(cleared, true);
    }
});
test('external cancellation stops resource loading without waiting for a timeout', async () => {
    const { api } = offline(() => new Promise(() => {}));
    const controller = new AbortController(), pending = api.resource('/data', { signal: controller.signal });
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});

function worker(fetch, { writeFailure = false } = {}) {
    const listeners = {}, stores = new Map(), prefix = 'https://player.example/';
    const url = key => typeof key === 'string' ? key : key.url;
    const caches = {
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const rows = stores.get(name);
            return {
                async addAll(requests) { for (const request of requests) { const response = await fetch(request); if (!response.ok) throw new Error('Install failed'); rows.set(url(request), response.clone()); } },
                async match(key) { return rows.get(url(key))?.clone(); },
                async put(key, value) { if (writeFailure) throw new Error('QuotaExceededError'); rows.set(url(key), value.clone()); },
                async keys() { return [...rows.keys()].map(key => new Request(key)); },
                async delete(key) { return rows.delete(url(key)); },
            };
        },
        async keys() { return [...stores.keys()]; }, async delete(key) { return stores.delete(key); },
    };
    const self = { SG_OFFLINE_ASSETS: { version: 'test', paths: ['./index.html', './index.js?v=test', './songs.json'] },
        registration: { scope: prefix }, location: { origin: new URL(prefix).origin }, clients: { async claim() {} },
        addEventListener(type, fn) { listeners[type] = fn; } };
    const context = vm.createContext({ self, importScripts() {}, caches, fetch, URL, Request, Response, AbortController, setTimeout, clearTimeout });
    vm.runInContext(read('sw.js'), context);
    return { stores, async install() { let work; listeners.install({ waitUntil(promise) { work = promise; } }); await work; },
        async activate() { let work; listeners.activate({ waitUntil(promise) { work = promise; } }); await work; },
        async request(path, options = {}) {
            const request = new Request(prefix + path, options), tasks = [];
            if (options.navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
            let response;
            listeners.fetch({ request, waitUntil(promise) { tasks.push(promise); }, respondWith(promise) { response = promise; } });
            return { response: await response, tasks };
        },
    };
}
test('offline navigation with launch parameters and exact script versions use the saved shell without a network', async () => {
    let connected = true, requests = 0;
    const sw = worker(async request => { requests++; if (!connected) throw new Error('offline'); return new Response(request.url.includes('index.html') ? 'player shell' : 'script'); });
    await sw.install(); connected = false; const before = requests;
    assert.equal(await (await sw.request('?source=homescreen', { navigate: true })).response.text(), 'player shell');
    assert.equal(await (await sw.request('index.js?v=test')).response.text(), 'script');
    assert.equal(requests, before);
    assert.equal((await sw.request('index.js?v=other')).response, undefined);
    assert.equal((await sw.request('songs.json', { headers: { Range: 'bytes=0-5' } })).response, undefined);
    assert.equal((await sw.request('api/resolve')).response, undefined);
});
test('a cached catalog returns before an unresponsive background refresh and failed installs leave no partial shell', async () => {
    let hang = false;
    const sw = worker(async () => { if (hang) return new Promise(() => {}); return new Response('saved'); });
    await sw.install(); hang = true;
    const result = await sw.request('songs.json'); assert.equal(await result.response.text(), 'saved');
    // Background task is deliberately not awaited; the resource deadline cleans it up.
    const failed = worker(async request => new Response('unavailable', { status: request.url.includes('index.js') ? 503 : 200 }));
    await assert.rejects(failed.install()); assert.equal(failed.stores.size, 0);
});
test('previously read built-in lyrics remain usable offline, without caching arbitrary application requests', async () => {
    let connected = true;
    const sw = worker(async () => { if (!connected) throw new Error('offline'); return new Response('[00:01]已缓存歌词'); });
    assert.match(await (await sw.request('lyrics/song.lrc')).response.text(), /已缓存歌词/);
    connected = false;
    assert.match(await (await sw.request('lyrics/song.lrc')).response.text(), /已缓存歌词/);
    assert.equal((await sw.request('tools/lyric-proxy.js')).response, undefined);
});
test('storage quota failures do not prevent usable online lyrics from being returned', async () => {
    const sw = worker(async () => new Response('[00:01]在线歌词'), { writeFailure: true });
    assert.match(await (await sw.request('lyrics/song.lrc')).response.text(), /在线歌词/);
});
test('activating an updated shell only removes old player shell caches', async () => {
    const sw = worker(async () => new Response('current'));
    await sw.install(); sw.stores.set('sg-player-shell-old', new Map());
    for (const key of ['sg-player-lyrics-v1', 'unrelated-cache']) sw.stores.set(key, new Map());
    await sw.activate();
    assert.equal(sw.stores.has('sg-player-shell-old'), false);
    for (const key of ['sg-player-shell-test', 'sg-player-lyrics-v1', 'unrelated-cache']) assert.equal(sw.stores.has(key), true);
});
test('offline chapter navigation uses stale saved chapters immediately and never starts a request', async () => {
    const local = memory();
    local.setItem('sg_video_chapters_v1', JSON.stringify([{ key: A, savedAt: 1, chapters: [{ name: '副歌', start: 10, end: 30 }] }]));
    const { window, sandbox } = offline(() => assert.fail('offline chapter directory must not fetch'));
    window.navigator.onLine = false;
    vm.runInContext(read('bili-api.js'), sandbox); vm.runInContext(read('playback-chapters.js'), sandbox);
    const store = window.SG_PLAYBACK_CHAPTERS.createStore({ storage: local, client: { chapters() { assert.fail('offline request'); } } });
    assert.equal((await store.chapters(A, { force: true })).chapters[0].name, '副歌');
    await assert.rejects(store.chapters(B), /离线/);
});
test('local library initialization exposes stored songs before any catalog request settles', () => {
    const player = read('index.js'), start = player.indexOf('        function loadSongs()'), end = player.indexOf('\n        function syncSettingsToggles()', start);
    const local = memory(); local.setItem('sg_builtin_catalog_v1:catalogs/fiona.json', JSON.stringify([{ bvid: B, name: '本地心宜' }]));
    const { api } = offline(() => new Promise(() => {}), { setTimeout() { return 1; }, clearTimeout() {} });
    let built = 0;
    const context = vm.createContext({ window: { SG_OFFLINE: api, SG_PERSONAL: { songs: values => values }, addEventListener() {} }, libraryStorage: local,
        getCustomFromStorage: () => [{ bvid: A, name: '我的歌' }], buildSongList() { built++; }, renderPlaylist() {}, runInitialPreload() {},
        legacyMigrationError: '', personalLibrary: {}, catalogPlaylists: [], mainList: [], liveList: [], customList: [] });
    vm.runInContext(player.slice(start, end), context); context.loadSongs();
    assert.equal(built, 1); assert.equal(context.customList[0].name, '我的歌'); assert.equal(context.mainList.at(-1).name, '本地心宜');
});
test('offline next-song and queue selection skip tracks whose audio has not been cached', () => {
    const player = read('index.js'), context = vm.createContext({ navigator: { onLine: false }, songList: [{ bvid: A }, { bvid: B }], cachedBvidsSet: new Set([B]),
        playScope: 'all', playbackPlaylistId: '', listeningLibrary: { list: () => [{ bvid: A }, { bvid: B }] } });
    for (const [start, end] of [['function getEffectiveList()', '/** 在当前模式列表中的下标'], ['function getQueuedNext()', 'function syncLibraryTabs()']]) {
        vm.runInContext(player.slice(player.indexOf(start), player.indexOf(end, player.indexOf(start))), context);
    }
    assert.deepEqual(Array.from(context.getEffectiveList(), song => song.bvid), [B]); assert.equal(context.getQueuedNext().bvid, B);
});
test('offline asset manifest contains the current files and versions', () => {
    execFileSync(process.execPath, ['scripts/build-offline-manifest.mjs', '--check'], { cwd: new URL('../', import.meta.url) });
});
