import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const player = read('index.js');
function setup(fetch = () => assert.fail('unexpected download')) {
    const window = {};
    vm.runInNewContext(read('playback-buffer.js'), { window, fetch, AbortController });
    return window.SG_PLAYBACK_BUFFER;
}
function audio() {
    const audio = new EventTarget();
    Object.assign(audio, { currentTime: 0, duration: 60, paused: false, ranges: [[0,4]] });
    audio.buffered = { get length() { return audio.ranges.length; }, start: i => audio.ranges[i][0], end: i => audio.ranges[i][1] };
    return audio;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('buffered-ahead measurement does not count a future range across a gap', () => {
    const api = setup(), a = audio(); a.currentTime = 10;
    a.ranges = [[0,5],[20,30]]; assert.equal(api.ahead(a),0);
    a.ranges = [[0,5],[8,30]]; assert.equal(api.ahead(a),20);
    a.ranges = []; assert.equal(api.ahead(a),0);
});

test('next-track preload starts in the last 30 seconds only when current audio is buffered', () => {
    const api = setup(), a = audio();
    a.currentTime = 20; a.ranges = [[0,60]]; assert.equal(api.shouldPreload(a,30),false);
    a.currentTime = 31; a.ranges = [[0,35]]; assert.equal(api.shouldPreload(a,30),false);
    a.ranges = [[0,40]]; assert.equal(api.shouldPreload(a,30),true);
    a.paused = true; assert.equal(api.shouldPreload(a,30),false);
    a.paused = false; a.currentTime = 58; a.ranges = [[0,60]]; assert.equal(api.shouldPreload(a,30),true);
    a.currentTime = 60; assert.equal(api.shouldPreload(a,30),false);
});

test('offline download waits for safe playback buffer and runs only once', async () => {
    let downloads = 0, saved = 0, marked = 0;
    const api = setup(async () => { downloads++; return new Response('audio'); }), a = audio();
    api.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => true, save: async blob => { assert.equal(await blob.text(),'audio'); saved++; }, onSaved: () => { marked++; } });
    await tick(); assert.equal(downloads,0);
    a.ranges = [[0,25]]; a.dispatchEvent(new Event('progress')); a.dispatchEvent(new Event('timeupdate'));
    await tick(); assert.equal(downloads,1); assert.equal(saved,1); assert.equal(marked,1);
    a.dispatchEvent(new Event('progress')); await tick(); assert.equal(downloads,1);
});

test('short fully buffered audio can be cached without waiting for 20 seconds', async () => {
    let downloads = 0;
    const api = setup(async () => { downloads++; return new Response('audio'); }), a = audio();
    a.duration = 8; a.ranges = [[0,8]];
    api.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => true, save: async () => {} });
    await tick(); assert.equal(downloads,1);
});

test('pausing permits a queued cache download while resumed playback takes priority', async () => {
    let signal, saved = false;
    const api = setup((_, options) => {
        signal = options.signal;
        return new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled','AbortError'))));
    }), a = audio();
    api.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => true, save: async () => { saved = true; } });
    a.paused = true; a.dispatchEvent(new Event('pause')); assert.ok(signal); assert.equal(signal.aborted,false);
    a.paused = false; a.dispatchEvent(new Event('timeupdate')); assert.equal(signal.aborted,true);
    await tick(); assert.equal(saved,false);
});

test('a stalling player aborts an active background download and does not restart it', async () => {
    let signal, downloads = 0;
    const api = setup((_,options) => {
        downloads++; signal = options.signal;
        return new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled','AbortError'))));
    }), a = audio(); a.ranges = [[0,25]];
    api.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => true, save: async () => assert.fail('aborted cache must not save') });
    a.currentTime = 23; a.dispatchEvent(new Event('waiting')); assert.equal(signal.aborted,true);
    a.ranges = [[0,60]]; a.dispatchEvent(new Event('progress')); await tick(); assert.equal(downloads,1);
});

test('switching songs cancels a waiting job and blocks a late completed download', async () => {
    let downloads = 0, finish, current = true;
    const api = setup(() => { downloads++; return new Promise(resolve => { finish = resolve; }); }), a = audio();
    const cancel = api.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => current, save: async () => assert.fail('stale download must not save') });
    cancel(); a.ranges = [[0,60]]; a.dispatchEvent(new Event('progress')); await tick(); assert.equal(downloads,0);
    api.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => current, save: async () => assert.fail('stale download must not save') });
    current = false; a.dispatchEvent(new Event('timeupdate')); finish(new Response('late audio'));
    await tick(); assert.equal(downloads,1);
});

test('cache errors remain silent and clean up their listeners', async () => {
    let downloads = 0;
    const api = setup(async () => { downloads++; return new Response('unavailable',{status:503}); }), a = audio();
    a.ranges = [[0,60]];
    api.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => true, save: async () => assert.fail('failed cache must not save') });
    await tick(); a.dispatchEvent(new Event('progress')); await tick(); assert.equal(downloads,1);
});

test('a failed storage commit never marks a song as downloaded', async () => {
    const api = setup(async () => new Response('audio')), a = audio(); a.ranges = [[0,60]];
    api.cacheWhenBuffered({ audio:a, url:'audio', isCurrent:()=>true, save:async()=>false,
        onSaved:()=>assert.fail('failed storage must not appear as a download') });
    await tick();
});

test('first home random play reuses the prepared song but later clicks remain random', () => {
    let randomCalls = 0;
    const sandbox = vm.createContext({ listeningLibrary: { isExcluded: () => false }, currentPlayingBvid: '', initialPreloadBvid: 'B', initialPreloadForResume: false, songList: [{bvid:'A'},{bvid:'B'}], randomQueue: { peekNext: () => { randomCalls++; return 'A'; } } });
    const start = player.indexOf('function getHomeRandomBvid()');
    const end = player.indexOf('function runInitialPreload()', start);
    vm.runInContext(player.slice(start,end),sandbox);
    assert.equal(sandbox.getHomeRandomBvid(),'B'); assert.equal(randomCalls,0);
    sandbox.currentPlayingBvid = 'B'; assert.equal(sandbox.getHomeRandomBvid(),'A'); assert.equal(randomCalls,1);
    sandbox.currentPlayingBvid = ''; sandbox.initialPreloadForResume = true; assert.equal(sandbox.getHomeRandomBvid(),'A');
    sandbox.initialPreloadForResume = false; sandbox.initialPreloadBvid = 'removed'; assert.equal(sandbox.getHomeRandomBvid(),'A');
});

test('downloaded mode advances within downloaded songs and never preloads from the network', () => {
    const played = [];
    const sandbox = vm.createContext({ liveRadio: null, listeningLibrary: { anchor: null }, getQueuedNext: () => null, playMode: 'list', playScope: 'downloaded', currentPlayingBvid: 'A', songList: [{bvid:'A'},{bvid:'B'},{bvid:'C'}],
        getEffectiveList: () => [{bvid:'A'},{bvid:'C'}], getCurrentIndexInEffectiveList: () => 0, getCurrentIndex: () => 0,
        playMusic: bvid => played.push(bvid), fetchResolveViaProxy: () => assert.fail('downloaded mode must not preload'),
    });
    vm.runInContext(player.slice(player.indexOf('function getNextBvid()'),player.indexOf('function clearPreload()')),sandbox);
    vm.runInContext(player.slice(player.indexOf('function tryPreloadNext()'),player.indexOf('/** 提前准备下一首')),sandbox);
    vm.runInContext(player.slice(player.indexOf('function playNextByMode()'),player.indexOf('function updatePlayPauseIcon()')),sandbox);
    assert.equal(sandbox.getNextBvid(),'C'); sandbox.tryPreloadNext(); sandbox.playNextByMode(); assert.deepEqual(played,['C']);
});

test('both players load buffer scheduling before initializing the player', () => {
    for (const file of ['index.html']) {
        const html = read(file);
        assert.ok(html.indexOf('playback-buffer.js?') < html.indexOf('index.js?'));
    }
});

test('a hidden page cancels an active offline download without touching audio playback', async () => {
    const page = Object.assign(new EventTarget(), { hidden: false }), window = {}; let signal;
    vm.runInNewContext(read('playback-buffer.js'), { window, document: page, AbortController, fetch: (_, options) => {
        signal = options.signal;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    } });
    const a = audio(); a.ranges = [[0, 60]];
    window.SG_PLAYBACK_BUFFER.cacheWhenBuffered({ audio: a, url: 'audio', isCurrent: () => true, save: async () => assert.fail('cancelled download cannot save') });
    assert.equal(signal.aborted, false); page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
    assert.equal(signal.aborted, true); assert.equal(a.paused, false); await tick();
});

test('fragment preload uses the fragment boundary rather than the entire source duration', () => {
    const a = audio(), api = setup(); a.currentTime = 10; a.ranges = [[0, 35]];
    assert.equal(api.shouldPreload(a, 30), false); assert.equal(api.shouldPreload(a, 30, 8), true);
});

test('stall recovery is bounded and cancelled by playback progress, user pause and track changes', async () => {
    const timers = new Map(), window = {}; let serial = 0, key = 'A', current = true, recovered = 0;
    vm.runInNewContext(read('playback-buffer.js'), { window, setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id) });
    const a = audio();
    const watch = window.SG_PLAYBACK_BUFFER.watchPlayback({ audio: a, key: () => key, isCurrent: () => current, reconnect: () => { recovered++; } });
    const run = async () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(fn => fn()); await tick(); };
    a.dispatchEvent(new Event('waiting')); assert.equal(timers.size, 1); a.currentTime = 1; a.dispatchEvent(new Event('timeupdate')); assert.equal(timers.size, 0);
    a.dispatchEvent(new Event('stalled')); a.paused = true; a.dispatchEvent(new Event('pause')); assert.equal(timers.size, 0); await run(); assert.equal(recovered, 0);
    a.paused = false; a.dispatchEvent(new Event('waiting')); key = 'B'; await run(); assert.equal(recovered, 0);
    for (let i = 0; i < 4; i++) { a.dispatchEvent(new Event('stalled')); await run(); }
    assert.equal(recovered, 2);
    key = 'C'; a.dispatchEvent(new Event('waiting')); current = false; await run(); assert.equal(recovered, 2);
    watch.dispose(); a.dispatchEvent(new Event('waiting')); assert.equal(timers.size, 0);
});
