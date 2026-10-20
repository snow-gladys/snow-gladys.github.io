import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { installTimeline } from './helpers/player-timeline.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const BV = 'BV17uZQBHEDo', plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function client(fetch = () => {}) {
    const context = vm.createContext({ window: {}, URL, URLSearchParams, fetch });
    vm.runInContext(read('bili-api.js'), context);
    return context.window.SG_BILI_API;
}
const api = client();

test('full share text and short links retain explicit P and start time, without accepting lookalike hosts', () => {
    for (const text of [BV + '?p=2&t=42', '【分享】https://m.bilibili.com/video/' + BV + '/?p=2&amp;t=42。']) {
        assert.equal(api.videoInput(text).bvid, BV + '@p2@t42-0');
    }
    assert.equal(api.videoInput('【听歌】(https://b23.tv/ABC123/?p=2&t=42).').shortUrl, 'https://b23.tv/ABC123/?p=2&t=42');
    for (const text of ['https://evil.example/b23.tv/ABC123', 'https://b23.tv.evil.com/ABC123', 'https://evil.example/' + BV]) {
        assert.deepEqual(plain(api.videoInput(text)), { bvid: '', shortUrl: '' });
    }
    assert.equal(api.videoInput('https://www.bilibili.com/video/' + BV + '?p=0').bvid, '');
});

test('source keys distinguish pages and fragments; malformed bounds never resolve', async () => {
    const key = api.trackId(BV, 2, 12.5, 45);
    assert.equal(key, BV + '@p2@t12.5-45');
    assert.equal(api.videoQuery(key), 'bvid=' + BV + '&p=2');
    assert.equal(api.videoUrl(key), 'https://www.bilibili.com/video/' + BV + '/?p=2&t=12.5');
    for (const value of [BV + '@p0', BV + '@t20-10', BV + '@t0-999999999', BV + '@p2/evil', BV + '@tNaN-0']) assert.equal(api.normalizeId(value), '');
    assert.equal(api.time('1:02:03'), 3723); assert.equal(api.time('12.5'), 12.5); assert.ok(Number.isNaN(api.time('abc')));
    const calls = [];
    await client(async url => { calls.push(new URL(url)); return new Response(JSON.stringify({ url: 'https://a.bilivideo.com/a' })); }).createClient('https://edge.example').resolve(key);
    assert.equal(calls[0].searchParams.get('bvid'), BV); assert.equal(calls[0].searchParams.get('p'), '2'); assert.equal(calls[0].searchParams.has('start'), false);
});

function edge(fetch) {
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, fetch, console, addEventListener() {} });
    vm.runInContext(read('edge-functions/bilibili.js'), context);
    return path => context.handleRequest(new Request('https://edge.example' + path, { headers: { Origin: 'https://snow-gladys.com' } }));
}
const parts = [{ cid: 11, page: 1, part: '第一首', duration: 60 }, { cid: 22, page: 2, part: '第二首', duration: 90 }];

test('short redirects preserve the target P; info exposes titles and rejects missing P', async () => {
    const request = edge(async url => url.startsWith('https://b23.tv/')
        ? new Response(null, { status: 302, headers: { Location: 'https://www.bilibili.com/video/' + BV + '/?p=2&t=30' } })
        : new Response(JSON.stringify({ code: 0, data: { bvid: BV, title: '合集', pages: parts } })));
    const info = await (await request('/info?url=' + encodeURIComponent('https://b23.tv/ABC123'))).json();
    assert.equal(info.page, 2); assert.equal(info.start, 30); assert.equal(info.pages[1].name, '第二首');
    assert.equal((await request('/info?bvid=' + BV + '&p=3')).status, 404);
});

test('chapter lookup uses the chosen CID, coalesces requests and filters malformed ranges', async () => {
    const calls = [];
    const request = edge(async url => {
        calls.push(new URL(url));
        return new Response(JSON.stringify({ code: 0, data: url.includes('/pagelist') ? parts : { view_points: [
            { content: '有效章节', from: 10, to: 45 }, { content: '倒置', from: 25, to: 20 }, { content: '越界', from: 85, to: 120 }, { content: '<标签>', from: 50, to: 80 },
        ] } }));
    });
    const [a, b] = await Promise.all([request('/chapters?bvid=' + BV + '&p=2'), request('/chapters?bvid=' + BV + '&p=2')]);
    assert.equal(b.status, 200); assert.equal(calls.length, 2); assert.equal(calls[1].searchParams.get('cid'), '22');
    assert.deepEqual((await a.json()).chapters, [{ name: '有效章节', start: 10, end: 45 }, { name: '<标签>', start: 50, end: 80 }]);
    assert.equal((await request('/chapters?bvid=' + BV + '&p=5')).status, 404);
});

test('chapter risk-control failure remains explicit and cannot make video info fail', async () => {
    const request = edge(async url => new Response(JSON.stringify(url.includes('web-interface/view')
        ? { code: 0, data: { bvid: BV, title: '可播放的视频', pages: parts } }
        : url.includes('/pagelist') ? { code: 0, data: parts } : { code: -352, message: 'risk' })));
    assert.equal((await request('/info?bvid=' + BV)).status, 200);
    assert.equal((await request('/chapters?bvid=' + BV)).status, 503);
});

function form(info, chapterLookup = async () => ({ chapters: [{ name: '副歌', start: 20, end: 40 }] })) {
    function field() { return { value: '', hidden: true, listeners: {}, addEventListener(k, fn) { this.listeners[k] = fn; }, replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; } }; }
    const input = field(), name = field(), status = field(), retry = field(), page = field(), chapter = field(), batch = field(), start = field(), end = field(), sourcePanel = field();
    const context = vm.createContext({ window: { SG_BILI_API: api }, document: { createElement: field }, AbortController, setTimeout, clearTimeout });
    vm.runInContext(read('song-entry.js'), context);
    const entry = context.window.SG_SONG_ENTRY.create({ input, name, status, retry, page, chapter, batch, start, end, sourcePanel,
        client: { videoInfo: async () => info, chapters: chapterLookup }, find: () => null });
    input.value = info.bvid; entry.begin();
    return { entry, input, name, status, retry, page, chapter, batch, start, end, sourcePanel };
}
const info = { bvid: BV + '@p2', name: '合集', pages: parts.map(item => ({ page: item.page, name: item.part, duration: item.duration })) };

test('form respects linked P, imports all P independently, and gives chapters their own song names', async () => {
    const h = form(info); await h.entry.read(); await tick();
    assert.equal(h.page.value, '2'); assert.equal(h.name.value, '合集');
    h.batch.value = 'pages'; assert.deepEqual(plain((await h.entry.read()).songs), [{ bvid: BV, name: '第一首' }, { bvid: BV + '@p2', name: '第二首' }]);
    h.batch.value = 'single'; h.chapter.value = '0'; h.chapter.listeners.change();
    const saved = await h.entry.read(); assert.equal(saved.bvid, BV + '@p2@t20-40'); assert.equal(saved.name, '副歌');
    h.start.value = '1:20'; h.end.value = '1:00'; await assert.rejects(h.entry.read(), /起止时间/); h.entry.close();
});

test('switching P ignores old chapter results and preserves a manually typed name', async () => {
    const pending = [];
    const h = form(info, () => new Promise(resolve => pending.push(resolve)));
    await h.entry.read(); h.name.value = '自己的歌名'; h.name.listeners.input();
    h.page.value = '1'; h.page.listeners.change();
    pending[1]({ chapters: [{ name: '当前 P', start: 5, end: 15 }] }); await tick();
    pending[0]({ chapters: [{ name: '过期结果', start: 20, end: 40 }] }); await tick();
    assert.ok(h.chapter.children.some(item => item.textContent.includes('当前 P'))); assert.equal(h.name.value, '自己的歌名');
    h.entry.close();
});

test('different P and fragments survive playlist, queue, exclusion, resume and cache-job reloads', () => {
    const songs = [BV, BV + '@p2', BV + '@p2@t10-20'].map((bvid, i) => ({ bvid, name: String(i) }));
    const map = new Map(), storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
    const context = vm.createContext({ TextEncoder, window: {}, setTimeout, clearTimeout });
    for (const file of ['personal-library.js', 'listening-library.js', 'playback-state.js', 'favorites-cache.js']) vm.runInContext(read(file), context);
    const root = context.window;
    const lib = root.SG_PERSONAL.create({ storage }), id = lib.create('三种来源', songs);
    assert.equal(root.SG_PERSONAL.create({ storage }).get(id).songs.length, 3);
    const listening = root.SG_LISTENING.create({ storage, key: 'listen' }); songs.forEach(song => { listening.add(song); listening.record(song); listening.exclude(song, true); });
    const restored = root.SG_LISTENING.create({ storage, key: 'listen' });
    assert.equal(restored.list('queue').length, 3); assert.equal(restored.list('recent').length, 3); assert.equal(restored.list('excluded').length, 3);
    storage.setItem('session', JSON.stringify({ bvid: songs[2].bvid, time: 3 })); assert.equal(root.SG_PLAYBACK_STATE.readSession(storage, 'session').bvid, songs[2].bvid);
    storage.setItem('cache', JSON.stringify({ items: songs, mode: 'medium' })); assert.equal(root.SG_FAVORITES_CACHE.create({ storage, key: 'cache' }).snapshot().items.length, 3);
});

test('fragment timeline, seeks and progress remain relative to the selected P segment', () => {
    const context = vm.createContext({ window: {}, currentPlayingBvid: BV + '@p2@t20-40', bgmAudio: { currentTime: 25, duration: 90 } });
    installTimeline(context);
    assert.equal(context.playbackTime(), 5); assert.equal(context.playbackDuration(), 20);
    context.seekPlayback(8); assert.equal(context.bgmAudio.currentTime, 28); context.seekPlayback(500); assert.equal(context.bgmAudio.currentTime, 40);
    context.currentPlayingBvid = BV + '@p2@t20-0'; assert.equal(context.playbackDuration(), 70);
});

test('unavailable original title is explicitly marked instead of using a P filename', async () => {
    const request = edge(async url => new Response(JSON.stringify(url.includes('/pagelist') ? { code: 0, data: parts } : { code: -352, message: 'risk' })));
    const info = await (await request('/info?bvid=' + BV + '&p=2')).json();
    assert.equal(info.page, 2); assert.equal(info.pages[1].name, '第二首'); assert.equal(info.bvid, BV);
    assert.equal(info.name, ''); assert.equal(info.titleAvailable, false);
});

test('lock-screen seeking and position metadata use the fragment-relative timeline', () => {
    const actions = new Map(), states = [];
    const player = read('index.js');
    const context = vm.createContext({ window: { SG_WARDROBE: { artwork: () => [] } }, liveRadio: null, settings: {},
        currentPlayingBvid: BV + '@p2@t20-40', bgmAudio: { currentTime: 25, duration: 90, paused: false },
        navigator: { mediaSession: { setActionHandler: (action, handler) => actions.set(action, handler), setPositionState: state => states.push(state) } },
        MediaMetadata: function (value) { Object.assign(this, value); }, getSongNameByBvid: () => '片段', updateProgressDisplay() {} });
    installTimeline(context, player);
    vm.runInContext(player.slice(player.indexOf('        function updateMediaSession()'), player.indexOf('        // 原生 HLS')), context);
    context.updateMediaSession();
    assert.equal(states.at(-1).position, 5); assert.equal(states.at(-1).duration, 20);
    actions.get('seekto')({ seekTime: 8 }); assert.equal(context.bgmAudio.currentTime, 28);
    actions.get('seekforward')({ seekOffset: 100 }); assert.equal(context.bgmAudio.currentTime, 40);
    context.settings.mediaSession = 'off'; context.updateMediaSession(); assert.equal(context.navigator.mediaSession.playbackState, 'none');
});

test('the reported video uses its original Unicode title instead of its upload filename', async () => {
    const id = 'BV1taLK6zEHY', title = '𝑷𝒍𝒂𝒚𝒍𝒊𝒔𝒕•『通勤歌单丨第二弹』', calls = [];
    const request = edge(async url => {
        const path = new URL(url).pathname; calls.push(path);
        if (path === '/x/web-interface/view') return new Response('blocked', { status: 412 });
        assert.equal(path, '/x/web-interface/wbi/view');
        return new Response(JSON.stringify({ code: 0, data: { bvid: id, title, pages: [{ page: 1, cid: 38455018794, part: '第二弹-1', duration: 3373 }] } }));
    });
    const data = await (await request('/info?bvid=' + id)).json();
    assert.equal(data.name, title); assert.equal(data.pages[0].name, '第二弹-1'); assert.equal(calls.length, 2);
    const h = form(data); const saved = await h.entry.read();
    assert.equal(h.name.value, title); assert.equal(saved.name, title); h.entry.close();
});

test('default imports preserve the original title until another P is explicitly selected', async () => {
    const h = form({ ...info, bvid: BV });
    await h.entry.read(); await tick(); assert.equal(h.name.value, '合集');
    h.page.value = '2'; h.page.listeners.change(); assert.equal(h.name.value, '第二首');
    h.page.value = '1'; h.page.listeners.change(); assert.equal(h.name.value, '合集');
    h.name.value = '我自己填写的歌名'; h.name.listeners.input();
    h.page.value = '2'; h.page.listeners.change(); assert.equal(h.name.value, '我自己填写的歌名'); h.entry.close();
});

test('an unavailable original title stays empty and the form accepts a manual name', async () => {
    const h = form({ ...info, name: '', titleAvailable: false });
    await assert.rejects(h.entry.read(), /手动填写歌名/);
    assert.equal(h.name.value, ''); assert.match(h.status.textContent, /原标题/);
    h.name.value = '手动填写的原标题'; h.name.listeners.input();
    const song = await h.entry.read(); assert.equal(song.name, '手动填写的原标题'); assert.equal(song.verified, true); h.entry.close();
});

test('missing original titles are not cached by either endpoint or browser and retry can recover', async () => {
    let recovered = false, calls = 0;
    const request = edge(async url => {
        const path = new URL(url).pathname;
        if (path === '/x/player/pagelist') return new Response(JSON.stringify({ code: 0, data: parts }));
        return new Response(JSON.stringify(recovered ? { code: 0, data: { bvid: BV, title: '真正的视频标题', pages: parts } } : { code: -352 }));
    });
    const service = client(async url => { calls++; const u = new URL(url); return request(u.pathname + u.search); }).createClient('https://edge.example');
    const unavailable = await service.videoInfo(BV); assert.equal(unavailable.name, ''); assert.equal(unavailable.titleAvailable, false);
    recovered = true; const available = await service.videoInfo(BV); assert.equal(available.name, '真正的视频标题'); assert.equal(calls, 2);
    const data = { ...info, name: '', titleAvailable: false }, h = form(data);
    await assert.rejects(h.entry.read(), /手动填写歌名/);
    data.name = '恢复读取的原标题'; delete data.titleAvailable;
    h.retry.listeners.click(); await tick(); assert.equal(h.name.value, '恢复读取的原标题'); h.entry.close();
});


test('explicit batch P import remains available when the original title cannot be read', async () => {
    const h = form({ ...info, name: '', titleAvailable: false });
    await assert.rejects(h.entry.read(), /手动填写歌名/);
    h.batch.value = 'pages';
    assert.deepEqual(plain((await h.entry.read()).songs), [{ bvid: BV, name: '第一首' }, { bvid: BV + '@p2', name: '第二首' }]);
    h.entry.close();
});
