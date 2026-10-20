/* 播放优先：缓冲充足时才预取和下载离线缓存。 */
(function (global) {
    'use strict';
    function ahead(audio) {
        try {
            var time = audio.currentTime;
            for (var i = 0; i < audio.buffered.length; i++) {
                if (audio.buffered.start(i) <= time + 0.1 && audio.buffered.end(i) >= time) {
                    return Math.max(0, audio.buffered.end(i) - time);
                }
            }
        } catch (_) {}
        return 0;
    }
    function shouldPreload(audio, windowSeconds, trackRemaining) {
        var remaining = Number.isFinite(trackRemaining) ? trackRemaining : audio.duration - audio.currentTime;
        return !audio.paused && Number.isFinite(remaining) && remaining > 0 && remaining <= windowSeconds &&
            ahead(audio) + 0.25 >= Math.min(8, remaining);
    }
    function cacheWhenBuffered(options) {
        var audio = options.audio, controller = null, cancelled = false;
        var events = ['progress', 'timeupdate', 'pause', 'waiting'];
        var page = typeof document !== 'undefined' ? document : null;
        function current() { return !cancelled && options.isCurrent(); }
        function cancel() {
            cancelled = true;
            if (controller) controller.abort();
            events.forEach(function (event) { audio.removeEventListener(event, check); });
            if (page) page.removeEventListener('visibilitychange', check);
        }
        async function check() {
            if (!current() || page && page.hidden) { cancel(); return; }
            var buffered = ahead(audio);
            var wholeSongBuffered = Number.isFinite(audio.duration) && audio.duration > 0 &&
                buffered + 0.25 >= audio.duration - audio.currentTime;
            if (controller) {
                // 主播放缓冲不足时停止后台下载，本首不重试，避免反复整首下载。
                if (!audio.paused && buffered < 5 && !wholeSongBuffered) cancel();
                return;
            }
            if (!audio.paused && buffered < 20 && !wholeSongBuffered) return;
            controller = new AbortController();
            try {
                var response = await fetch(options.url, { signal: controller.signal });
                if (!response.ok) return;
                var blob = await response.blob();
                if (!current() || controller.signal.aborted) return;
                var saved = await options.save(blob);
                if (saved !== false && current() && options.onSaved) await options.onSaved();
            } catch (_) { /* 缓存失败不打断播放。 */ }
            finally { cancel(); }
        }
        events.forEach(function (event) { audio.addEventListener(event, check); });
        if (page) page.addEventListener('visibilitychange', check);
        check();
        return cancel;
    }
    // 只处理仍在播放、却长时间没有前进的网络停顿；用户暂停和切歌会取消恢复。
    function watchPlayback(options) {
        var audio = options.audio, timer = null, key = '', attempts = 0, position = 0;
        function clear() { if (timer !== null) clearTimeout(timer); timer = null; }
        function stop() { clear(); }
        function progress() { if (audio.currentTime > position + 0.25) clear(); }
        function wait() {
            if (!options.isCurrent() || audio.paused || audio.ended || audio.seeking) return;
            var current = options.key();
            if (!current) return;
            if (key !== current) { clear(); key = current; attempts = 0; }
            if (timer !== null || attempts >= 2) return;
            position = audio.currentTime;
            timer = setTimeout(function () {
                timer = null;
                if (!options.isCurrent() || options.key() !== current || audio.paused || audio.ended || audio.seeking || audio.currentTime > position + 0.25) return;
                attempts++;
                Promise.resolve().then(options.reconnect).catch(function () {});
            }, 10000);
        }
        for (var type of ['waiting', 'stalled']) audio.addEventListener(type, wait);
        for (var type of ['pause', 'playing', 'emptied', 'ended', 'seeking']) audio.addEventListener(type, stop);
        audio.addEventListener('timeupdate', progress);
        return { dispose: function () {
            clear();
            for (var type of ['waiting', 'stalled']) audio.removeEventListener(type, wait);
            for (var type of ['pause', 'playing', 'emptied', 'ended', 'seeking']) audio.removeEventListener(type, stop);
            audio.removeEventListener('timeupdate', progress);
        } };
    }
    global.SG_PLAYBACK_BUFFER = { watchPlayback: watchPlayback, ahead: ahead, shouldPreload: shouldPreload, cacheWhenBuffered: cacheWhenBuffered };
})(window);
