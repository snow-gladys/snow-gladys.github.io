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
    function shouldPreload(audio, windowSeconds) {
        var remaining = audio.duration - audio.currentTime;
        return !audio.paused && Number.isFinite(remaining) && remaining > 0 && remaining <= windowSeconds &&
            ahead(audio) + 0.25 >= Math.min(8, remaining);
    }
    function cacheWhenBuffered(options) {
        var audio = options.audio, controller = null, cancelled = false;
        var events = ['progress', 'timeupdate', 'pause', 'waiting'];
        function current() { return !cancelled && options.isCurrent(); }
        function cancel() {
            cancelled = true;
            if (controller) controller.abort();
            events.forEach(function (event) { audio.removeEventListener(event, check); });
        }
        async function check() {
            if (!current()) { cancel(); return; }
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
        check();
        return cancel;
    }
    global.SG_PLAYBACK_BUFFER = { ahead: ahead, shouldPreload: shouldPreload, cacheWhenBuffered: cacheWhenBuffered };
})(window);
