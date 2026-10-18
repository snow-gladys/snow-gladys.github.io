import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const edgeSource = readFileSync(new URL('../edge-functions/bilibili.js', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../bili-api.js', import.meta.url), 'utf8');
const ID = '3736153875';
const A = 'BV17uZQBHEDo', B = 'BV1Sf421Q7Rt';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function client(fetch) {
    const window = {};
    vm.runInNewContext(clientSource, { window, fetch, URL, DOMException });
    return window.SG_BILI_API;
}
function edge(fetch) {
    const sandbox = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, fetch, console, addEventListener() {} });
    vm.runInContext(edgeSource, sandbox);
    return path => sandbox.handleRequest(new Request('https://edge.example' + path, { headers: { Origin: 'https://snow-gladys.com' } }));
}
const raw = medias => ({ code: 0, data: {
    info: { id: Number(ID), title: '公开收藏夹', media_count: (medias || []).length, upper: { name: '作者' } },
    medias, has_more: false,
} });
const video = (bvid = A, title = '歌曲') => ({ type: 2, attr: 0, bvid, title, duration: 90, upper: { name: 'UP主' } });
const page = (pn, items, extra = {}) => ({ mediaId: ID, page: pn, title: '歌单', total: 2, scanned: 1, skipped: 0, items, hasMore: pn === 1, ...extra });

test('extracts the complete folder ID from the supplied link and supported variants', () => {
    const api = client();
    for (const input of [ID, 'ml' + ID, 'https://space.bilibili.com/509596275?fid=' + ID,
        'space.bilibili.com/509596275/favlist?fid=' + ID,
        'https://www.bilibili.com/medialist/detail/ml' + ID,
        'https://www.bilibili.com/list/ml' + ID]) assert.equal(api.favoriteId(input), ID);
    for (const input of ['', '0', '509596275?fid=bad', 'https://evil.example/?fid=' + ID, A]) assert.equal(api.favoriteId(input), '');
});

test('edge reads the exact public folder and filters invalid or non-video entries', async () => {
    const handler = edge(async url => {
        const target = new URL(url);
        assert.equal(target.pathname, '/x/v3/fav/resource/list');
        assert.equal(target.searchParams.get('media_id'), ID);
        assert.equal(target.searchParams.get('ps'), '20');
        assert.equal(target.searchParams.get('pn'), '2');
        return json(raw([video(), { ...video(B), bvid: undefined, bv_id: B }, { ...video(), attr: 9 }, { ...video(), type: 12 }, { ...video(), bvid: '' }]));
    });
    const response = await handler('/favorites?media_id=' + ID + '&pn=2');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.items.map(song => song.bvid), [A, B]);
    assert.equal(result.scanned, 5);
    assert.equal(result.skipped, 3);
    assert.equal(result.owner, '作者');
});

test('invalid folder IDs and page numbers never issue upstream requests', async () => {
    const handler = edge(() => assert.fail('unexpected request'));
    for (const path of ['/favorites', '/favorites?media_id=bad', '/favorites?media_id=' + ID + '&pn=0', '/favorites?media_id=' + ID + '&pn=501']) {
        assert.equal((await handler(path)).status, 400);
    }
});

test('private, missing, and risk-controlled folders have distinct errors', async () => {
    for (const [code, expected] of [[-403, 'FAVORITE_NOT_PUBLIC'], [-404, 'FAVORITE_NOT_FOUND'], [-412, 'BILI_RISK_CONTROL']]) {
        const response = await edge(() => json({ code }))('/favorites?media_id=' + ID);
        assert.equal((await response.json()).code, expected);
    }
});

test('empty folders are valid but malformed pagination is rejected', async () => {
    const empty = raw(null); empty.data.info.media_count = 0;
    assert.deepEqual((await (await edge(() => json(empty))('/favorites?media_id=' + ID)).json()).items, []);
    const bad = raw([]); bad.data.has_more = 'yes';
    assert.equal((await edge(() => json(bad))('/favorites?media_id=' + ID)).status, 502);
});

test('client reads all pages sequentially and reports progress', async () => {
    const requested = [], progress = [];
    const api = client(async url => {
        const pn = Number(new URL(url).searchParams.get('pn')); requested.push(pn);
        return json(page(pn, [{ name: '歌曲' + pn, bvid: pn === 1 ? A : B }]));
    });
    const result = await api.createClient('https://edge.example').loadFavorites('https://space.bilibili.com/509596275?fid=' + ID, { onProgress: p => progress.push(p.scanned) });
    assert.deepEqual(requested, [1, 2]);
    assert.deepEqual(progress, [1, 2]);
    assert.deepEqual(Array.from(result.items, item => item.bvid), [A, B]);
});

test('second-page failure returns no partially successful import', async () => {
    const api = client(async url => new URL(url).searchParams.get('pn') === '1'
        ? json(page(1, [{ name: '歌曲', bvid: A }]))
        : new Response(JSON.stringify({ error: 'B站风控', code: 'BILI_RISK_CONTROL' }), { status: 503 }));
    await assert.rejects(api.createClient('https://edge.example').loadFavorites(ID), /B站风控/);
});

test('early termination and repeating pages are not silently treated as complete', async () => {
    const incomplete = client(() => json(page(1, [{ name: '歌曲', bvid: A }], { hasMore: false })));
    await assert.rejects(incomplete.createClient('https://edge.example').loadFavorites(ID), /不完整/);
    const repeated = client(url => json(page(Number(new URL(url).searchParams.get('pn')), [{ name: '歌曲', bvid: A }], { hasMore: true })));
    await assert.rejects(repeated.createClient('https://edge.example').loadFavorites(ID), /重复或缺失/);
});

test('cancelled loads preserve AbortError and stop fetching pages', async () => {
    const signal = AbortSignal.abort();
    const api = client(() => assert.fail('cancelled request should not start'));
    await assert.rejects(api.createClient('https://edge.example').loadFavorites(ID, { signal }), { name: 'AbortError' });
});

test('merge deduplicates BV IDs, preserves existing names and never mutates the old list', () => {
    const api = client();
    const existing = [{ name: '原来的名字', bvid: A }];
    const merged = api.mergeCustomSongs(existing, [{ name: '新名字', bvid: A }, { name: '新歌曲', bvid: B }, { name: '重复', bvid: B }, { name: '无效', bvid: 'bad' }]);
    assert.equal(merged.added, 1);
    assert.equal(merged.songs.length, 2);
    assert.equal(merged.songs[0].name, '原来的名字');
    assert.equal(existing.length, 1);
});

test('both players load the importer and expose an accessible native preview dialog', () => {
    for (const file of ['../index.html', '../fiona/index.html']) {
        const html = readFileSync(new URL(file, import.meta.url), 'utf8');
        assert.match(html, /<dialog class="favorites-import-dialog"/);
        assert.ok(html.indexOf('favorites-import.js?') < html.indexOf('index.js?'));
        assert.match(html, /id="favorites-import-submit" disabled/);
    }
});

test('imported video titles remain literal text in playback loading messages', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('function updateLoadingInfoContent(');
    const end = source.indexOf('function hideLoadingInfo()', start);
    const title = {}, detail = {};
    const sandbox = vm.createContext({ loadingInfoEl: {
        querySelector: selector => selector === '.loading-title' ? title : detail,
        set innerHTML(_) { assert.fail('existing loading nodes should be reused'); },
    }, loadingStartTime: null, bgmAudio: { readyState: 0 } });
    vm.runInContext(source.slice(start, end), sandbox);
    const name = '<img src=x onerror=alert(1)> & 歌曲';
    sandbox.updateLoadingInfoContent(name, 'resolve');
    assert.equal(title.textContent, '歌曲《' + name + '》加载中');
    assert.match(detail.textContent, /获取音频ID/);
});
