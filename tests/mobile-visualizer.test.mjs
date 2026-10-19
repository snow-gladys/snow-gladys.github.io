import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const player = read('index.js');
function canvasHarness(width = 260, height = 100) {
    const rects = [], attributes = [], observations = [];
    let reads = 0;
    const ctx = { setTransform() {}, clearRect() { rects.length = 0; }, fillRect(...args) { rects.push(args); } };
    const canvas = { setAttribute(...args) { attributes.push(args); }, getContext: () => ctx };
    const element = { dataset: {}, appendChild() {}, getBoundingClientRect() { reads++; return { width, height }; } };
    const window = { devicePixelRatio: 3, ResizeObserver: function (cb) { this.observe = () => observations.push(cb); } };
    vm.runInNewContext(read('mobile-visualizer.js'), { window, document: { createElement: () => canvas } });
    const visualizer = window.SG_MOBILE_VISUALIZER.create(element);
    return { visualizer, element, canvas, rects, window, attributes, observations, reads: () => reads };
}
test('mobile renderer limits pixels and bars without layout reads every frame', () => {
    const h = canvasHarness(400, 120);
    for (let t = 0; t < 1000; t += 42) h.visualizer.draw(new Uint8Array(256).fill(220), t, true, false);
    assert.equal(h.canvas.width, 600); assert.equal(h.canvas.height, 180);
    assert.equal(h.rects.length, 48); assert.equal(h.reads(), 1);
    assert.equal(h.observations.length, 1);
    assert.deepEqual(h.attributes, [['aria-hidden', 'true']]);
    assert.equal(h.element.dataset.spectrumMode, 'realtime');
    assert.ok(h.rects.every(r => r.every(Number.isFinite) && r[3] >= 1 && r[3] <= 120));
});
test('real silence stays still; ambient fallback is distinct and resets on pause', () => {
    const h = canvasHarness();
    h.visualizer.draw(new Uint8Array(256), 0, true, false);
    assert.ok(h.rects.every(r => r[3] === 1));
    h.visualizer.draw(null, 42, true, false); const first = JSON.stringify(h.rects);
    h.visualizer.draw(null, 84, true, false);
    assert.notEqual(JSON.stringify(h.rects), first);
    assert.equal(h.element.dataset.spectrumMode, 'ambient');
    h.visualizer.reset(); assert.ok(h.rects.every(r => r[3] === 1));
});
test('native iPad desktop user agents are recognized alongside iPhones', () => {
    const { isIOS } = canvasHarness().window.SG_MOBILE_VISUALIZER;
    assert.equal(isIOS({ userAgent: 'iPhone CriOS' }), true);
    assert.equal(isIOS({ userAgent: 'Macintosh Safari', maxTouchPoints: 5 }), true);
    assert.equal(isIOS({ userAgent: 'Macintosh Safari', maxTouchPoints: 0 }), false);
    assert.equal(isIOS({ userAgent: 'Android Chrome', maxTouchPoints: 5 }), false);
});
function engine({ ios = false, reduced = false, compact = true } = {}) {
    const scheduled = new Map(), calls = { contexts: 0, sources: 0, samples: 0, draws: 0, resets: 0 };
    const media = { paused: false, readyState: 4, seeking: false, ended: false };
    let nextFrame = 0;
    const motion = { matches: reduced, addEventListener(_, fn) { this.change = fn; } };
    const document = { hidden: false, body: { classList: { toggle() {}, contains: () => false } }, getElementById: () => ({}), addEventListener() {} };
    const analyser = { frequencyBinCount: 256, getByteFrequencyData(data) { calls.samples++; data.fill(100); } };
    const window = { innerWidth: compact ? 390 : 1200, matchMedia: q => q.includes('reduced') ? motion : { matches: compact },
        SG_MOBILE_VISUALIZER: { isIOS: () => ios, create: () => ({ resize() {}, draw() { calls.draws++; }, reset() { calls.resets++; } }) },
        AudioContext: function () { calls.contexts++; this.state = 'running'; this.destination = {};
            this.createAnalyser = () => analyser; this.resume = () => Promise.resolve();
            this.createMediaElementSource = () => { calls.sources++; return { connect() {}, disconnect() {} }; };
        }, addEventListener() {}, requestAnimationFrame(cb) { scheduled.set(++nextFrame, cb); return nextFrame; },
        cancelAnimationFrame(id) { scheduled.delete(id); },
    };
    const context = vm.createContext({ window, document, navigator: {}, bgmAudio: media,
        viewPlay: { classList: { contains: cls => cls === 'is-active' } }, performance: { now: () => 0 }, console });
    // The real integration block, including scheduling and safe iOS early return.
    vm.runInContext(player.slice(player.indexOf("        const playVisualizerEl ="), player.indexOf('        let globalPreloadAudio =')), context);
    function frames() { for (let t = 17; t <= 1000; t += 1000 / 60) { const current = [...scheduled]; scheduled.clear(); current.forEach(([, cb]) => cb(t)); } }
    return { calls, media, motion, context, analyser, scheduled, run: code => vm.runInContext(code, context), frames };
}
test('iOS draws its fallback without constructing Web Audio or touching audio routing', () => {
    const h = engine({ ios: true }); h.run('startAudioVisualizer()'); h.frames();
    assert.equal(h.calls.contexts, 0); assert.equal(h.calls.sources, 0); assert.equal(h.calls.samples, 0);
    assert.ok(h.calls.draws >= 23 && h.calls.draws <= 25, JSON.stringify(h.calls));
    h.run('startAudioVisualizer(); startAudioVisualizer()'); assert.equal(h.scheduled.size, 1);
});
test('Android samples a smaller FFT at 24 fps and stops work when hidden or paused', () => {
    const h = engine(); h.run('primeMobileAudioAnalyser(); startAudioVisualizer()'); h.frames();
    assert.equal(h.analyser.fftSize, 512); assert.equal(h.calls.sources, 1);
    assert.ok(h.calls.samples >= 23 && h.calls.samples <= 25);
    h.context.document.hidden = true; const sampled = h.calls.samples; h.frames();
    assert.equal(h.calls.samples, sampled); assert.equal(h.scheduled.size, 0);
    h.context.document.hidden = false; h.run('startAudioVisualizer()');
    h.media.paused = true; h.run('stopAudioVisualizer()');
    assert.equal(h.scheduled.size, 0); assert.ok(h.calls.resets > 0);
});
test('audio sources are reused safely when an element is revisited', () => {
    const h = engine(); h.run('ensureAudioAnalyser(); var firstAudio = bgmAudio; bgmAudio = {}; ensureAudioAnalyser(); bgmAudio = firstAudio; ensureAudioAnalyser()');
    assert.equal(h.calls.sources, 2);
});
test('reduced motion avoids audio analysis and animation; changing preference stops the loop', () => {
    const h = engine({ reduced: true }); h.run('primeMobileAudioAnalyser(); startAudioVisualizer()');
    assert.equal(h.calls.contexts, 0); assert.equal(h.scheduled.size, 0);
    h.motion.matches = false; h.motion.change(); assert.equal(h.scheduled.size, 1);
    h.motion.matches = true; h.motion.change(); assert.equal(h.scheduled.size, 0);
});
