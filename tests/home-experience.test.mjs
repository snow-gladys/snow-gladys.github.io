import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../home-experience.js', import.meta.url), 'utf8');
function harness({ reduced = false, mobile = true } = {}) {
    const names = new Set(), scheduled = new Map(), listeners = new Map(), nodes = [], fills = [];
    let time = 0, nextFrame = 0;
    const makeText = text => ({ textContent: text, style: { setProperty(key, value) { this[key] = value; } }, getBoundingClientRect: () => ({ left: 0, top: 50, width: 200, height: 40 }) });
    const title = makeText('思诺 Gladys'), subtitle = makeText('Z.J. ENTERTAINMENT');
    const ctx = { scale() {}, clearRect() {}, fillRect(...args) { fills.push(args); }, measureText: () => ({ width: 8 }), fillText() {},
        getImageData: () => ({ data: new Uint8Array(200 * 200 * 4).fill(255) }) };
    const doc = { hidden: false, querySelector: selector => selector === '.clean-title' ? title : selector === '.clean-subtitle' ? subtitle : null,
        createElement() { const node = { width: 0, height: 0, setAttribute() {}, getContext: () => ctx, remove() { this.removed = true; } }; nodes.push(node); return node; },
        body: { classList: { add: name => names.add(name), remove: name => names.delete(name) }, appendChild() {} } };
    const frame = cb => { scheduled.set(++nextFrame, cb); return nextFrame; };
    const wardrobe = { selected: 'diana', profile: () => ({ name: '嘉然 Diana' }) };
    const window = { SG_WARDROBE: wardrobe,
        addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
        removeEventListener(type, callback) { listeners.get(type)?.delete(callback); } };
    const context = vm.createContext({ window, SG_WARDROBE: wardrobe, document: doc, Uint8Array, devicePixelRatio: 3, innerWidth: 200, innerHeight: 200,
        matchMedia: q => ({ matches: q.includes('reduced') ? reduced : mobile }),
        getComputedStyle: () => ({ fontWeight: '900', fontSize: '20px', fontFamily: 'sans-serif', letterSpacing: '2px' }),
        performance: { now: () => time }, requestAnimationFrame: frame, cancelAnimationFrame: id => scheduled.delete(id), setTimeout: () => 1, clearTimeout() {} });
    vm.runInContext(source, context);
    const step = now => { time = now; const callbacks = [...scheduled.values()]; scheduled.clear(); callbacks.forEach(cb => cb(time)); };
    const emit = type => [...(listeners.get(type) || [])].forEach(callback => callback());
    return { step, emit, title, nodes, fills, names, scheduled, listeners };
}
test('mobile intro uses the remembered name, bounds particle count and cleans up before one second', () => {
    const h = harness(); assert.equal(h.title.textContent, '嘉然 Diana');
    h.step(0); assert.equal(h.nodes[0].width, 300); h.step(0); assert.ok(h.fills.length <= 900);
    assert.equal(h.names.has('has-home-intro'), true); h.step(400); assert.equal(h.nodes[0].removed, undefined);
    h.step(780); assert.equal(h.nodes[0].removed, true); assert.equal(h.names.size, 0); assert.equal(h.scheduled.size, 0);
    assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});
test('tapping accelerates the existing animation over 150ms instead of abruptly hiding it', () => {
    const h = harness(); h.step(0); h.step(0); h.step(200); h.emit('pointerdown');
    assert.equal(h.nodes[0].removed, undefined); assert.equal(h.names.has('has-home-intro'), true);
    h.step(275); h.emit('pointerdown'); assert.equal(h.nodes[0].removed, undefined);
    h.step(350); assert.equal(h.nodes[0].removed, true); assert.equal(h.scheduled.size, 0);
});
test('background stops work; repeated startup appearance does not shorten the intro', () => {
    const h = harness(); h.step(0); h.step(0); h.emit('sg:appearance'); assert.equal(h.names.has('has-home-intro'), true);
    h.emit('visibilitychange'); assert.equal(h.nodes[0].removed, true); assert.equal(h.scheduled.size, 0);
});
test('desktop and reduced-motion preferences skip the particle canvas', () => {
    for (const options of [{ reduced: true }, { mobile: false }]) { const h = harness(options); h.step(0); assert.equal(h.nodes.length, 0); }
});
