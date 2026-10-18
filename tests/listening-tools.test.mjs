import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const context = vm.createContext({ AbortController, setTimeout, clearTimeout, fetch });
vm.runInContext(read('listening-library.js') + '\n' + read('favorites-cache.js'), context);
const A = { bvid: 'BV1Sf421Q7Rt', name: '探窗' };
const B = { bvid: 'BV1Cn4y1o7yG', name: '如果可以' };
const C = { bvid: 'BV1SM4m1U7SL', name: '天空没有极限' };
const plain = value => JSON.parse(JSON.stringify(value));
function storage() {
    const data = new Map();
    return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
const library = (store = storage(), key = 'library') => context.SG_LISTENING.create({ storage: store, key });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await tick(); } assert.fail('async task did not settle'); }

test('next/append queues deduplicate, reorder, remove, and restore without changing the original playback anchor', () => {
    const store = storage(), lib = library(store);
    assert.equal(lib.add(B), true); lib.add(C); lib.add(C, true);
    assert.deepEqual(plain(lib.list('queue').map(song => song.bvid)), [C.bvid, B.bvid]);
    const first = lib.list('queue')[0]; lib.move(first.id, 1);
    assert.deepEqual(plain(lib.list('queue').map(song => song.bvid)), [B.bvid, C.bvid]);
    lib.startQueued(lib.list('queue')[0].id, A.bvid);
    assert.equal(lib.anchor, A.bvid); assert.equal(lib.list('queue').length, 1);
    const restored = library(store);
    restored.startQueued(restored.list('queue')[0].id, B.bvid);
    assert.equal(restored.anchor, A.bvid);
    assert.equal(restored.list('queue').length, 0);
    restored.leaveQueue(); assert.equal(restored.anchor, null);
});

test('failed or canceled queue selection cannot consume another pending entry', () => {
    const lib = library(); lib.add(A); lib.add(B);
    lib.startQueued('stale-id', C.bvid);
    assert.equal(lib.list('queue').length, 2); assert.equal(lib.anchor, null);
    lib.remove(lib.list('queue')[0].id);
    assert.equal(lib.list('queue')[0].bvid, B.bvid);
    lib.clearQueue(); assert.equal(lib.list('queue').length, 0);
});

test('recent playback is unique, newest-first, capped at 100, and retained across page loads and sites', () => {
    const store = storage(), lib = library(store);
    for (let i = 0; i < 110; i++) lib.record({ bvid: 'BV' + String(i).padStart(10, '0'), name: '歌' + i }, i + 1);
    assert.equal(lib.list('recent').length, 100);
    lib.record(A, 500); lib.record(A, 600);
    const restored = library(store);
    assert.equal(restored.list('recent').length, 100);
    assert.equal(restored.list('recent')[0].playedAt, 600);
    assert.equal(restored.list('recent')[0].name, A.name);
    assert.equal(library(store, 'fiona').list('recent').length, 0);
    restored.clearRecent(); assert.equal(restored.list('recent').length, 0);
});

test('random exclusions persist and can be restored independently of favorites and explicit queued playback', () => {
    const store = storage(), lib = library(store);
    lib.exclude(A, true); lib.exclude(A, true);
    assert.equal(lib.list('excluded').length, 1);
    assert.equal(library(store).isExcluded(A.bvid), true);
    lib.add(A); assert.equal(lib.list('queue')[0].bvid, A.bvid);
    lib.exclude(A, false); assert.equal(lib.isExcluded(A.bvid), false);
});

test('corrupt storage and unavailable storage retain usable in-memory functionality', () => {
    const lib = library({ getItem: () => '{bad', setItem() { throw Error('quota'); } });
    lib.add(A); lib.record(A); lib.exclude(A, true);
    assert.equal(lib.list('queue').length, 1); assert.equal(lib.isExcluded(A.bvid), true);
    assert.equal(lib.add({ bvid: 'AV123', name: 'bad' }), false);
    const restored = library({ getItem: () => JSON.stringify({ queue: [null, A, A, { bvid: '<script>' }], recent: 'bad' }), setItem() {} });
    assert.equal(restored.list('queue').length, 1); assert.equal(restored.list('recent').length, 0);
});

function task(overrides = {}) {
    const resolves = [], saved = [], changes = [];
    const runner = context.SG_FAVORITES_CACHE.create({
        storage: storage(), key: 'cache', has: async () => false,
        resolve: async (bvid, mode) => { resolves.push([bvid, mode]); return 'https://edge.example/proxy?bvid=' + bvid; },
        fetch: async () => new Response('real audio'), save: async (bvid, blob) => { saved.push([bvid, blob.size]); return true; },
        onChange: value => changes.push(plain(value)), ...overrides,
    });
    return { runner, resolves, saved, changes };
}

test('batch cache is serial, skips existing cache, snapshots quality, and reports committed successes', async () => {
    let inFlight = 0, peak = 0;
    const { runner, resolves, saved } = task({ has: async id => id === A.bvid,
        fetch: async () => { inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--; return new Response('audio'); },
    });
    runner.start([A, B, C, C], 'high');
    await until(() => runner.snapshot().state === 'complete');
    assert.equal(peak, 1); assert.equal(runner.snapshot().done, 3);
    assert.deepEqual(resolves, [[B.bvid, 'high'], [C.bvid, 'high']]);
    assert.equal(saved.length, 2);
});

test('pause aborts a resolving request and resumes the same pending song with a fresh URL', async () => {
    let aborted = false, calls = 0;
    const { runner, saved } = task({ resolve: async (_id, _mode, signal) => {
        calls++; if (calls > 1) return 'fresh';
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('abort', 'AbortError')); }));
    } });
    runner.start([A, B], 'medium'); await until(() => calls === 1);
    runner.pause(); runner.resume();
    await until(() => runner.snapshot().state === 'complete');
    assert.equal(aborted, true); assert.equal(calls, 3);
    assert.equal(saved.length, 2);
});

test('paused partial downloads never save; progress and the remaining task restore without auto-starting', async () => {
    const store = storage(); let partial;
    const { runner, saved } = task({ storage: store,
        fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
            partial = true; signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')));
        }),
    });
    runner.start([A, B], 'low'); await until(() => partial);
    runner.pause(); await tick();
    assert.equal(saved.length, 0);
    const restored = task({ storage: store }).runner;
    assert.equal(restored.snapshot().state, 'paused');
    assert.equal(restored.snapshot().items[0].status, 'pending');
    restored.resume(); await until(() => restored.snapshot().state === 'complete');
    assert.equal(restored.snapshot().done, 2);
});

test('network failure keeps the item visible and retry only processes failed tracks', async () => {
    let fail = true;
    const { runner, resolves } = task({ fetch: async url => url.includes(A.bvid) && fail ? new Response('error', { status: 503 }) : new Response('audio') });
    runner.start([A, B], 'medium'); await until(() => runner.snapshot().state === 'complete');
    assert.equal(runner.snapshot().failed, 1); assert.equal(runner.snapshot().done, 1);
    fail = false; runner.retry(); await until(() => runner.snapshot().state === 'complete');
    assert.equal(runner.snapshot().failed, 0); assert.equal(runner.snapshot().done, 2);
    assert.deepEqual(resolves.map(([id]) => id), [A.bvid, B.bvid, A.bvid]);
});

test('storage failures and upstream rate limits pause the task before fetching more tracks', async () => {
    for (const scenario of ['quota', 'risk']) {
        const { runner, resolves } = task(scenario === 'quota' ? { save: async () => false } : {
            resolve: async () => { throw Object.assign(Error('请稍后重试'), { code: 'BILI_RISK_CONTROL' }); },
        });
        runner.start([A, B], 'medium'); await until(() => runner.snapshot().state === 'paused');
        assert.equal(runner.snapshot().failed, 1); assert.equal(runner.snapshot().items[1].status, 'pending');
        assert.ok(resolves.length <= 1);
    }
});

test('waiting for playback buffering neither downloads nor repeatedly writes storage', async () => {
    let allowed = false;
    const { runner, changes, resolves } = task({ canDownload: () => allowed });
    runner.start([A], 'medium');
    const count = changes.length;
    for (let i = 0; i < 100; i++) runner.notify();
    assert.equal(changes.length, count); assert.equal(resolves.length, 0);
    allowed = true; runner.notify(); await until(() => runner.snapshot().state === 'complete');
    assert.equal(runner.snapshot().done, 1);
});

test('buffer pressure pauses an active background download; cancellation cannot restart it', async () => {
    let allowed = true, begun = false;
    const { runner, saved } = task({ canDownload: () => allowed,
        fetch: async (_url, { signal }) => new Promise((_resolve, reject) => { begun = true; signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))); }),
    });
    runner.start([A], 'medium'); await until(() => begun);
    allowed = false; runner.notify();
    assert.equal(runner.snapshot().state, 'paused');
    runner.cancel(); await tick();
    allowed = true; runner.notify();
    assert.equal(runner.snapshot().state, 'idle'); assert.equal(saved.length, 0);
});

test('automatic next respects queue priority and returns to the original list or single-repeat anchor', () => {
    const player = read('index.js');
    for (const order of ['list', 'single']) {
        const lib = library(); lib.add(C);
        const scope = vm.createContext({ currentPlayingBvid: A.bvid, playMode: order, listeningLibrary: lib,
            getQueuedNext: () => lib.list('queue')[0], getEffectiveList: () => [A, B, C],
        });
        const start = player.indexOf('function getNextBvid()');
        vm.runInContext(player.slice(start, player.indexOf('function clearPreload()', start)), scope);
        assert.equal(scope.getNextBvid(), C.bvid);
        lib.startQueued(lib.list('queue')[0].id, A.bvid); scope.currentPlayingBvid = C.bvid;
        assert.equal(scope.getNextBvid(), order === 'list' ? B.bvid : A.bvid);
    }
});

test('random exclusions affect automatic selection while explicit queue entries remain playable', () => {
    const player = read('index.js'), lib = library(); lib.exclude(B, true);
    const scope = vm.createContext({ listeningLibrary: lib, getEffectiveList: () => [A, B, C] });
    const start = player.indexOf('function getRandomList()');
    vm.runInContext(player.slice(start, player.indexOf('function syncLibraryTabs()', start)), scope);
    assert.deepEqual(plain(scope.getRandomList().map(song => song.bvid)), [A.bvid, C.bvid]);
    lib.add(B); assert.equal(lib.list('queue')[0].bvid, B.bvid);
});

test('both sites load listening tools and expose the same library, queue actions, and cache controls', () => {
    for (const file of ['index.html', 'fiona/index.html']) {
        const html = read(file);
        assert.ok(html.indexOf('listening-library.js?') < html.indexOf('index.js?'));
        assert.ok(html.indexOf('favorites-cache.js?') < html.indexOf('index.js?'));
        assert.equal((html.match(/data-library-tab=/g) || []).length, 4);
        for (const id of ['bulk-cache-start', 'bulk-cache-pause', 'bulk-cache-resume', 'bulk-cache-retry', 'song-actions-dialog']) assert.ok(html.includes('id="' + id + '"'));
    }
});

test('starting with a queue and no prior song does not invent a return anchor mid-queue', () => {
    const lib = library(); lib.add(A); lib.add(B);
    lib.startQueued(lib.list('queue')[0].id, '');
    lib.startQueued(lib.list('queue')[0].id, A.bvid);
    assert.equal(lib.anchor, null);
    lib.leaveQueue(); lib.add(C); lib.startQueued(lib.list('queue')[0].id, B.bvid);
    assert.equal(lib.anchor, B.bvid);
});

test('consecutive network failures stop a large batch and leave remaining tracks pending', async () => {
    const { runner } = task({ fetch: async () => new Response('offline', { status: 503 }) });
    runner.start([A, B, C, { bvid: 'BV1E1421b7h9', name: '第四首' }], 'medium');
    await until(() => runner.snapshot().state === 'paused');
    assert.equal(runner.snapshot().failed, 3); assert.equal(runner.snapshot().items[3].status, 'pending');
    runner.cancel();
});
