import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../edge-functions/bilibili.js', import.meta.url), 'utf8');
const ORIGIN = 'https://snow-gladys.com', MEDIA = 'https://example.bilivideo.com/live-bvc/123/radio.m3u8?token=test';
const json = data => new Response(JSON.stringify({ code: 0, data }));
function edge(fetch) {
    const calls = [], context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, TextDecoder, Uint8Array, console,
        addEventListener() {}, fetch: async (url, options) => { calls.push(new URL(url)); return fetch(new URL(url), options); } });
    vm.runInContext(source, context);
    return { calls, context, request: path => context.handleRequest(new Request('https://edge.example' + path, { headers: { Origin: ORIGIN } })) };
}
function packet(pid, payload, start = true, counter = 0) {
    const p = new Uint8Array(188).fill(255), adaptation = 183 - payload.length;
    p.set([0x47, (start ? 64 : 0) | (pid >> 8), pid & 255, 0x30 | counter, adaptation]);
    if (adaptation > 0) p[5] = 0;
    p.set(payload, 5 + adaptation); return p;
}
function fixture() {
    const pat = packet(0, [0, 0, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0, 0, 0, 0, 0]);
    const pmt = packet(4096, [0, 2, 0xb0, 18, 0, 1, 0xc1, 0, 0, 0xe1, 1, 0xf0, 0, 15, 0xe1, 1, 0xf0, 0, 0, 0, 0, 0]);
    const aac = new Uint8Array([255, 241, 80, 128, 1, 95, 252, 1, 2, 3]); // one 10-byte ADTS frame
    const pes = packet(257, [0, 0, 1, 0xc0, 0, 18, 128, 128, 5, 0x21, 0, 5, 0xbf, 0x21, ...aac]);
    const video = packet(256, [0, 0, 1, 0xe0, ...new Array(20).fill(77)]);
    const bytes = new Uint8Array(188 * 4); bytes.set(pat); bytes.set(pmt, 188); bytes.set(video, 376); bytes.set(pes, 564);
    return { bytes, aac };
}
test('live status batches only five fixed UIDs, excludes replays, coalesces and caches', async () => {
    const h = edge(url => {
        assert.equal(url.hostname, 'api.live.bilibili.com'); assert.equal(url.searchParams.getAll('uids[]').length, 5);
        return json({ '672328094': { live_status: 1, title: '<直播>' }, '672342685': { live_status: 2 } });
    });
    const [a, b] = await Promise.all([h.request('/live/status'), h.request('/live/status')]);
    const data = await a.json(); assert.equal((await b.json()).members.length, 5);
    assert.equal(data.members.find(item => item.id === 'diana').live, true);
    assert.deepEqual(data.members.find(item => item.id === 'eileen'), { id: 'eileen', room: '22625027', live: false, known: true, title: '' });
    assert.equal(data.members[0].known, false); await h.request('/live/status'); assert.equal(h.calls.length, 1);
});
test('offline and no-stream rooms produce actionable errors; arbitrary room IDs are rejected', async () => {
    let h = edge(() => json({ live_status: 0 }));
    let r = await h.request('/live/stream?member=diana'); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'LIVE_OFFLINE');
    r = await h.request('/live/stream?member=123'); assert.equal(r.status, 400); assert.equal(h.calls.length, 1);
    h = edge(() => json({ live_status: 1, playurl_info: {} })); assert.equal((await h.request('/live/stream?member=bella')).status, 422);
});
test('live stream selects HTTPS TS HLS and does not return IP, encrypted or arbitrary streams', async () => {
    const h = edge(url => {
        assert.equal(url.searchParams.get('room_id'), '22637261'); assert.equal(url.searchParams.get('only_audio'), '1');
        return json({ live_status: 1, playurl_info: { playurl: { stream: [{ protocol_name: 'http_hls', format: [{ format_name: 'ts', codec: [{ base_url: '/live-bvc/123/radio.m3u8?', url_info: [
            { host: 'http://127.0.0.1', extra: '' }, { host: 'http://example.bilivideo.com', extra: 'token=test' },
        ] }] }] }] } } });
    });
    const r = await h.request('/live/stream?member=diana'), data = await r.json();
    assert.equal(r.status, 200); const url = new URL(data.url); assert.equal(url.pathname, '/live/playlist.m3u8'); assert.equal(url.searchParams.get('url'), MEDIA);
});
test('playlist routes all TS references through AAC extraction and retains live sequence timing', async () => {
    const h = edge(() => new Response('#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:30\n#EXTINF:4.1,\nradio-30.ts\n'));
    const r = await h.request('/live/playlist.m3u8?url=' + encodeURIComponent(MEDIA)), text = await r.text();
    assert.equal(r.status, 200); assert.match(text, /MEDIA-SEQUENCE:30/); assert.match(text, /\/live\/segment\.aac\?url=/); assert.match(r.headers.get('Content-Type'), /mpegurl/);
    const link = text.split('\n').find(line => line.startsWith('https:')); assert.equal(new URL(link).searchParams.get('url'), 'https://example.bilivideo.com/live-bvc/123/radio-30.ts');
});
test('live proxy rejects private IPs, unexpected files, malicious references and unsafe redirects', async () => {
    const h = edge(() => new Response('', { status: 302, headers: { Location: 'https://127.0.0.1/private.ts' } }));
    assert.equal((await h.request('/live/segment.aac?url=' + encodeURIComponent('https://127.0.0.1/live-bvc/x.ts'))).status, 400);
    assert.equal(h.calls.length, 0);
    assert.equal((await h.request('/live/segment.aac?url=' + encodeURIComponent(MEDIA))).status, 400);
    const r = await h.request('/live/segment.aac?url=' + encodeURIComponent(MEDIA.replace('m3u8?token=test', 'ts'))); assert.equal(r.status, 400); assert.equal(h.calls.length, 1);
    const malicious = edge(() => new Response('#EXTM3U\n#EXTINF:4,\nhttps://attacker.example/x.ts\n'));
    assert.equal((await malicious.request('/live/playlist.m3u8?url=' + encodeURIComponent(MEDIA))).status, 400);
});
test('AAC extraction removes video and TS overhead, adds ID3 PTS, and caches bounded segments', async () => {
    const { bytes, aac } = fixture(), h = edge(() => new Response(bytes));
    const path = '/live/segment.aac?url=' + encodeURIComponent(MEDIA.replace('m3u8?token=test', 'ts'));
    const [r, other] = await Promise.all([h.request(path), h.request(path)]); assert.equal(r.status, 200);
    const result = new Uint8Array(await r.arrayBuffer()); assert.equal(new TextDecoder().decode(result.subarray(0, 3)), 'ID3');
    assert.deepEqual(result.slice(-10), aac); assert.ok(result.length < bytes.length / 2); assert.equal(h.calls.length, 1); assert.equal(other.status, 200);
    await h.request(path); assert.equal(h.calls.length, 1); assert.equal(r.headers.get('Content-Type'), 'audio/aac');
});
test('invalid, empty and encrypted live media fails without leaking raw video', async () => {
    const h = edge(() => new Response(new Uint8Array(188))); const r = await h.request('/live/segment.aac?url=' + encodeURIComponent(MEDIA.replace('m3u8?token=test', 'ts')));
    assert.equal(r.status, 422); assert.match(r.headers.get('Content-Type'), /json/);
    const encrypted = edge(() => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="x"\n#EXTINF:4,\nx.ts\n'));
    assert.equal((await encrypted.request('/live/playlist.m3u8?url=' + encodeURIComponent(MEDIA))).status, 422);
});
