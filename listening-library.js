(function (root) {
    'use strict';
    const validId = id => typeof id === 'string' && /^BV[0-9a-zA-Z]{10}$/.test(id);
    function song(value) {
        return value && validId(value.bvid) ? { bvid: value.bvid, name: String(value.name || value.title || value.bvid).slice(0, 300) } : null;
    }
    function create(options) {
        let data = { queue: [], recent: [], excluded: [], anchor: null, active: false }, revision = 0, serial = 0;
        try {
            const stored = JSON.parse(options.storage.getItem(options.key));
            if (stored) {
                for (const key of ['queue', 'recent', 'excluded']) {
                    const seen = new Set();
                    data[key] = (Array.isArray(stored[key]) ? stored[key] : []).flatMap(value => {
                        const clean = song(value);
                        if (!clean || seen.has(clean.bvid)) return [];
                        seen.add(clean.bvid);
                        if (key === 'queue') clean.id = 'restored-' + (++serial);
                        if (key === 'recent') clean.playedAt = Number.isFinite(value.playedAt) ? value.playedAt : 0;
                        return [clean];
                    }).slice(0, key === 'recent' ? 100 : key === 'queue' ? 200 : 10000);
                }
                data.anchor = validId(stored.anchor) ? stored.anchor : null;
                data.active = stored.active === true || !!data.anchor;
            }
        } catch (_) {}
        const excludedIds = new Set(data.excluded.map(item => item.bvid));
        function changed() {
            revision++;
            try { options.storage.setItem(options.key, JSON.stringify(data)); }
            catch (_) { if (options.onError) options.onError(); }
            if (options.onChange) options.onChange();
        }
        return {
            get revision() { return revision; },
            get anchor() { return data.anchor; },
            list(key) { return (data[key] || []).map(item => ({ ...item })); },
            add(value, next) {
                const clean = song(value);
                if (!clean) return false;
                const existing = data.queue.find(item => item.bvid === clean.bvid);
                if (!existing && data.queue.length >= 200) return false;
                data.queue = data.queue.filter(item => item.bvid !== clean.bvid);
                const entry = { ...clean, id: existing ? existing.id : 'queued-' + (++serial) };
                if (next) data.queue.unshift(entry); else data.queue.push(entry);
                changed(); return true;
            },
            move(id, step) {
                const index = data.queue.findIndex(item => item.id === id), target = index + step;
                if (index < 0 || target < 0 || target >= data.queue.length) return;
                [data.queue[index], data.queue[target]] = [data.queue[target], data.queue[index]];
                changed();
            },
            remove(id) { data.queue = data.queue.filter(item => item.id !== id); changed(); },
            clearQueue() { data.queue = []; changed(); },
            startQueued(id, anchor) {
                if (!data.queue.some(item => item.id === id)) return;
                if (!data.active) data.anchor = validId(anchor) ? anchor : null;
                data.active = true;
                data.queue = data.queue.filter(item => item.id !== id);
                changed();
            },
            leaveQueue() { if (data.active || data.anchor) { data.anchor = null; data.active = false; changed(); } },
            record(value, time) {
                const clean = song(value);
                if (!clean) return;
                data.recent = [{ ...clean, playedAt: time || Date.now() }, ...data.recent.filter(item => item.bvid !== clean.bvid)].slice(0, 100);
                changed();
            },
            clearRecent() { data.recent = []; changed(); },
            isExcluded(id) { return excludedIds.has(id); },
            exclude(value, excluded) {
                const clean = song(value);
                if (!clean) return;
                data.excluded = data.excluded.filter(item => item.bvid !== clean.bvid);
                if (excluded) data.excluded.push(clean);
                if (excluded) excludedIds.add(clean.bvid); else excludedIds.delete(clean.bvid);
                changed();
            },
        };
    }
    root.SG_LISTENING = { create };
})(typeof window === 'undefined' ? globalThis : window);
