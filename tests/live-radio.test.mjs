import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../edge-functions/bilibili.js', import.meta.url), 'utf8');
const ORIGIN = 'https://snow-gladys.com', MEDIA = 'https://example.bilivideo.com/live-bvc/123/radio.m3u8?token=test';
const json = data => new Response(JSON.stringify({ code: 0, data }));
function edge(fetch) {
    const calls = [], context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView, console,
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
        if (url.pathname.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:4,\nradio.ts\n');
        if (url.pathname.endsWith('.ts')) return new Response(fixture().bytes);
        assert.equal(url.searchParams.get('room_id'), '22637261'); assert.equal(url.searchParams.get('only_audio'), '1');
        return json({ live_status: 1, playurl_info: { playurl: { stream: [{ protocol_name: 'http_hls', format: [{ format_name: 'ts', codec: [{ base_url: '/live-bvc/123/radio.m3u8?', url_info: [
            { host: 'http://127.0.0.1', extra: '' }, { host: 'http://example.bilivideo.com', extra: 'token=test' },
        ] }] }] }] } } });
    });
    const r = await h.request('/live/stream?member=diana'), data = await r.json();
    assert.equal(r.status, 200); const url = new URL(data.url); assert.equal(url.pathname, '/live/playlist.m3u8'); assert.equal(url.searchParams.get('url'), MEDIA);
});
test('EdgeOne ArrayBuffer, DataView and string stream chunks are read without losing data', async () => {
    const text = '#EXTM3U\n#EXTINF:4,\nradio.ts\n', bytes = new TextEncoder().encode(text);
    for (const value of [bytes.buffer, new DataView(bytes.buffer), text]) {
        const h = edge(() => {
            let read = false;
            return { ok: true, status: 200, body: { getReader: () => ({ async read() { if (read) return { done: true }; read = true; return { done: false, value }; }, async cancel() {} }) } };
        });
        const r = await h.request('/live/playlist.m3u8?url=' + encodeURIComponent(MEDIA));
        assert.equal(r.status, 200); assert.match(await r.text(), /segment.aac/);
    }
});
test('unreachable first CDN is skipped and audio from the working backup is verified', async () => {
    const h = edge(url => {
        if (url.hostname === 'bad.bilivideo.com') throw new Error('connect timeout');
        if (url.pathname.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXTINF:4,\nradio.ts\n');
        if (url.pathname.endsWith('.ts')) return new Response(fixture().bytes);
        return json({ live_status: 1, playurl_info: { playurl: { stream: [{ protocol_name: 'http_hls', format: [{ format_name: 'ts', codec: [{ base_url: '/live-bvc/123/radio.m3u8?', url_info: [
            { host: 'https://bad.bilivideo.com', extra: '' }, { host: 'https://good.bilivideo.com', extra: '' },
        ] }] }] }] } } });
    });
    const r = await h.request('/live/stream?member=diana'); assert.equal(r.status, 200);
    assert.equal(new URL(new URL((await r.json()).url).searchParams.get('url')).hostname, 'good.bilivideo.com');
    assert.ok(h.calls.some(url => url.pathname.endsWith('.ts')));
});
test('all failing CDNs return a readable error before interrupting music playback', async () => {
    const h = edge(url => {
        if (url.hostname.endsWith('.bilivideo.com')) throw new Error('offline');
        return json({ live_status: 1, playurl_info: { playurl: { stream: [{ protocol_name: 'http_hls', format: [{ format_name: 'ts', codec: [{ base_url: '/live-bvc/123/radio.m3u8?', url_info: [{ host: 'https://bad.bilivideo.com', extra: '' }] }] }] }] } } });
    });
    const r = await h.request('/live/stream?member=diana'); assert.equal(r.status, 502); assert.equal((await r.json()).code, 'LIVE_CDN_UNREACHABLE');
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

function mp4Fixture() {
    const u32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; };
    const join = (...values) => { const bytes = new Uint8Array(values.reduce((n, b) => n + b.length, 0)); let at = 0; for (const value of values) { bytes.set(value, at); at += value.length; } return bytes; };
    const text = value => new TextEncoder().encode(value);
    const box = (name, ...parts) => { const data = join(...parts); return join(u32(data.length + 8), text(name), data); };
    const descriptor = (tag, value) => join(new Uint8Array([tag, value.length]), value);
    const decoder = new Uint8Array(13); decoder[0] = 0x40;
    const esds = box('esds', u32(0), descriptor(3, join(new Uint8Array([0, 2, 0]), descriptor(4, join(decoder, descriptor(5, new Uint8Array([0x11, 0x90])))))));
    const sample = new Uint8Array(28); const sv = new DataView(sample.buffer); sv.setUint16(16, 2); sv.setUint32(24, 48000 * 65536);
    const tkhd = new Uint8Array(20), mdhd = new Uint8Array(20), hdlr = new Uint8Array(20);
    new DataView(tkhd.buffer).setUint32(12, 2); new DataView(mdhd.buffer).setUint32(12, 48000); hdlr.set(text('soun'), 8);
    const init = box('moov', box('trak', box('tkhd', tkhd), box('mdia', box('mdhd', mdhd), box('hdlr', hdlr), box('minf', box('stbl', box('stsd', u32(0), u32(1), box('mp4a', sample, esds)))))), box('mvex', box('trex', u32(0), u32(2), u32(1), u32(1024), u32(0), u32(0))));
    const first = new Uint8Array([1, 2, 3]), second = new Uint8Array([4, 5, 6, 7]), video = new Uint8Array(24).fill(0x99);
    const audioTraf = offset => box('traf', box('tfhd', u32(0x020000), u32(2)), box('tfdt', u32(0x01000000), u32(0), u32(4800000)), box('trun', u32(0x201), u32(2), u32(offset), u32(first.length), u32(second.length)));
    const videoTraf = box('traf', box('tfhd', u32(0x020000), u32(1)));
    let moof = box('moof', videoTraf, audioTraf(0)); moof = box('moof', videoTraf, audioTraf(moof.length + 8 + video.length));
    return { init, segment: join(moof, box('mdat', video, first, second)), first, second };
}
test('fMP4 fallback extracts only the AAC track and preserves its decode timestamp', async () => {
    const { init, segment, first, second } = mp4Fixture();
    const h = edge(url => new Response(url.pathname.endsWith('init.m4s') ? init : segment));
    const base = 'https://example.bilivideo.com/live-bvc/123/stream/';
    const path = '/live/segment.aac?url=' + encodeURIComponent(base + '1.m4s') + '&init=' + encodeURIComponent(base + 'init.m4s');
    const response = await h.request(path); assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer()), headerSize = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]);
    const timestamp = new DataView(bytes.buffer).getBigUint64(headerSize - 8); assert.equal(timestamp, 9000000n);
    assert.deepEqual(bytes.slice(headerSize + 7, headerSize + 10), first);
    assert.deepEqual(bytes.slice(headerSize + 17), second); assert.equal(bytes.includes(0x99), false);
    await h.request(path); assert.equal(h.calls.length, 2);
});
test('fMP4 playlist strips the video init and sends audio extraction the matching safe init URL', async () => {
    const h = edge(() => new Response('#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MAP:URI="init.m4s"\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:1,\n1.m4s\n'));
    const response = await h.request('/live/playlist.m3u8?url=' + encodeURIComponent(MEDIA)), text = await response.text();
    assert.equal(response.status, 200); assert.doesNotMatch(text, /EXT-X-MAP|EXT-X-KEY/); assert.match(text, /VERSION:3/);
    const url = new URL(text.split('\n').find(line => line.startsWith('https:')));
    assert.equal(url.searchParams.get('init'), 'https://example.bilivideo.com/live-bvc/123/init.m4s');
    const bad = await h.request('/live/segment.aac?url=' + encodeURIComponent('https://example.bilivideo.com/live-bvc/123/1.m4s') + '&init=' + encodeURIComponent('https://evil.bilivideo.com/live-bvc/123/init.m4s'));
    assert.equal(bad.status, 400); assert.equal(h.calls.length, 1);
});
test('working fMP4 is selected when every TS CDN is unreachable', async () => {
    const fixture = mp4Fixture();
    const h = edge(url => {
        if (url.hostname === 'dead.bilivideo.com') throw new Error('TLS failed');
        if (url.pathname.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXT-X-MAP:URI="init.m4s"\n#EXTINF:1,\n1.m4s\n');
        if (url.pathname.endsWith('.m4s')) return new Response(url.pathname.endsWith('init.m4s') ? fixture.init : fixture.segment);
        return json({ live_status: 1, playurl_info: { playurl: { stream: [{ protocol_name: 'http_hls', format: [
            { format_name: 'ts', codec: [{ base_url: '/live-bvc/123/dead.m3u8?', url_info: [{ host: 'https://dead.bilivideo.com' }] }] },
            { format_name: 'fmp4', codec: [{ base_url: '/live-bvc/123/stream/index.m3u8?', url_info: [{ host: 'https://working.bilivideo.com' }] }] },
        ] }] } } });
    });
    const response = await h.request('/live/stream?member=diana'); assert.equal(response.status, 200);
    assert.match((await response.json()).url, /working/);
});
