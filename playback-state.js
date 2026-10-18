(function (root) {
    'use strict';

    function createQueue(random) {
        random = random || Math.random;
        let signature = null, bag = [], history = [], cursor = -1;
        const idsOf = list => Array.from(new Set(list.filter(Boolean)));
        function shuffled(ids) {
            const out = ids.slice();
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        }
        function sync(ids, current) {
            const key = ids.slice().sort().join('\n');
            if (signature !== key) {
                signature = key;
                bag = shuffled(ids.filter(id => id !== current));
            }
        }
        function historyIndex(ids, step) {
            for (let i = cursor + step; i >= 0 && i < history.length; i += step) {
                if (ids.includes(history[i])) return i;
            }
            return -1;
        }
        return {
            peekNext(list, current) {
                const ids = idsOf(list);
                if (!ids.length) return null;
                sync(ids, current);
                const forward = historyIndex(ids, 1);
                if (forward >= 0 && history[forward] !== current) return history[forward];
                if (!bag.length) {
                    bag = shuffled(ids);
                    // 新一轮的第一首避免与上一轮最后一首相同。
                    if (bag[0] === current && bag.length > 1) {
                        const other = 1 + Math.floor(random() * (bag.length - 1));
                        [bag[0], bag[other]] = [bag[other], bag[0]];
                    }
                }
                return bag[0] || null;
            },
            peekPrevious(list) {
                const index = historyIndex(idsOf(list), -1);
                return index < 0 ? null : history[index];
            },
            commit(id, direction) {
                if (!id) return;
                let index = -1;
                if (direction === 'back' || direction === 'forward') {
                    const step = direction === 'back' ? -1 : 1;
                    for (let i = cursor + step; i >= 0 && i < history.length; i += step) {
                        if (history[i] === id) { index = i; break; }
                    }
                }
                if (index >= 0) cursor = index;
                else if (history[cursor] !== id) {
                    history = history.slice(0, cursor + 1);
                    history.push(id);
                    if (history.length > 200) history.shift();
                    cursor = history.length - 1;
                }
                bag = bag.filter(item => item !== id);
            },
            skip(id) { bag = bag.filter(item => item !== id); },
        };
    }

    function readSession(storage, key) {
        try {
            const value = JSON.parse(storage.getItem(key));
            if (!value || !/^BV[0-9a-zA-Z]{10}$/.test(value.bvid) ||
                !Number.isFinite(value.time) || value.time < 0) return null;
            return {
                bvid: value.bvid, time: value.time,
                duration: Number.isFinite(value.duration) && value.duration > 0 ? value.duration : 0,
                scope: ['all', 'favorites', 'downloaded'].includes(value.scope) ? value.scope : 'all',
                order: ['list', 'single', 'random'].includes(value.order) ? value.order : 'list',
            };
        } catch (_) { return null; }
    }

    function resumeTime(time, duration) {
        if (!Number.isFinite(time) || time <= 0) return 0;
        // 已听完的歌曲从头播放；尚未拿到时长时等待元数据。
        if (!Number.isFinite(duration) || duration <= 0) return null;
        return time >= duration - 2 ? 0 : time;
    }

    function shiftLyrics(lines, seconds) {
        return lines.map(line => ({ time: Math.max(0, Math.round((line.time + seconds) * 1000) / 1000), text: line.text }));
    }

    root.SG_PLAYBACK_STATE = { createQueue, readSession, resumeTime, shiftLyrics };
})(typeof window === 'undefined' ? globalThis : window);
