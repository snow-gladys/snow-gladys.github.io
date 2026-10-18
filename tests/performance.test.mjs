import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const BV = 'BV17uZQBHEDo';

test('cache metadata queries avoid Blob reads and share one database connection', async () => {
    const calls = { open: 0, get: 0, keys: 0, count: 0 };
    const request = result => {
        const req = { result };
        queueMicrotask(() => req.onsuccess({ target: { result } }));
        return req;
    };
    const db = {
        transaction() { return { objectStore() { return {
            getAll() { assert.fail('Metadata lookup must not read audio records'); },
            getAllKeys() { calls.keys++; return request([BV]); },
            count(key) { calls.count++; return request(key === BV ? 1 : 0); },
            get() { calls.get++; return request({ blob: new Blob(['audio']) }); },
        }; } }; },
    };
    const indexedDB = { open() { calls.open++; return request(db); } };
    const window = { indexedDB };
    vm.runInNewContext(source('cache-db.js'), { window, indexedDB, Blob, Promise });
    const [keys, has, missing] = await Promise.all([
        window.SG_CACHE.listCachedBvids(), window.SG_CACHE.hasCached(BV), window.SG_CACHE.hasCached('missing'),
    ]);
    assert.deepEqual(Array.from(keys), [BV]);
    assert.equal(has, true);
    assert.equal(missing, false);
    assert.equal(await window.SG_CACHE.hasCached(''), false);
    assert.deepEqual(calls, { open: 1, get: 0, keys: 1, count: 2 });
    assert.equal(await (await window.SG_CACHE.getCachedBlob(BV)).text(), 'audio');
});

function lyrics(fetch) {
    const window = {};
    vm.runInNewContext(source('lyrics-db.js'), { window, fetch, Promise, Map });
    return window.SG_LYRICS;
}

test('concurrent and repeated lyric loads share index and parsed builtin results', async () => {
    const calls = [];
    const api = lyrics(async url => {
        calls.push(url);
        return url.endsWith('lyrics.json')
            ? new Response(JSON.stringify({ map: { [BV]: 'song.lrc' } }))
            : new Response('[00:01.00]系统歌词');
    });
    const results = await Promise.all([api.loadLyrics(BV, null), api.loadLyrics(BV, null), api.loadLyrics(BV, null)]);
    assert.equal(results[0][0].text, '系统歌词');
    assert.equal(await api.loadLyrics(BV, null), results[0]);
    assert.deepEqual(calls, ['./lyrics/lyrics.json', './lyrics/song.lrc']);
    const custom = await api.loadLyrics(BV, '[00:02.00]自定义歌词');
    assert.equal(custom[0].text, '自定义歌词');
    assert.equal((await api.loadLyrics(BV, null))[0].text, '系统歌词');
    assert.equal(calls.length, 2);
});

test('failed lyric requests can recover on a later load', async () => {
    let requests = 0;
    const api = lyrics(async url => {
        requests++;
        if (requests === 1) return new Response('offline', { status: 503 });
        return url.endsWith('lyrics.json')
            ? new Response(JSON.stringify({ map: { [BV]: 'song.lrc' } }))
            : new Response('[00:01.00]恢复');
    });
    assert.equal(await api.loadLyrics(BV, null), null);
    assert.equal((await api.loadLyrics(BV, null))[0].text, '恢复');
    assert.equal(requests, 3);
});

test('changing lyric base paths invalidates the old cached results', async () => {
    const calls = [];
    const api = lyrics(async url => {
        calls.push(url);
        return url.endsWith('lyrics.json')
            ? new Response(JSON.stringify({ map: { [BV]: 'song.lrc' } }))
            : new Response('[00:01.00]' + url);
    });
    await api.loadLyrics(BV, null);
    api.setBasePath('../lyrics/');
    assert.equal((await api.loadLyrics(BV, null))[0].text, '../lyrics/song.lrc');
    assert.deepEqual(calls, ['./lyrics/lyrics.json', './lyrics/song.lrc', '../lyrics/lyrics.json', '../lyrics/song.lrc']);
});

test('identical simultaneous audio resolutions share a request, later resolves refresh it', async () => {
    let calls = 0;
    const window = {};
    vm.runInNewContext(source('bili-api.js'), {
        window,
        async fetch() { calls++; await Promise.resolve(); return new Response(JSON.stringify({ url: 'https://a.bilivideo.com/audio' })); },
    });
    const client = window.SG_BILI_API.createClient('https://edge.example');
    await Promise.all([client.resolve(BV), client.resolve(BV)]);
    assert.equal(calls, 1);
    await client.resolve(BV);
    assert.equal(calls, 2);
});

test('binary lyric lookup matches the previous behavior for seeking and duplicate timestamps', () => {
    const player = source('index.js');
    const start = player.indexOf('function findLyricIndex(');
    const end = player.indexOf('\n        function updateLyricHighlight', start);
    const sandbox = vm.createContext({});
    vm.runInContext(player.slice(start, end), sandbox);
    const lines = [{ time: 0 }, { time: 1 }, { time: 1 }, { time: 3 }, { time: 8 }];
    for (const time of [-1, 0, 0.5, 1, 2, 3, 7, 8, 100, NaN]) {
        const expected = lines.findLastIndex(line => time >= line.time);
        assert.equal(sandbox.findLyricIndex(lines, time), expected);
    }
    assert.equal(sandbox.findLyricIndex([], 0), -1);
});
