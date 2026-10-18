import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../cache-db.js',import.meta.url),'utf8');
function setup(fail, synchronous = false) {
    const rows = new Map(), attempts = [];
    const db = { transaction() {
        const tx = { error:null };
        tx.objectStore = () => ({
            put(row) {
                attempts.push(row);
                const error = fail && fail(row);
                if (error && synchronous) throw error;
                const req = {};
                queueMicrotask(() => {
                    if (error) { tx.error = error; req.onerror?.({target:{error}}); tx.onabort?.(); }
                    else { rows.set(row.bvid,row); req.onsuccess?.(); tx.oncomplete?.(); }
                });
                return req;
            },
            get(bv) { const req={}; queueMicrotask(()=>{req.result=rows.get(bv);req.onsuccess?.();});return req; },
            count(bv) { const req={};queueMicrotask(()=>{req.result=rows.has(bv)?1:0;req.onsuccess?.();});return req; },
            openCursor() {
                const req={},values=[...rows.values()];let index=0;
                function next(){queueMicrotask(()=>{req.result=index<values.length?{value:values[index++],continue:next}:null;req.onsuccess?.();});}
                next();return req;
            },
        });
        return tx;
    } };
    const indexedDB = { open() { const req={result:db};queueMicrotask(()=>req.onsuccess?.({target:req}));return req; } };
    const window={indexedDB};vm.runInNewContext(source,{window,indexedDB,Blob});
    return {api:window.SG_CACHE,rows,attempts};
}
const bv='BV17uZQBHEDo';
test('normal cache keeps its Blob format and resolves after commit', async () => {
    const {api,rows,attempts}=setup(); const blob=new Blob(['audio'],{type:'audio/mp4'});
    assert.equal(await api.saveToCache(bv,blob),true);assert.equal(attempts.length,1);assert.equal(rows.get(bv).blob,blob);
    assert.equal(await (await api.getCachedBlob(bv)).text(),'audio');
});
for(const [name,synchronous] of [['UnknownError',false],['DataCloneError',true]]) test('WebKit '+name+' falls back to bytes while retaining audio and MIME type',async()=>{
    const {api,rows,attempts}=setup(row=>row.blob?new DOMException('Blob storage failed',name):null,synchronous);
    assert.equal(await api.saveToCache(bv,new Blob(['audio bytes'],{type:'audio/mp4'})),true);
    assert.equal(attempts.length,2);assert.equal(rows.get(bv).buffer.byteLength,11);assert.equal(rows.get(bv).blob,undefined);
    const stored=await api.getCachedBlob(bv);assert.equal(stored.type,'audio/mp4');assert.equal(await stored.text(),'audio bytes');
    assert.equal(await api.hasCached(bv),true);assert.equal(await api.estimateCacheBytes(),11);
});
test('storage quota failure does not waste memory attempting an alternate representation',async()=>{
    const {api,rows,attempts}=setup(()=>new DOMException('Full','QuotaExceededError'));
    assert.equal(await api.saveToCache(bv,new Blob(['audio'])),false);assert.equal(attempts.length,1);assert.equal(rows.size,0);
});
test('a failed fallback remains a cache miss',async()=>{
    const {api,rows,attempts}=setup(()=>new DOMException('Disk error','UnknownError'));
    assert.equal(await api.saveToCache(bv,new Blob(['audio'])),false);assert.equal(attempts.length,2);assert.equal(rows.size,0);
    assert.equal(await api.hasCached(bv),false);assert.equal(await api.getCachedBlob(bv),null);
});
