/**
 * lyrics-db.js — 歌词模块（思诺/心宜两个播放器共用）
 *
 * 职责：
 *  1. 解析 LRC 格式歌词 → 返回 [{time, text}, ...] 数组
 *  2. IndexedDB 操作：读/写/删 用户自定义歌词
 *  3. 加载歌词：优先 IndexedDB 用户歌词，否则查 lyrics/lyrics.json 后 fetch lrc 文件
 *  4. 检测 IndexedDB 可用性并对外暴露
 */

(function (global) {
    'use strict';

    // ── IndexedDB 可用性检测 ──────────────────────────────────────────
    var IDB_SUPPORTED = (function () {
        try {
            return !!window.indexedDB;
        } catch (e) {
            return false;
        }
    })();

    var DB_NAME = 'sg_lyrics_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'user_lyrics'; // key: bvid 原始大小写，value: lrc 字符串

    var _db = null; // 缓存已打开的数据库连接

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (!IDB_SUPPORTED) { reject(new Error('IndexedDB not supported')); return; }
            if (_db) { resolve(_db); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'bvid' });
                }
            };
            req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
            req.onerror = function (e) { reject(e.target.error); };
        });
    }

    /** 从 IndexedDB 读取用户歌词，返回 lrc 字符串或 null */
    function getUserLrc(bvid) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var req = tx.objectStore(STORE_NAME).get(bvid || '');
                req.onsuccess = function () { resolve(req.result ? req.result.lrc : null); };
                req.onerror = function () { resolve(null); };
            });
        }).catch(function () { return null; });
    }

    /** 向 IndexedDB 写入用户歌词 */
    function saveUserLrc(bvid, lrcText) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var req = tx.objectStore(STORE_NAME).put({ bvid: bvid || '', lrc: lrcText });
                req.onsuccess = function () { resolve(); };
                req.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /** 从 IndexedDB 删除用户歌词 */
    function deleteUserLrc(bvid) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var req = tx.objectStore(STORE_NAME).delete(bvid || '');
                req.onsuccess = function () { resolve(); };
                req.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /** 获取 IndexedDB 中所有用户歌词条目 [{bvid, lrc}] */
    function getAllUserLrc() {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var req = tx.objectStore(STORE_NAME).getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { resolve([]); };
            });
        }).catch(function () { return []; });
    }

    /**
     * 估算 IndexedDB 用户歌词数据占用字节数（UTF-16，2字节/字符）。
     * 返回 Promise<number>
     */
    function estimateIdbBytes() {
        return getAllUserLrc().then(function (rows) {
            var bytes = 0;
            rows.forEach(function (r) {
                bytes += ((r.bvid || '').length + (r.lrc || '').length) * 2;
            });
            return bytes;
        }).catch(function () { return 0; });
    }

    // ── LRC 解析 ─────────────────────────────────────────────────────
    /**
     * 解析 LRC 文本。
     * @param {string} lrcText
     * @returns {Array<{time: number, text: string}>} 按时间升序，time 单位秒
     */
    function parseLrc(lrcText) {
        if (!lrcText || typeof lrcText !== 'string') return [];
        var lines = lrcText.split(/\r?\n/);
        var result = [];
        var timeReg = /\[(\d{1,3}):(\d{2})(?:[.::](\d{1,3}))?\]/g;

        lines.forEach(function (line) {
            line = line.trim();
            if (!line) return;
            // 收集该行所有时间标签
            var times = [];
            var match;
            timeReg.lastIndex = 0;
            while ((match = timeReg.exec(line)) !== null) {
                var min = parseInt(match[1], 10);
                var sec = parseInt(match[2], 10);
                var ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
                times.push(min * 60 + sec + ms / 1000);
            }
            if (!times.length) return;
            // 文本 = 去掉所有时间标签后的内容
            var text = line.replace(/\[\d{1,3}:\d{2}(?:[.::]?\d{1,3})?\]/g, '').trim();
            times.forEach(function (t) {
                result.push({ time: t, text: text });
            });
        });

        result.sort(function (a, b) { return a.time - b.time; });
        return result;
    }

    // ── 歌词加载（查找 IndexedDB → lyrics.json → fetch lrc）────────────
    // basePath：lyrics/ 目录的路径前缀，可由各播放器通过 setBasePath() 配置
    var _basePath = './lyrics/';
    var _lyricsIndex = null; // 缓存 lyrics.json 内容

    /** 设置 lyrics 目录路径前缀（末尾须带 /） */
    function setBasePath(path) {
        _basePath = path;
        _lyricsIndex = null; // 路径变了，清除缓存
    }

    function loadLyricsIndex() {
        if (_lyricsIndex) return Promise.resolve(_lyricsIndex);
        return fetch(_basePath + 'lyrics.json?_=' + Date.now())
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                _lyricsIndex = (data && data.map) ? data.map : {};
                return _lyricsIndex;
            })
            .catch(function () { _lyricsIndex = {}; return {}; });
    }

    /**
     * 加载某首歌的歌词。
     * 优先级：用户 IndexedDB > lyrics.json + lrc 文件。
     * @param {string} bvid
     * @returns {Promise<Array<{time, text}> | null>}  null 表示无歌词
     */
    function loadLyrics(bvid) {
        if (!bvid) return Promise.resolve(null);

        // 1. 先查用户 IndexedDB（原始 bvid）
        return getUserLrc(bvid).then(function (userLrc) {
            if (userLrc) return parseLrc(userLrc);
            // 2. 查内置索引（直接用原始 bvid 匹配）
            return loadLyricsIndex().then(function (idx) {
                var filename = idx[bvid];
                if (!filename) return null;
                return fetch(_basePath + encodeURIComponent(filename))
                    .then(function (r) { return r.ok ? r.text() : null; })
                    .then(function (text) { return text ? parseLrc(text) : null; })
                    .catch(function () { return null; });
            });
        });
    }

    // ── 对外暴露 ─────────────────────────────────────────────────────
    global.SG_LYRICS = {
        supported: IDB_SUPPORTED,
        setBasePath: setBasePath,
        parseLrc: parseLrc,
        loadLyrics: loadLyrics,
        getUserLrc: getUserLrc,
        saveUserLrc: saveUserLrc,
        deleteUserLrc: deleteUserLrc,
        getAllUserLrc: getAllUserLrc,
        estimateIdbBytes: estimateIdbBytes
    };

})(window);
