import { installTimeline } from './helpers/player-timeline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function functionSource(name, endMarker) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0);
    const end = source.indexOf(endMarker, start);
    assert.ok(end > start);
    return source.slice(start, end);
}
const A = 'BV17uZQBHEDo';
const B = 'BV1Sf421Q7Rt';
const C = 'BV1Cn4y1o7yG';

for (const mode of ['list', 'single', 'random']) {
    test('error recovery skips the failed track in ' + mode + ' mode', () => {
        const played = [];
        const sandbox = vm.createContext({
            failedPlaybackBvid: B, currentPlayingBvid: A, playMode: mode,
            listeningLibrary: { list: () => [], isExcluded: () => false }, getQueuedNext: () => null,
            getEffectiveList: () => [A, B, C].map(bvid => ({ bvid })),
            randomQueue: { skip() {}, peekNext: () => A },
            playMusic: id => played.push(id),
        });
        vm.runInContext(functionSource('playNextAfterFailure', '\n        const playlistSearchEl') + '\nplayNextAfterFailure();', sandbox);
        assert.deepEqual(played, [mode === 'random' ? A : C]);
    });
}

test('a one-song list is not repeatedly retried by the next action', () => {
    const sandbox = vm.createContext({
        listeningLibrary: { list: () => [] }, getQueuedNext: () => null,
        failedPlaybackBvid: A, getEffectiveList: () => [{ bvid: A }],
        playMusic() { assert.fail('must not retry automatically'); },
    });
    vm.runInContext(functionSource('playNextAfterFailure', '\n        const playlistSearchEl') + '\nplayNextAfterFailure();', sandbox);
});

test('autoplay recovery calls play immediately without a new resolution request', async () => {
    let played = 0, cleared = 0;
    const sandbox = vm.createContext({
        failedPlaybackBvid: A, currentPlayingBvid: A, failedPlaybackKind: 'autoplay',
        bgmAudio: { src: 'https://example/audio', async play() { played++; } },
        pendingPlayback: null, sessionAudioBvid: '',
        clearPlaybackError() { cleared++; }, rememberStartedPlayback() {}, updatePlayPauseIcon() {},
        playMusic() { assert.fail('autoplay recovery must retain the gesture'); },
        handlePlayError() { assert.fail('unexpected play error'); },
    });
    vm.runInContext('async ' + functionSource('retryPlayback', '\n        function playNextAfterFailure'), sandbox);
    await sandbox.retryPlayback();
    assert.equal(played, 1);
    assert.equal(cleared, 1);
});

test('ordinary error retry resolves the failed song, even if another song is still playing', async () => {
    const played = [];
    const sandbox = vm.createContext({
        failedPlaybackBvid: B, currentPlayingBvid: A, failedPlaybackKind: '',
        pendingPlayback: null, sessionAudioBvid: '',
        clearPlaybackError() {}, playMusic: id => played.push(id),
    });
    vm.runInContext('async ' + functionSource('retryPlayback', '\n        function playNextAfterFailure'), sandbox);
    await sandbox.retryPlayback();
    assert.deepEqual(played, [B]);
});

test('recovery card exposes the song and safe destination without leaking opaque media errors', () => {
    const elements = Object.fromEntries(['playback-recovery-song', 'playback-recovery-message', 'playback-retry', 'playback-bilibili', 'playback-next'].map(id => [id, {}]));
    const recovery = { hidden: true };
    const sandbox = vm.createContext({
        failedPlaybackBvid: '', failedPlaybackKind: '', currentPlayingBvid: A,
        playMode: 'list', playScope: 'all', listeningLibrary: { list: () => [] },
        bgmAudio: { paused: true }, playbackRecoveryEl: recovery,
        document: { getElementById: id => elements[id] },
        getSongNameByBvid: () => '测试歌曲', getEffectiveList: () => [{ bvid: B }],
        stopVisuals() {}, syncHomePlayer() {},
    });
    installTimeline(sandbox, source);
    vm.runInContext(functionSource('handlePlayError', '\n        // 视觉效果联动'), sandbox);
    sandbox.handlePlayError(B, { name: 'MediaError', message: 'decoder internal error' });
    assert.equal(recovery.hidden, false);
    assert.equal(elements['playback-recovery-song'].textContent, '测试歌曲');
    assert.equal(elements['playback-bilibili'].href, 'https://www.bilibili.com/video/' + B);
    assert.equal(elements['playback-next'].disabled, true);
    assert.doesNotMatch(elements['playback-recovery-message'].textContent, /decoder/);
    sandbox.handlePlayError(B, { name: 'NotAllowedError' });
    assert.equal(elements['playback-retry'].textContent, '点击播放');
});

test('aborted playback does not show an error card', () => {
    const recovery = { hidden: true };
    const sandbox = vm.createContext({ playbackRecoveryEl: recovery });
    installTimeline(sandbox, source);
    vm.runInContext(functionSource('handlePlayError', '\n        // 视觉效果联动'), sandbox);
    sandbox.handlePlayError(A, { name: 'AbortError' });
    assert.equal(recovery.hidden, true);
});
