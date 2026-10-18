import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const edgeSource = readFileSync(new URL('../edge-functions/bilibili.js', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../bili-api.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const BV = 'BV17uZQBHEDo';
const ORIGIN = 'https://snow-gladys.com';
const MEDIA = 'https://upos-sz-mirrorcosov.bilivideo.com/audio.m4s?deadline=9999999999&token=test';
const pages = [{ cid: 36130327584, page: 1 }, { cid: 123456, page: 2 }];
const audio = [30216, 30232, 30280].map(id => ({ id, baseUrl: MEDIA, mimeType: 'audio/mp4' }));
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function harness(upstream) {
    const calls = [];
    let listener;
    const sandbox = vm.createContext({
        URL, URLSearchParams, Headers, Request, Response, console,
        addEventListener(type, callback) { assert.equal(type, 'fetch'); listener = callback; },
        async fetch(url, init) {
            calls.push({ url: new URL(url), init });
            if (upstream) return upstream(new URL(url), init, calls.length);
            if (new URL(url).pathname === '/x/player/pagelist') return json({ code: 0, data: pages });
            if (new URL(url).pathname === '/x/player/playurl') return json({ code: 0, data: { dash: { audio } } });
            throw new Error('Unexpected upstream: ' + url);
        },
    });
    vm.runInContext(edgeSource, sandbox);
    return {
        calls,
        async request(path, init = {}) {
            let result;
            listener({
                request: new Request('https://edge.example' + path, { ...init, headers: { Origin: ORIGIN, ...init.headers } }),
                respondWith(value) { result = value; },
            });
            return result;
        },
    };
}

function browser(fetch) {
    const sandbox = vm.createContext({ window: {}, fetch });
    vm.runInContext(clientSource, sandbox);
    return sandbox.window.SG_BILI_API;
}

for (const [input, expectedKey, expectedValue] of [
    ['bvid=' + BV, 'bvid', BV],
]) {
    test('resolve accepts ' + input, async () => {
        const edge = harness();
        const res = await edge.request('/resolve?' + input);
        assert.equal(res.status, 200);
        const result = await res.json();
        assert.equal(result.url, MEDIA);
        assert.equal(result.cid, pages[0].cid);
        assert.equal(result.audioId, 30232);
        assert.equal(edge.calls[0].url.pathname, '/x/player/pagelist');
        assert.equal(edge.calls[0].url.searchParams.get(expectedKey), expectedValue);
        assert.equal(edge.calls[1].url.searchParams.get(expectedKey), expectedValue);
        assert.equal(edge.calls[1].url.searchParams.get('cid'), String(pages[0].cid));
        assert.equal(edge.calls[1].url.searchParams.get('fnval'), '16');
        assert.equal(edge.calls.length, 2);
        assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
        assert.match(res.headers.get('Content-Type'), /application\/json/);
    });
}

test('resolvehtml honors part and quality; base_url and string audio IDs work', async () => {
    const edge = harness(url => url.pathname.endsWith('pagelist')
        ? json({ code: 0, data: pages })
        : json({ code: 0, data: { dash: { audio: audio.map(a => ({ id: String(a.id), base_url: a.baseUrl })) } } }));
    const res = await edge.request('/resolvehtml?bvid=' + BV + '&p=2&mode=high');
    const data = await res.json();
    assert.equal(data.cid, pages[1].cid);
    assert.equal(data.audioId, '30280');
    assert.equal(data.url, MEDIA);
    assert.equal(edge.calls[1].url.searchParams.get('cid'), String(pages[1].cid));
});

test('validation caches pages, while every resolve refreshes the signed audio URL', async () => {
    const edge = harness();
    assert.equal((await (await edge.request('/valid?bvid=' + BV)).json()).valid, true);
    assert.equal((await (await edge.request('/resolve?bvid=' + BV + '&mode=low')).json()).audioId, 30216);
    await edge.request('/resolve?bvid=' + BV);
    assert.equal(edge.calls.filter(c => c.url.pathname.endsWith('pagelist')).length, 1);
    assert.equal(edge.calls.filter(c => c.url.pathname.endsWith('playurl')).length, 2);
});

for (const [status, body, expected] of [
    [412, '<!DOCTYPE html>blocked', 'BILI_RISK_CONTROL'],
    [403, '<html>blocked', 'BILI_RISK_CONTROL'],
    [429, '<html>slow down', 'BILI_RISK_CONTROL'],
    [200, JSON.stringify({ code: -352, message: 'risk' }), 'BILI_RISK_CONTROL'],
    [200, '<!DOCTYPE html>unexpected page', 'UPSTREAM_INVALID_JSON'],
    [200, 'null', 'UPSTREAM_INVALID_DATA'],
    [500, 'error', 'UPSTREAM_HTTP_ERROR'],
]) {
    test('upstream ' + status + '/' + expected + ' stays unknown during validation', async () => {
        const edge = harness(() => new Response(body, { status }));
        const response = await edge.request('/valid?bvid=' + BV);
        assert.ok(response.status >= 500);
        const result = await response.json();
        assert.equal(result.valid, null);
        assert.equal(result.code, expected);
        assert.equal(result.stage, 'pagelist');
        assert.equal(result.upstreamStatus, status);
        assert.match(response.headers.get('Content-Type'), /application\/json/);
    });
}

test('network failures are structured; failed lookups are not cached', async () => {
    const edge = harness(() => { throw new Error('network down'); });
    for (let i = 0; i < 2; i++) {
        const res = await edge.request('/resolve?bvid=' + BV);
        assert.equal(res.status, 502);
        assert.equal((await res.json()).code, 'UPSTREAM_NETWORK_ERROR');
    }
    assert.equal(edge.calls.length, 2);
});

test('only actual missing videos become valid:false; API parameter errors stay unknown', async () => {
    const missing = harness(() => json({ code: -404 }));
    assert.equal((await (await missing.request('/valid?bvid=' + BV)).json()).valid, false);
    assert.equal((await missing.request('/resolve?bvid=' + BV)).status, 404);
    const failure = harness(() => json({ code: -400 }));
    const data = await (await failure.request('/valid?bvid=' + BV)).json();
    assert.equal(data.valid, null);
    assert.equal(data.upstreamCode, -400);
});

test('nonexistent part and invalid input get useful client errors', async () => {
    const edge = harness();
    assert.equal((await edge.request('/resolve?bvid=wrong')).status, 400);
    assert.equal((await edge.request('/resolve?bvid=' + BV + '&p=0')).status, 400);
    assert.equal(edge.calls.length, 0);
    assert.equal((await edge.request('/resolve?bvid=' + BV + '&p=3')).status, 404);
    assert.equal((await (await edge.request('/valid?bvid=' + BV + '&p=3')).json()).valid, false);
    assert.equal((await edge.request('/resolve?bvid=' + BV + '&mode=wrong')).status, 400);
});

test('video-only durl is not mistaken for an independent audio track', async () => {
    const edge = harness(url => url.pathname.endsWith('pagelist')
        ? json({ code: 0, data: pages }) : json({ code: 0, data: { durl: [{ url: MEDIA }] } }));
    const res = await edge.request('/resolve?bvid=' + BV);
    assert.equal(res.status, 422);
    assert.equal((await res.json()).code, 'NO_AUDIO');
});

test('CORS preflight allows byte ranges and rejects unknown origins before fetch', async () => {
    const edge = harness();
    const preflight = await edge.request('/proxy', { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Range/);
    const denied = await edge.request('/resolve?bvid=' + BV, { headers: { Origin: 'https://other.example' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await edge.request('/resolve', { method: 'POST' })).status, 405);
    assert.equal((await edge.request('/missing')).status, 404);
    assert.equal(edge.calls.length, 0);
});

test('proxy preserves range requests, partial response headers and body', async () => {
    const edge = harness((_url, init) => {
        assert.equal(new Headers(init.headers).get('Range'), 'bytes=0-3');
        assert.equal(new Headers(init.headers).get('If-Range'), 'test-etag');
        return new Response('test', { status: 206, headers: {
            'Content-Type': 'audio/mp4', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/100', 'Accept-Ranges': 'bytes',
        } });
    });
    const res = await edge.request('/proxy?url=' + encodeURIComponent(MEDIA), { headers: { Range: 'bytes=0-3', 'If-Range': 'test-etag' } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), 'test');
    assert.equal(res.headers.get('Content-Range'), 'bytes 0-3/100');
    assert.equal(res.headers.get('Content-Length'), '4');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.match(res.headers.get('Access-Control-Expose-Headers'), /Content-Range/);
});

test('HEAD forwards HEAD and returns no response body', async () => {
    const edge = harness((_url, init) => {
        assert.equal(init.method, 'HEAD');
        return new Response(null, { headers: { 'Content-Length': '100' } });
    });
    const res = await edge.request('/proxy?url=' + encodeURIComponent(MEDIA), { method: 'HEAD' });
    assert.equal(await res.text(), '');
    assert.equal(res.headers.get('Content-Length'), '100');
    const api = harness();
    const head = await api.request('/resolve?bvid=' + BV, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
});

test('proxy keeps 416 Content-Range, and supports safe media redirects', async () => {
    const range = harness(() => new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */100' } }));
    const res = await range.request('/proxy?url=' + encodeURIComponent(MEDIA));
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('Content-Range'), 'bytes */100');
    const redirect = harness((_url, _init, call) => call === 1
        ? new Response(null, { status: 302, headers: { Location: 'https://upos-hz-mirrorakam.akamaized.net/audio.m4s' } })
        : new Response('audio'));
    assert.equal(await (await redirect.request('/proxy?url=' + encodeURIComponent(MEDIA))).text(), 'audio');
    assert.equal(redirect.calls.length, 2);
});

test('proxy rejects arbitrary hosts and unsafe redirects', async () => {
    for (const target of ['http://127.0.0.1/', 'https://bilivideo.com.evil.example/', 'https://api.bilibili.com/', 'http://a.bilivideo.com/a', 'https://user:pass@a.bilivideo.com/a']) {
        const edge = harness();
        assert.equal((await edge.request('/proxy?url=' + encodeURIComponent(target))).status, 400);
        assert.equal(edge.calls.length, 0);
    }
    const edge = harness(() => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }));
    assert.equal((await edge.request('/proxy?url=' + encodeURIComponent(MEDIA))).status, 400);
    assert.equal(edge.calls.length, 1);
});

test('fans route remains compatible', async () => {
    const edge = harness(url => {
        assert.equal(url.pathname, '/x/relation/stat');
        assert.equal(url.searchParams.get('vmid'), '3537115310721781');
        return json({ code: 0, data: { follower: 100 } });
    });
    assert.equal((await (await edge.request('/fans?vmid=3537115310721781')).json()).data.follower, 100);
    assert.equal((await edge.request('/fans?vmid=bad')).status, 400);
});

test('browser preserves case-sensitive BV payloads and accepts only BV IDs', () => {
    const api = browser();
    assert.equal(api.normalizeId(' bv17uZQBHEDo '), BV);
    for (const invalid of ['', 'av170001', 170001, 'av0', 'av-1', 'BVabc', '123abc']) assert.equal(api.normalizeId(invalid), '');
});

test('browser and replacement edge interoperate for BV resolution and proxy playback', async () => {
    const edge = harness((url) => {
        if (url.hostname.endsWith('.bilivideo.com')) return new Response('audio', { status: 206 });
        if (url.pathname.endsWith('pagelist')) return json({ code: 0, data: pages });
        return json({ code: 0, data: { dash: { audio } } });
    });
    const api = browser(url => edge.request(new URL(url).pathname + new URL(url).search));
    const client = api.createClient('https://edge.example/');
    for (const id of [BV]) {
        assert.equal(await client.validate(id), 'valid');
        const data = await client.resolve(id, 'high');
        assert.equal(data.url, MEDIA);
        assert.equal(new URL(data.proxyUrl).searchParams.get('url'), MEDIA);
        const media = await edge.request(new URL(data.proxyUrl).pathname + new URL(data.proxyUrl).search);
        assert.equal(media.status, 206);
        assert.equal(await media.text(), 'audio');
    }
});

test('browser never treats an HTTP failure containing valid:false as a missing song', async () => {
    const api = browser(() => new Response(JSON.stringify({ valid: false, code: 'BILI_RISK_CONTROL', error: 'B 站暂时限制访问' }), { status: 503 }));
    const client = api.createClient('https://edge.example');
    await assert.rejects(client.validate(BV), error => error.code === 'BILI_RISK_CONTROL');
    await assert.rejects(client.resolve(BV), /B 站暂时限制访问/);
});

test('browser handles network errors, malformed responses and empty audio URLs', async () => {
    for (const [fetch, expected] of [
        [() => { throw new Error('offline'); }, /检查网络/],
        [() => new Response('<html>bad'), /返回异常/],
        [() => json({ url: '' }), /未获取到/],
    ]) {
        await assert.rejects(browser(fetch).createClient('https://edge.example').resolve(BV), expected);
    }
});

test('actual custom-song form preserves the existing BV storage schema', async () => {
    const start = playerSource.indexOf('function submitCustomForm()');
    const end = playerSource.indexOf('\n        loadSongs();', start);
    const fields = {
        'custom-form-name': { value: '测试歌曲', dataset: {} },
        'custom-form-bvid': { value: ' ' + BV + ' ' },
        'custom-form-lyrics': { value: '' },
    };
    let saved;
    const list = [];
    const sandbox = vm.createContext({
        document: { getElementById: id => fields[id] },
        window: { SG_BILI_API: browser() }, customList: list,
        isValidBvidFormat: id => !!browser().normalizeId(id),
        validateBvidExists: async () => 'valid',
        saveCustomToStorage: rows => { saved = JSON.parse(JSON.stringify(rows)); },
        buildSongList() {}, renderPlaylist() {}, renderCustomSectionInSettings() {}, closeCustomForm() {},
        alert(message) { assert.fail(message); }, confirm() { assert.fail('unexpected confirmation'); },
    });
    vm.runInContext(playerSource.slice(start, end) + '\nsubmitCustomForm();', sandbox);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(saved, [{ name: '测试歌曲', bvid: BV }]);
});

test('both pages load the shared API before the player and retain BV input', () => {
    for (const path of ['../index.html', '../fiona/index.html']) {
        const html = readFileSync(new URL(path, import.meta.url), 'utf8');
        assert.ok(html.indexOf('bili-api.js?v=20261018') < html.indexOf('index.js?v=20261018'));
        assert.match(html, /placeholder="BVxxxxxxxxxx"/);
    }
});

async function playback({ preload = false, expired = false, playError, resolveError, retryError, rapidSwitch = false } = {}) {
    const start = playerSource.indexOf('async function playMusic(bvid)');
    const end = playerSource.indexOf('\n        function handlePlayError(', start);
    let plays = 0, resolves = 0, refreshes = 0, visuals = 0;
    const errors = [];
    let releaseOld;
    function audioObject() {
        return {
            src: '', pause() {}, load() {}, remove() {}, removeEventListener() {},
            async play() { plays++; if (playError && plays === 1) throw playError; },
        };
    }
    const sandbox = vm.createContext({
        window: {}, settings: { cacheEnabled: 'off' }, Date, URL,
        playRequestVersion: 0, releaseCachedAudioUrl() {}, audioCacheDownloadController: null,
        clearPlaybackError() {},
        preloadCache: preload ? { bvid: BV, url: 'https://edge.example/old', createdAt: Date.now() - (expired ? 61000 : 0) } : null,
        bgmAudio: audioObject(), globalPreloadAudio: audioObject(), Audio: audioObject,
        clearPreload() {}, bindAudioEvents() {}, stopInitialPreload() {},
        handleAudioEnded() {}, handleAudioPlay() {}, handleAudioPause() {}, handleAudioError() {},
        showLoadingInfo() {}, hideLoadingInfo() {}, updateProgressDisplay() {}, updatePlaySongName() {},
        updatePlayPauseIcon() {}, updateMediaSession() {}, currentPlayingBvid: '',
        startVisuals() { visuals++; },
        handlePlayError(_bvid, error) { errors.push(error); },
        async fetchResolveViaProxy(id) {
            resolves++;
            if (rapidSwitch && id === BV) return new Promise(resolve => { releaseOld = () => resolve({ url: 'https://edge.example/old' }); });
            if (resolveError) throw resolveError;
            return { url: 'https://edge.example/new' };
        },
        async getLoadableRealUrl() {
            refreshes++;
            if (retryError) throw retryError;
            return 'https://edge.example/refreshed';
        },
        console: { error() {} },
        releaseOld() { releaseOld(); },
    });
    const action = rapidSwitch
        ? `(async () => { const old = playMusic('${BV}'); await playMusic('BV1Sf421Q7Rt'); releaseOld(); await old; })();`
        : '\nplayMusic(' + JSON.stringify(BV) + ');';
    await vm.runInContext(playerSource.slice(start, end) + '\n' + action, sandbox);
    return { plays, resolves, refreshes, visuals, errors, src: sandbox.bgmAudio.src, bvid: sandbox.currentPlayingBvid };
}

test('actual playback calls play only once for a freshly resolved song', async () => {
    const result = await playback();
    assert.equal(result.plays, 1);
    assert.equal(result.resolves, 1);
    assert.equal(result.visuals, 1);
    assert.equal(result.errors.length, 0);
});

test('actual playback refreshes an expired preload instead of using it', async () => {
    const result = await playback({ preload: true, expired: true });
    assert.equal(result.resolves, 1);
    assert.equal(result.src, 'https://edge.example/new');
});

test('failed preloaded audio is refreshed once and the returned URL is used', async () => {
    const result = await playback({ preload: true, playError: new Error('expired audio') });
    assert.equal(result.plays, 2);
    assert.equal(result.refreshes, 1);
    assert.equal(result.resolves, 0);
    assert.equal(result.src, 'https://edge.example/refreshed');
    assert.equal(result.errors.length, 0);
    assert.equal(result.visuals, 1);
});

test('playback reports resolve and refresh failures without an unhandled rejection', async () => {
    const error = new Error('B 站暂时限制访问');
    const result = await playback({ resolveError: error });
    assert.equal(result.plays, 0);
    assert.equal(result.resolves, 1);
    assert.equal(result.errors[0], error);
    const retry = await playback({ preload: true, playError: new Error('expired'), retryError: error });
    assert.equal(retry.refreshes, 1);
    assert.equal(retry.errors[0], error);
});

test('browser autoplay and aborted playback do not trigger another resolve', async () => {
    for (const name of ['NotAllowedError', 'AbortError']) {
        const error = Object.assign(new Error('play rejected'), { name });
        const result = await playback({ preload: true, playError: error });
        assert.equal(result.plays, 1);
        assert.equal(result.refreshes, 0);
        assert.equal(result.errors[0], error);
    }
});

test('a slower previous track cannot overwrite the latest selection', async () => {
    const result = await playback({ rapidSwitch: true });
    assert.equal(result.bvid, 'BV1Sf421Q7Rt');
    assert.equal(result.src, 'https://edge.example/new');
    assert.equal(result.plays, 1);
});
