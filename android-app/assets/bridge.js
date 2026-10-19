(function () {
    'use strict';
    if (window.__SG_ANDROID_INSTALLED || !window.GladysNative) return;
    window.__SG_ANDROID_INSTALLED = true;
    const objects = new Map();
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function (blob) { const url = create(blob); objects.set(url, blob); return url; };
    URL.revokeObjectURL = function (url) { objects.delete(url); return revoke(url); };
    document.addEventListener('click', function (event) {
        const anchor = event.target && event.target.closest ? event.target.closest('a[download]') : null;
        if (!anchor || !anchor.download || !anchor.href.startsWith('blob:')) return;
        event.preventDefault();
        const filename = anchor.download, href = anchor.href, known = objects.get(href);
        Promise.resolve(known || fetch(href).then(response => response.blob())).then(function (blob) {
            if (blob.size > 1000000) throw new Error('文件较大，请在浏览器中导出。');
            return blob.text();
        }).then(text => GladysNative.saveText(filename, text)).catch(error => alert(error.message || '导出失败，请重试。'));
    }, true);

    let lastUpdate = 0;
    function send(force) {
        const audio = typeof bgmAudio === 'undefined' ? null : bgmAudio;
        const now = Date.now();
        if (!force && now - lastUpdate < 10000) return;
        lastUpdate = now;
        const title = document.getElementById('play-song-name');
        GladysNative.mediaState(JSON.stringify({
            playing: !!(audio && audio.src && !audio.paused && !audio.ended),
            title: title && title.textContent !== '—' ? title.textContent : document.title,
            artist: typeof CONFIG !== 'undefined' ? CONFIG.titleSuffix : '思诺',
            position: audio && Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime * 1000) : 0,
            duration: audio && Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0,
        }));
    }
    const watched = new WeakSet();
    function watch(audio) {
        if (!audio || watched.has(audio)) return;
        watched.add(audio);
        ['play', 'pause', 'ended', 'loadedmetadata', 'seeked', 'error'].forEach(function (type) {
            audio.addEventListener(type, function () { if (typeof bgmAudio !== 'undefined' && audio === bgmAudio) send(true); });
        });
        audio.addEventListener('timeupdate', function () { if (typeof bgmAudio !== 'undefined' && audio === bgmAudio) send(false); });
    }
    if (typeof bgmAudio !== 'undefined') watch(bgmAudio);
    if (typeof globalPreloadAudio !== 'undefined') watch(globalPreloadAudio);
    const OriginalAudio = window.Audio;
    function NativeAwareAudio() { const audio = new OriginalAudio(...arguments); watch(audio); return audio; }
    NativeAwareAudio.prototype = OriginalAudio.prototype;
    Object.setPrototypeOf(NativeAwareAudio, OriginalAudio);
    window.Audio = NativeAwareAudio;
    const title = document.getElementById('play-song-name');
    if (title) new MutationObserver(() => send(true)).observe(title, { childList: true, subtree: true, characterData: true });
    document.addEventListener('visibilitychange', () => send(true));
    window.__SG_ANDROID_PING = () => send(true);
    window.__SG_ANDROID_BACK = function () {
        const dialog = document.querySelector('dialog[open]');
        if (dialog) { dialog.close(); return true; }
        const modals = [
            ['cache-confirm-backdrop', 'cache-confirm-cancel'], ['sleep-timer-backdrop', 'sleep-timer-cancel'],
            ['lyric-form-backdrop', 'lyric-form-cancel'], ['custom-form-backdrop', 'custom-form-cancel'],
            ['custom-manage-backdrop', 'custom-manage-close'], ['changelog-backdrop', 'btn-close-changelog'],
            ['settings-modal-backdrop', 'btn-close-settings'],
        ];
        for (const [backdrop, close] of modals) {
            const element = document.getElementById(backdrop);
            if (element && element.classList.contains('is-open')) {
                const button = document.getElementById(close);
                if (button) button.click(); else element.classList.remove('is-open');
                return true;
            }
        }
        const playlist = document.getElementById('view-playlist');
        if (playlist && playlist.classList.contains('is-open') && typeof closePlaylist === 'function') { closePlaylist(); return true; }
        if (typeof lyricsViewOpen !== 'undefined' && lyricsViewOpen && typeof toggleLyricsView === 'function') { toggleLyricsView(false); return true; }
        const play = document.getElementById('view-play');
        if (play && play.classList.contains('is-active') && typeof showView === 'function') { showView('home'); return true; }
        return false;
    };
    send(true);
})();
