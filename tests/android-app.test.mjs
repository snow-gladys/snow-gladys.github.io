import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const bridge = readFileSync(new URL('../android-app/assets/bridge.js', import.meta.url), 'utf8');
function setup() {
    const states = [], exports = [], alerts = [], elements = new Map(), listeners = new Map();
    let time = 100000, created = 0;
    class Audio extends EventTarget { src = ''; paused = true; ended = false; currentTime = 0; duration = NaN; }
    function element(id, classes = []) {
        const set = new Set(classes);
        const item = { textContent: '歌曲', classList: { contains: key => set.has(key), remove: key => set.delete(key) }, click() { item.clicked = true; } };
        elements.set(id, item); return item;
    }
    element('play-song-name');
    const context = vm.createContext({ Audio, Blob, Event, Map, WeakSet, Number, Object, JSON, Promise, Date: { now: () => time },
        URL: { createObjectURL: () => 'blob:test/' + ++created, revokeObjectURL() {} },
        MutationObserver: class { observe() {} },
        CONFIG: { titleSuffix: '心宜' },
        GladysNative: { mediaState: data => states.push(JSON.parse(data)), saveText: (name, text) => exports.push({ name, text }) },
        document: { title: '思诺', getElementById: id => elements.get(id), querySelector: () => null,
            addEventListener: (name, callback) => listeners.set(name, callback) },
        alert: text => alerts.push(text), fetch: () => { throw new Error('unexpected fetch'); },
    });
    context.window = context;
    vm.runInContext('let bgmAudio = new Audio(); let globalPreloadAudio = new Audio(); let lyricsViewOpen = false;', context);
    vm.runInContext(bridge, context);
    return { context, states, exports, alerts, elements, element, listeners, advance: ms => time += ms,
        evaluate: code => vm.runInContext(code, context),
        async export(blob, name) {
            const href = context.URL.createObjectURL(blob);
            const event = { target: { closest: () => ({ href, download: name }) }, preventDefault() { this.prevented = true; } };
            listeners.get('click')(event);
            context.URL.revokeObjectURL(href); // Existing website revokes synchronously after .click().
            await new Promise(resolve => setImmediate(resolve)); return event;
        },
    };
}

test('bridge follows current audio and newly swapped preload audio, without reporting silent preload playback', () => {
    const app = setup();
    app.evaluate("globalPreloadAudio.src='preload';globalPreloadAudio.paused=false;globalPreloadAudio.dispatchEvent(new Event('play'))");
    assert.equal(app.states.length, 1);
    app.evaluate("bgmAudio.src='song';bgmAudio.paused=false;bgmAudio.currentTime=3;bgmAudio.duration=60;bgmAudio.dispatchEvent(new Event('play'))");
    assert.deepEqual(app.states.at(-1), { playing: true, title: '歌曲', artist: '心宜', position: 3000, duration: 60000 });
    app.evaluate("bgmAudio=globalPreloadAudio;globalPreloadAudio=new Audio();bgmAudio.currentTime=8;bgmAudio.dispatchEvent(new Event('play'))");
    assert.equal(app.states.at(-1).position, 8000);
    const count = app.states.length;
    app.evaluate("globalPreloadAudio.src='later';globalPreloadAudio.paused=false;globalPreloadAudio.dispatchEvent(new Event('play'))");
    assert.equal(app.states.length, count);
    app.evaluate("bgmAudio=globalPreloadAudio;bgmAudio.dispatchEvent(new Event('play'))");
    assert.equal(app.states.length, count + 1);
});

test('bridge throttles progress but immediately reports pause and seek; injection is idempotent', () => {
    const app = setup();
    const Audio = app.context.Audio;
    vm.runInContext(bridge, app.context);
    assert.equal(app.context.Audio, Audio);
    assert.equal(app.states.length, 1);
    app.evaluate("bgmAudio.dispatchEvent(new Event('timeupdate'))");
    assert.equal(app.states.length, 1);
    app.advance(10001);
    app.evaluate("bgmAudio.currentTime=12;bgmAudio.dispatchEvent(new Event('timeupdate'))");
    assert.equal(app.states.at(-1).position, 12000);
    app.evaluate("bgmAudio.dispatchEvent(new Event('pause'));bgmAudio.dispatchEvent(new Event('seeked'))");
    assert.equal(app.states.length, 4);
});

test('blob lyrics export survives immediate URL revocation and preserves UTF-8 text', async () => {
    const app = setup();
    const event = await app.export(new Blob(['[00:01.23]你好\n']), '歌曲.lrc');
    assert.equal(event.prevented, true);
    assert.deepEqual(app.exports, [{ name: '歌曲.lrc', text: '[00:01.23]你好\n' }]);
});

test('oversized exports do not reach native save; normal links are left alone', async () => {
    const app = setup();
    await app.export(new Blob(['a'.repeat(1000001)]), 'large.txt');
    assert.equal(app.exports.length, 0);
    assert.equal(app.alerts.length, 1);
    let prevented = false;
    app.listeners.get('click')({ target: { closest: () => ({ href: 'https://example.com/file', download: 'file.txt' }) }, preventDefault: () => prevented = true });
    assert.equal(prevented, false);
});

test('Android back dismisses dialog and modal before playlist, lyrics and playing view', () => {
    const app = setup();
    const modal = app.element('settings-modal-backdrop', ['is-open']);
    const close = app.element('btn-close-settings');
    close.click = () => modal.classList.remove('is-open');
    const playlist = app.element('view-playlist', ['is-open']);
    app.element('view-play', ['is-active']);
    app.context.closePlaylist = () => playlist.classList.remove('is-open');
    app.context.toggleLyricsView = () => app.evaluate('lyricsViewOpen=false');
    app.context.showView = value => { assert.equal(value, 'home'); app.elements.get('view-play').classList.remove('is-active'); };
    app.evaluate('lyricsViewOpen=true');
    let dialogClosed = false;
    app.context.document.querySelector = () => ({ close: () => dialogClosed = true });
    assert.equal(app.context.__SG_ANDROID_BACK(), true); assert.equal(dialogClosed, true);
    assert.equal(modal.classList.contains('is-open'), true);
    app.context.document.querySelector = () => null;
    for (let i = 0; i < 4; i++) assert.equal(app.context.__SG_ANDROID_BACK(), true);
    assert.equal(app.context.__SG_ANDROID_BACK(), false);
});

for (const [role, prefix, start] of [['snow', '', '/'], ['fiona', 'fiona/', '/fiona/']]) {
    test(role + ' home-screen manifest keeps role switching in scope and supplies real sized icons', () => {
        const url = new URL('../' + prefix + 'manifest.webmanifest', import.meta.url);
        const manifest = JSON.parse(readFileSync(url, 'utf8'));
        assert.equal(manifest.start_url, start + '?source=homescreen');
        assert.equal(manifest.display, 'standalone');
        assert.equal(manifest.scope, '/');
        const html = readFileSync(new URL('../' + prefix + 'index.html', import.meta.url), 'utf8');
        assert.match(html, /rel="manifest" href="manifest.webmanifest"/);
        assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
        assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
        for (const icon of manifest.icons) {
            const data = readFileSync(new URL(icon.src, url));
            assert.equal(data.subarray(1, 4).toString(), 'PNG');
            const [width, height] = icon.sizes.split('x').map(Number);
            assert.equal(data.readUInt32BE(16), width);
            assert.equal(data.readUInt32BE(20), height);
        }
    });
}
