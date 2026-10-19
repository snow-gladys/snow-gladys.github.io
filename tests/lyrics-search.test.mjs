import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function load(fetch, extra = {}) {
    const window = {};
    const sandbox = vm.createContext({ window, fetch, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout, ...extra });
    vm.runInContext(source('lyrics-db.js'), sandbox);
    vm.runInContext(source('lyrics-search.js'), sandbox);
    return { api: window.SG_LYRIC_SEARCH, lyrics: window.SG_LYRICS };
}
const response = data => new Response(JSON.stringify(data));
const record = (id = 1, extra = {}) => ({ id, trackName: '如愿', artistName: '王菲', albumName: '单曲', duration: 265, syncedLyrics: '[00:02.00]第一句\n[00:07.50]第二句', ...extra });

test('extracts a song name from a Bilibili title without requesting anything on load', () => {
    const { api } = load(() => assert.fail('search must be explicitly submitted'));
    assert.equal(api.guessTitle('【思诺翻唱】《如愿》直播切片'), '如愿');
    assert.equal(api.guessTitle(' 小美满 '), '小美满');
    assert.equal(api.guessTitle(null), '');
});

test('search uses structured title and optional artist, preserving timed LRC', async () => {
    const { api } = load(async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'https://lrclib.net');
        assert.equal(parsed.pathname, '/api/search');
        assert.equal(parsed.searchParams.get('track_name'), '如愿');
        assert.equal(parsed.searchParams.get('artist_name'), '王菲');
        assert.ok(options.signal instanceof AbortSignal);
        return response([record()]);
    });
    const found = await api.search(' 如愿 ', ' 王菲 ');
    assert.equal(found[0].lrc, record().syncedLyrics);
    assert.equal(found[0].timed, true);
    assert.equal(found[0].artist, '王菲');
});

test('plain lyrics remain importable for sequential manual alignment', () => {
    const { api, lyrics } = load();
    const found = api.prepareRecord(record(1, { syncedLyrics: null, plainLyrics: ' 第一行 \n\n第二行' }));
    assert.equal(found.timed, false);
    assert.equal(found.lrc, '[00:00.00] 第一行\n[00:00.00] 第二行');
    assert.deepEqual(Array.from(lyrics.parseLrc(found.lrc), line => ({ ...line })), [{ time: 0, text: '第一行' }, { time: 0, text: '第二行' }]);
});

test('filters unusable records, deduplicates IDs and lists timed versions first', async () => {
    const { api } = load(() => response([null, record(1, { syncedLyrics: null, plainLyrics: '纯文本' }), record(2), record(2), record(3, { instrumental: true }), record(4, { syncedLyrics: 'not LRC' }), record('bad')]));
    const found = await api.search('如愿');
    assert.deepEqual(Array.from(found, item => item.id), [2, 1]);
});

test('blank queries are rejected before contacting the lyrics service', async () => {
    const { api } = load(() => assert.fail('empty query should not fetch'));
    await assert.rejects(api.search('  '), /请输入歌名/);
});

test('empty and malformed search responses have different outcomes', async () => {
    assert.equal((await load(() => response([])).api.search('missing')).length, 0);
    await assert.rejects(load(() => response({ error: 'bad' })).api.search('song'), /数据异常/);
    await assert.rejects(load(() => new Response('<html>error</html>')).api.search('song'), /数据异常/);
});

test('HTTP failures are retryable and never become no-results messages', async () => {
    for (const status of [429, 503]) {
        let calls = 0;
        const { api } = load(() => ++calls === 1 ? new Response('failed', { status }) : response([record()]));
        await assert.rejects(api.search('song'), status === 429 ? /频繁/ : /暂时不可用/);
        assert.equal((await api.search('song')).length, 1);
    }
});

test('external abort propagates and aborts the fetch request', async () => {
    const controller = new AbortController();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const { api } = load((_, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
        started();
    }));
    const pending = api.search('song', '', controller.signal);
    await ready; controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await assert.rejects(api.search('song', '', AbortSignal.abort()), { name: 'AbortError' });
});

test('timeout stops the request and explains how to retry', async () => {
    let expire, cleared = false;
    const { api } = load((_, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
    }), { setTimeout: callback => { expire = callback; return 123; }, clearTimeout: id => { cleared = id === 123; } });
    const pending = api.search('song'); expire();
    await assert.rejects(pending, /搜索超时/);
    assert.equal(cleared, true);
});

test('both players expose search before loading the shared editor integration', () => {
    for (const file of ['index.html']) {
        const html = source(file);
        assert.ok(html.indexOf('lyrics-search.js?') < html.indexOf('index.js?'));
        assert.match(html, /id="lyric-search-panel" hidden/);
        assert.match(html, /id="lyric-search-title"[^>]*required/);
        assert.match(html, /id="lyric-search-preview-text"[^>]*aria-label/);
    }
});
