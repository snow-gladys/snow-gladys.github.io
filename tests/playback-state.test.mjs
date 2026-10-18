import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../playback-state.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function stateApi() {
    const context = vm.createContext({});
    vm.runInContext(source, context);
    return context.SG_PLAYBACK_STATE;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
const api = stateApi();
const ids = ['A', 'B', 'C', 'D'];

test('random rounds visit every song once and never repeat at the boundary', () => {
    const queue = api.createQueue(() => 0.4);
    queue.commit('A');
    let current = 'A';
    const first = [];
    for (let i = 0; i < ids.length - 1; i++) {
        const next = queue.peekNext(ids, current);
        assert.equal(queue.peekNext(ids, current), next, 'preloading must not consume the next song');
        assert.notEqual(next, current);
        first.push(next); queue.commit(next, 'forward'); current = next;
    }
    assert.deepEqual(new Set(['A', ...first]), new Set(ids));
    for (let round = 0; round < 10; round++) {
        const seen = [];
        for (let i = 0; i < ids.length; i++) {
            const next = queue.peekNext(ids, current);
            assert.notEqual(next, current);
            seen.push(next); queue.commit(next, 'forward'); current = next;
        }
        assert.deepEqual(new Set(seen), new Set(ids));
    }
});

test('previous follows actual playback and next retraces forward without drawing again', () => {
    const queue = api.createQueue(() => 0.4);
    queue.commit('A'); queue.commit('C'); queue.commit('B');
    assert.equal(queue.peekPrevious(ids), 'C');
    queue.commit('C', 'back');
    assert.equal(queue.peekPrevious(ids), 'A');
    assert.equal(queue.peekNext(ids, 'C'), 'B');
    queue.commit('B', 'forward');
    assert.equal(queue.peekPrevious(ids), 'C');
    queue.commit('C', 'back'); queue.commit('D');
    assert.equal(queue.peekPrevious(ids), 'C', 'manual selection starts a new history branch');
});

test('scope changes and deleted songs cannot escape the current allowed list', () => {
    const queue = api.createQueue(() => 0.7);
    queue.commit('A'); queue.commit('B'); queue.commit('C');
    queue.commit('B', 'back');
    assert.ok(['A', 'B'].includes(queue.peekNext(['A', 'B', 'B'], 'B')));
    assert.equal(queue.peekPrevious(['B', 'C']), null);
    for (let i = 0; i < 10; i++) {
        const next = queue.peekNext(['B'], 'B');
        assert.equal(next, 'B'); queue.commit(next);
    }
    assert.equal(queue.peekNext([], 'B'), null);
});

test('session data validates malformed, missing, private-storage, and outdated values', () => {
    for (const raw of [null, 'oops', 'null', '{}', '{"bvid":"AV123","time":2}', '{"bvid":"BV1Sf421Q7Rt","time":-1}']) {
        assert.equal(api.readSession({ getItem: () => raw }, 'key'), null);
    }
    assert.equal(api.readSession({ getItem() { throw Error('blocked'); } }, 'key'), null);
    assert.deepEqual(plain(api.readSession({ getItem: () => JSON.stringify({ bvid: 'BV1Sf421Q7Rt', time: 42, duration: 200, scope: 'favorites', order: 'random' }) }, 'key')),
        { bvid: 'BV1Sf421Q7Rt', time: 42, duration: 200, scope: 'favorites', order: 'random' });
    assert.deepEqual(plain(api.readSession({ getItem: () => JSON.stringify({ bvid: 'BV1Sf421Q7Rt', time: 0, scope: 'bad', order: 'bad' }) }, 'key')),
        { bvid: 'BV1Sf421Q7Rt', time: 0, duration: 0, scope: 'all', order: 'list' });
});

test('resume waits for a usable duration and starts finished or shortened songs at zero', () => {
    assert.equal(api.resumeTime(42, Infinity), null);
    assert.equal(api.resumeTime(42, 0), null);
    assert.equal(api.resumeTime(42, 180), 42);
    assert.equal(api.resumeTime(179, 180), 0);
    assert.equal(api.resumeTime(300, 180), 0);
    assert.equal(api.resumeTime(NaN, 180), 0);
});

test('lyric shifting preserves content and precision, clamps the beginning, and does not mutate the baseline', () => {
    const original = [{ time: 0.2, text: '开头' }, { time: 10.125, text: '歌词' }];
    assert.deepEqual(plain(api.shiftLyrics(original, -0.5)), [{ time: 0, text: '开头' }, { time: 9.625, text: '歌词' }]);
    assert.deepEqual(plain(api.shiftLyrics(original, 0.5)), [{ time: 0.7, text: '开头' }, { time: 10.625, text: '歌词' }]);
    assert.deepEqual(plain(api.shiftLyrics(original, 0)), original);
});

function sessionHarness() {
    const writes = [];
    const context = vm.createContext({
        window: { SG_PLAYBACK_STATE: api },
        PLAY_SESSION_STORAGE_KEY: 'snow_session', localStorage: { setItem: (key, raw) => writes.push([key, JSON.parse(raw)]) },
        currentPlayingBvid: 'BV1Sf421Q7Rt', sessionAudioBvid: 'BV1Sf421Q7Rt',
        pendingPlayback: { bvid: 'BV1Sf421Q7Rt', ready: true, version: 1, time: 42, started: false, positionApplied: false },
        bgmAudio: { currentTime: 0, duration: Infinity, readyState: 1 },
        playScope: 'favorites', playMode: 'random', playRequestVersion: 1,
        lastSessionWrite: 0, resumeSession: null,
        randomQueue: api.createQueue(), Date,
        getSongInfo: bvid => ({ bvid, name: bvid }), listeningLibrary: { record() {}, leaveQueue() {} },
    });
    const start = player.indexOf('function savePlaybackSession(');
    const end = player.indexOf('async function resumeLastPlayback(', start);
    vm.runInContext(player.slice(start, end), context);
    return { context, writes };
}

test('iOS delayed metadata cannot overwrite the stored resume position with zero', () => {
    const { context, writes } = sessionHarness();
    context.rememberStartedPlayback();
    assert.equal(writes.length, 0);
    context.bgmAudio.duration = 200;
    context.applyResumePosition();
    assert.equal(context.bgmAudio.currentTime, 42);
    context.savePlaybackSession(true);
    assert.equal(writes[0][1].time, 42);
    context.bgmAudio.currentTime = 43;
    context.savePlaybackSession(false);
    assert.equal(writes.length, 1, 'time updates are throttled');
    context.savePlaybackSession(true);
    assert.equal(writes[1][1].time, 43, 'pause/background flushes the final position');
});

test('old audio events cannot seek or persist the new track while it resolves', () => {
    const { context, writes } = sessionHarness();
    context.pendingPlayback.ready = false;
    context.bgmAudio.duration = 200;
    context.bgmAudio.currentTime = 8;
    context.applyResumePosition();
    assert.equal(context.bgmAudio.currentTime, 8);
    context.rememberStartedPlayback(); context.savePlaybackSession(true);
    assert.equal(writes.length, 0);
});

test('starting a fresh track does not seek to zero again while WebKit is starting playback', () => {
    const { context } = sessionHarness();
    context.pendingPlayback.time = 0;
    context.bgmAudio.duration = 200;
    let seeks = 0;
    Object.defineProperty(context.bgmAudio, 'currentTime', { get: () => 0, set: () => { seeks++; } });
    context.applyResumePosition();
    assert.equal(seeks, 0);
    assert.equal(context.pendingPlayback.positionApplied, true);
});

test('both sites expose independent scope/order controls and load shared state before the player', () => {
    for (const file of ['index.html', 'fiona/index.html']) {
        const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
        assert.ok(html.indexOf('playback-state.js?') < html.indexOf('index.js?'));
        assert.equal((html.match(/data-play-scope=/g) || []).length, 3);
        assert.equal((html.match(/data-play-order=/g) || []).length, 3);
    }
});

test('every playback order respects favorites and downloaded scope, including an out-of-scope current song', () => {
    const all = ids.map(bvid => ({ bvid }));
    for (const scope of ['all', 'favorites', 'downloaded']) {
        for (const order of ['list', 'single', 'random']) {
            const context = vm.createContext({ listeningLibrary: { anchor: null }, getQueuedNext: () => null,
                getRandomList() { return context.getEffectiveList(); }, playScope: scope, playMode: order, songList: all,
                currentPlayingBvid: 'A', getFavoritesList: () => all.slice(1, 3), getDownloadedList: () => all.slice(2),
                randomQueue: api.createQueue(() => 0.5),
                getCurrentIndexInEffectiveList() { return context.getEffectiveList().findIndex(song => song.bvid === context.currentPlayingBvid); },
            });
            const effectiveStart = player.indexOf('function getEffectiveList()');
            vm.runInContext(player.slice(effectiveStart, player.indexOf('/** 在当前模式列表', effectiveStart)), context);
            const nextStart = player.indexOf('function getNextBvid()');
            vm.runInContext(player.slice(nextStart, player.indexOf('function clearPreload()', nextStart)), context);
            const expected = scope === 'all' ? ids : scope === 'favorites' ? ['B', 'C'] : ['C', 'D'];
            assert.ok(expected.includes(context.getNextBvid()), scope + '/' + order);
        }
    }
});

test('legacy collection modes migrate once and survive a second page load', () => {
    for (const legacy of ['favorites', 'downloaded']) {
        const stored = new Map([['order', legacy]]);
        const context = vm.createContext({ PLAY_MODE_STORAGE_KEY: 'order', PLAY_SCOPE_STORAGE_KEY: 'scope',
            localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
            favoritesSet: new Set(['A']), window: { SG_CACHE: { supported: true } },
            playScope: 'all', setPlayMode: order => stored.set('order', order),
        });
        const start = player.indexOf('(function initPlayMode()');
        const end = player.indexOf('        updatePlayPauseIcon();', start);
        vm.runInContext(player.slice(start, end), context);
        assert.equal(context.playScope, legacy);
        assert.equal(stored.get('order'), 'list');
        assert.equal(stored.get('scope'), legacy);
        context.playScope = 'all';
        vm.runInContext(player.slice(start, end), context);
        assert.equal(context.playScope, legacy);
    }
});

test('lyric export carries rounded centiseconds into the next second and minute', () => {
    const context = vm.createContext({});
    const start = player.indexOf('function formatLrcTime(');
    vm.runInContext(player.slice(start, player.indexOf('/** 更新调轴模式', start)), context);
    assert.equal(context.formatLrcTime(59.999), '01:00.00');
    assert.equal(context.formatLrcTime(5.995), '00:06.00');
});
