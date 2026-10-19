import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const edgeSource = read('edge-functions/bilibili.js');
const clientSource = read('bili-api.js');
const playerSource = read('index.js');
const media = 'https://upos-example.bilivideo.com/audio.m4s?token=test';
function index(version = 0) {
    const buffer = new ArrayBuffer((version ? 40 : 32) + 24), view = new DataView(buffer);
    view.setUint32(0, buffer.byteLength); new Uint8Array(buffer, 4, 4).set([115, 105, 100, 120]);
    view.setUint8(8, version); view.setUint32(16, 1000);
    if (version) view.setBigUint64(28, 9n); else view.setUint32(24, 9);
    view.setUint16(version ? 38 : 30, 2);
    const start = version ? 40 : 32;
    for (const [i, size, duration] of [[0,1000,5000],[1,2000,7500]]) {
        view.setUint32(start + i * 12, size); view.setUint32(start + i * 12 + 4, duration);
    }
    return buffer;
}
function edge(fetch, responseClass = Response) {
    const sandbox = vm.createContext({ URL, URLSearchParams, Request, Response: responseClass, Headers, fetch, console, addEventListener() {} });
    vm.runInContext(edgeSource, sandbox);
    return { sandbox, request: (path, method = 'GET') => sandbox.handleRequest(new Request('https://edge.example' + path, { method, headers: { Origin: 'https://snow-gladys.com' } })) };
}
function path(buffer = index()) {
    return '/hls.m3u8?url=' + encodeURIComponent(media) + '&init=0-816&index=817-' + (816 + buffer.byteLength);
}
const partial = buffer => new Response(buffer, { status: 206, headers: { 'Content-Range': 'bytes 817-' + (816 + buffer.byteLength) + '/10000' } });

for (const version of [0,1]) test('SIDX v' + version + ' produces a complete HLS playlist with exact byte offsets', async () => {
    const buffer = index(version);
    const api = edge(async (url, init) => {
        assert.equal(url, media);
        assert.equal(new Headers(init.headers).get('Range'), 'bytes=817-' + (816 + buffer.byteLength));
        return partial(buffer);
    });
    const response = await api.request(path(buffer));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/vnd.apple.mpegurl');
    const text = await response.text(), offset = 817 + buffer.byteLength + 9;
    assert.match(text, /#EXT-X-TARGETDURATION:8/);
    assert.match(text, /BYTERANGE="817@0"/);
    assert.ok(text.includes('#EXT-X-BYTERANGE:1000@' + offset));
    assert.ok(text.includes('#EXT-X-BYTERANGE:2000@' + (offset + 1000)));
    assert.match(text, /#EXTINF:5\.000000,/);
    assert.match(text, /#EXTINF:7\.500000,/);
    assert.match(text, /#EXT-X-ENDLIST\n$/);
    assert.ok(text.includes('https://edge.example/proxy?url=' + encodeURIComponent(media)));
});

test('simultaneous manifest probes share a bounded index fetch; HEAD is bodyless', async () => {
    let calls = 0;
    const api = edge(async () => { calls++; return partial(index()); });
    const [a,b] = await Promise.all([api.request(path()),api.request(path(), 'HEAD')]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(await b.text(), '');
    assert.equal((await api.request(path())).status, 200);
    assert.equal(calls, 1);
});

for (const finalChunkHasDone of [false,true]) test('runtime ArrayBuffer chunks do not truncate the HLS index (final done=' + finalChunkHasDone + ')', async () => {
    class RuntimeResponse extends Response {
        get body() {
            if (!super.body) return null;
            const response = this;
            return { getReader() {
                let consumed = false;
                return { async read() {
                    if (consumed) return { done: true };
                    consumed = true;
                    return { value: await Response.prototype.arrayBuffer.call(response), done: finalChunkHasDone };
                } };
            } };
        }
    }
    const api = edge(() => partial(index()), RuntimeResponse);
    const response = await api.request(path());
    assert.equal(response.status, 200);
    assert.match(await response.text(), /#EXT-X-BYTERANGE:1000@882/);
});

test('manifest rejects unsafe hosts and unbounded metadata before fetching', async () => {
    const api = edge(() => assert.fail('invalid range must not fetch'));
    for (const suffix of ['&init=0-816&index=817-9999999', '&init=0-900&index=817-900', '&init=0-816&index=bad', '&init=5-816&index=817-872']) {
        assert.equal((await api.request('/hls.m3u8?url=' + encodeURIComponent(media) + suffix)).status, 400);
    }
    assert.equal((await api.request('/hls.m3u8?url=https://evil.example/anything&init=0-816&index=817-872')).status, 400);
});

test('an upstream ignoring Range is cancelled rather than downloaded in full', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const api = edge(() => new Response(body, { status: 200 }));
    assert.equal((await api.request(path())).status, 502);
    assert.equal(cancelled, true);
});

test('corrupt, hierarchical, truncated, and oversized indices fail cleanly', async () => {
    for (const mutate of [
        v => v.setUint8(8, 2), v => v.setUint32(16, 0), v => v.setUint16(30, 100),
        v => v.setUint32(32, 0x80000001), v => v.setUint32(32, 0), v => v.setUint32(36, 0),
        v => v.setUint32(0, 1000000), v => v.setUint32(24, 0xffffffff),
    ]) {
        const buffer = index(); mutate(new DataView(buffer));
        const api = edge(() => partial(buffer));
        assert.equal((await api.request(path())).status, 502);
    }
    for (const count of [55,57]) {
        const api = edge(() => new Response(new Uint8Array(count), { status: 206, headers: { 'Content-Range': 'bytes 817-872/10000' } }));
        assert.equal((await api.request(path())).status, 502);
    }
});

test('resolve exposes HLS only when the upstream supplies segment boundaries', async () => {
    const api = edge(url => new Response(JSON.stringify({ code: 0, data: url.includes('pagelist')
        ? [{ cid: 1, page: 1 }] : { dash: { audio: [{ id: 30232, baseUrl: media, segment_base: { initialization: '0-816', index_range: '817-872' } }] } } })));
    const data = await (await api.request('/resolve?bvid=BV17uZQBHEDo')).json();
    assert.deepEqual(data.hls, { initialization: '0-816', indexRange: '817-872' });
    for (const advertised of [true,false]) {
        const window = {};
        vm.runInNewContext(clientSource, { window, fetch: () => new Response(JSON.stringify({ url: media, ...(advertised ? { hls: data.hls } : {}) })) });
        const found = await window.SG_BILI_API.createClient('https://edge.example').resolve('BV17uZQBHEDo');
        assert.equal(!!found.hlsUrl, advertised);
        assert.equal(found.proxyUrl, 'https://edge.example/proxy?url=' + encodeURIComponent(media));
        if(advertised) assert.ok(found.hlsUrl.endsWith('&init=0-816&index=817-872'));
    }
});

test('partial responses advertise proven range support without inventing it on 200', async () => {
    for(const status of [200,206]) {
        const api = edge(() => new Response('test', { status, headers: status === 206 ? { 'Content-Range':'bytes 0-3/100' } : {} }));
        const response = await api.request('/proxy?url=' + encodeURIComponent(media));
        assert.equal(response.headers.get('Accept-Ranges'), status === 206 ? 'bytes' : null);
    }
});

test('all audio elements receive CORS and preload settings before use', () => {
    const start = playerSource.indexOf('function createPlayerAudio()');
    const end = playerSource.indexOf('let bgmAudio =', start);
    const sandbox = vm.createContext({ Audio: function () { return {}; }, document: { body: { appendChild(audio) {
        assert.equal(audio.crossOrigin, 'anonymous'); assert.equal(audio.preload, 'auto'); assert.equal(audio.playsInline, true);
    } } } });
    vm.runInContext(playerSource.slice(start,end), sandbox);
    sandbox.createPlayerAudio();
});

test('iPhone Chrome uses native HLS while desktop Chrome retains its fast direct path', async () => {
    const start = playerSource.indexOf('function fetchResolveViaProxy(bvid)');
    const end = playerSource.indexOf('async function getLoadableRealUrl(', start);
    for (const [userAgent, expected] of [
        ['Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1', 'hls'],
        ['Mozilla/5.0 (iPad) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'hls'],
        ['Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'direct'],
        ['Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'direct'],
        ['Mozilla/5.0 (Android) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'direct'],
    ]) {
        const sandbox = vm.createContext({ navigator: { userAgent }, getCurrentAudioMode: () => 'medium',
            bgmAudio: { canPlayType: () => 'probably' }, biliClient: { resolve: async () => ({ hlsUrl: 'hls', proxyUrl: 'direct' }) },
        });
        vm.runInContext(playerSource.slice(start,end),sandbox);
        assert.equal((await sandbox.fetchResolveViaProxy('BV17uZQBHEDo')).url,expected);
    }
});

test('an initial preload completing after a track selection cannot start an unrelated download', async () => {
    let finish;
    const sandbox = vm.createContext({
        liveRadio: null, navigator: {}, songList: [{ bvid: 'BV17uZQBHEDo' }], currentPlayingBvid: '', preloadGeneration: 0,
        listeningLibrary: { isExcluded: () => false },
        preloadCache: null, preloadInFlight: null, nextRandomBvid: null, playScope: 'all', resumeSession: null,
        globalPreloadAudio: { set src(_) { assert.fail('stale preload must not download'); } },
        getRandomIndex: () => 0, fetchResolveViaProxy: () => new Promise(resolve => { finish = resolve; }),
    });
    const start = playerSource.indexOf('function clearPreload()');
    const end = playerSource.indexOf('function tryPreloadNext()', start);
    vm.runInContext(playerSource.slice(start,end), sandbox);
    sandbox.runInitialPreload(); sandbox.clearPreload(); finish({ url: 'https://edge.example/unrelated' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sandbox.preloadCache, null);
});

test('startup prepares the previous song first, or reuses the prepared random song, without playing', async () => {
    for (const resume of [null, { bvid: 'BV1Sf421Q7Rt' }]) {
        const requested = [], media = { load() {}, play() { assert.fail('startup must stay silent'); } };
        const sandbox = vm.createContext({ liveRadio: null, navigator: {}, currentPlayingBvid: '', playScope: 'all',
            songList: [{ bvid: 'BV17uZQBHEDo' }, { bvid: 'BV1Sf421Q7Rt' }], resumeSession: resume,
            listeningLibrary: { isExcluded: () => false }, randomQueue: { peekNext: () => 'BV1Sf421Q7Rt' },
            preloadGeneration: 0, globalPreloadAudio: media, getRandomIndex: () => 0,
            fetchResolveViaProxy: async id => { requested.push(id); return { url: 'https://audio.example/ready' }; },
        });
        vm.runInContext(playerSource.slice(playerSource.indexOf('function clearPreload()'), playerSource.indexOf('function tryPreloadNext()')), sandbox);
        sandbox.runInitialPreload(); await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(requested, [resume ? resume.bvid : 'BV17uZQBHEDo']);
        assert.equal(media.src, 'https://audio.example/ready');
        if (!resume) assert.equal(sandbox.getHomeRandomBvid(), 'BV17uZQBHEDo');
        sandbox.navigator.connection = { saveData: true }; sandbox.runInitialPreload();
        assert.equal(requested.length, 1);
    }
});
