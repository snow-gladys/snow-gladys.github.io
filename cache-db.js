/**
 * cache-db.js — 歌曲缓存模块（思诺/心宜两个播放器共用）
 *
 * 职责：
 *  1. IndexedDB 存储/读取音频 Blob（按 bvid 缓存）
 *  2. 播放时优先从缓存读取，未命中再走网络并写入缓存
 *  3. 以选中的音质缓存，每首约 3MB，试用阶段暂不支持清理
 */

(function (global) {
    'use strict';

    var IDB_SUPPORTED = (function () {
        try {
            return !!window.indexedDB;
        } catch (e) {
            return false;
        }
    })();

    var DB_NAME = 'sg_audio_cache';
    var DB_VERSION = 1;
    var STORE_NAME = 'audio_cache'; // keyPath: bvid, value: { bvid, blob }

    var _db = null;
    var _opening = null;

    function openDB() {
        if (_db) return Promise.resolve(_db);
        if (_opening) return _opening;
        _opening = new Promise(function (resolve, reject) {
            if (!IDB_SUPPORTED) {
                reject(new Error('IndexedDB not supported'));
                return;
            }
            if (_db) {
                resolve(_db);
                return;
            }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'bvid' });
                }
            };
            req.onsuccess = function (e) {
                _db = e.target.result;
                _db.onversionchange = function () { _db.close(); _db = null; _opening = null; };
                resolve(_db);
            };
            req.onerror = function (e) {
                reject(e.target.error);
            };
        }).catch(function (error) { _opening = null; throw error; });
        return _opening;
    }

    /** 从缓存读取音频 Blob，不存在返回 null */
    function getCachedBlob(bvid) {
        if (!bvid) return Promise.resolve(null);
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    var tx = db.transaction(STORE_NAME, 'readonly');
                    var req = tx.objectStore(STORE_NAME).get(bvid);
                    req.onsuccess = function () {
                        resolve(req.result && req.result.blob ? req.result.blob : null);
                    };
                    req.onerror = function () {
                        resolve(null);
                    };
                });
            })
            .catch(function () {
                return null;
            });
    }

    /** 将音频 Blob 写入缓存 */
    function saveToCache(bvid, blob) {
        if (!bvid || !blob || !(blob instanceof Blob)) return Promise.resolve();
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction(STORE_NAME, 'readwrite');
                    var req = tx.objectStore(STORE_NAME).put({ bvid: bvid, blob: blob });
                    req.onsuccess = function () {
                        resolve();
                    };
                    req.onerror = function (e) {
                        reject(e.target.error);
                    };
                });
            })
            .catch(function () {});
    }

    /** 只查询键，不把音频 Blob 从数据库取回。 */
    function hasCached(bvid) {
        if (!bvid) return Promise.resolve(false);
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count(bvid);
                req.onsuccess = function () { resolve(req.result > 0); };
                req.onerror = function () { resolve(false); };
            });
        }).catch(function () { return false; });
    }

    /** 返回已缓存的所有 bvid 数组，用于歌单展示缓存标记 */
    function listCachedBvids() {
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    var tx = db.transaction(STORE_NAME, 'readonly');
                    var req = tx.objectStore(STORE_NAME).getAllKeys();
                    req.onsuccess = function () {
                        resolve((req.result || []).filter(Boolean));
                    };
                    req.onerror = function () {
                        resolve([]);
                    };
                });
            })
            .catch(function () {
                return [];
            });
    }

    /** 估算缓存占用字节数（Blob.size 之和） */
    function estimateCacheBytes() {
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    var tx = db.transaction(STORE_NAME, 'readonly');
                    var store = tx.objectStore(STORE_NAME);
                    var req = store.openCursor();
                    var total = 0;
                    req.onsuccess = function () {
                        var cursor = req.result;
                        if (cursor) {
                            var row = cursor.value;
                            if (row.blob && row.blob.size) total += row.blob.size;
                            cursor.continue();
                        } else {
                            resolve(total);
                        }
                    };
                    req.onerror = function () {
                        resolve(0);
                    };
                });
            })
            .catch(function () {
                return 0;
            });
    }

    /** 清空所有音频缓存（仅删除 audio_cache 表，不影响其他存储） */
    function clearAll() {
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction(STORE_NAME, 'readwrite');
                    var store = tx.objectStore(STORE_NAME);
                    var req = store.clear();
                    req.onsuccess = function () { resolve(); };
                    req.onerror = function (e) { reject(e.target.error); };
                });
            })
            .catch(function () { });
    }

    global.SG_CACHE = {
        supported: IDB_SUPPORTED,
        getCachedBlob: getCachedBlob,
        saveToCache: saveToCache,
        hasCached: hasCached,
        listCachedBvids: listCachedBvids,
        estimateCacheBytes: estimateCacheBytes,
        clearAll: clearAll
    };
})(window);
