import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const A='BV17uZQBHEDo', B='BV1Sf421Q7Rt';
function api(fetch=()=>{}) {
 const window={}; vm.runInNewContext(read('bili-api.js'),{window,fetch,URL,AbortController,DOMException}); return window.SG_BILI_API;
}
test('video input extracts bare BV, full URL and mobile share text without supporting AV',()=>{
 const client=api();
 for(const text of [A,'bv'+A.slice(2),'https://www.bilibili.com/video/'+A+'/?share_source=copy_web','【分享歌曲】 https://m.bilibili.com/video/'+A+'。']) assert.equal(client.videoInput(text).bvid,A);
 for(const text of ['【分享歌曲】 https://b23.tv/AbC123，快来听听','b23.tv/AbC123?share=1']) assert.equal(client.videoInput(text).shortUrl,'https://b23.tv/AbC123');
 for(const text of ['av12345','BV12345',A+'suffix','https://evil.example/b23.tv/AbC123','https://b23.tv.evil.example/AbC123']) assert.deepEqual(JSON.parse(JSON.stringify(client.videoInput(text))),{bvid:'',shortUrl:''});
});
test('video title responses are validated and cached for both short links and BV',async()=>{
 const calls=[];
 const client=api(async url=>{calls.push(url);return new Response(JSON.stringify({bvid:A,name:'视频标题'}));}).createClient('https://edge.example');
 assert.equal((await client.videoInfo('https://b23.tv/AbC123')).name,'视频标题');
 assert.equal((await client.videoInfo(A)).bvid,A); assert.equal(calls.length,1);assert.match(calls[0],/\/info\?url=/);
 await assert.rejects(api(async()=>new Response('{}')).createClient('https://edge.example').videoInfo(A),/标题/);
});
function form(fetchTitle) {
 const events = () => ({value:'',hidden:true,addEventListener(type,fn){this[type]=fn;}});
 const input=events(),name=events(),retry=events(),status={textContent:''};
 const window={SG_BILI_API:api()};
 vm.runInNewContext(read('song-entry.js'),{window,AbortController,setTimeout,clearTimeout});
 const control=window.SG_SONG_ENTRY.create({input,name,status,retry,client:{videoInfo:fetchTitle},find:()=>null});
 control.begin(); return {input,name,retry,status,control};
}
test('quickly changing BV discards an older response; user title wins while waiting',async()=>{
 const pending=new Map();const h=form(id=>new Promise(resolve=>pending.set(id,resolve)));
 h.input.value=A;h.input.input();const first=h.control.read();await Promise.resolve();
 h.input.value=B;h.input.input();const second=h.control.read();await Promise.resolve();
 h.name.value='我的歌名';h.name.input();pending.get(B)({bvid:B,name:'第二首视频标题'});
 const result=await second;assert.equal(result.bvid,B);assert.equal(result.name,'我的歌名');
 pending.get(A)({bvid:A,name:'过期标题'});assert.equal(await first,null);assert.equal(h.name.value,'我的歌名');h.control.close();
});
test('closing and reopening the form blocks a stale fill and stale save',async()=>{
 let finish;const h=form(()=>new Promise(resolve=>{finish=resolve;}));
 h.input.value=A;const save=h.control.read();await Promise.resolve();
 h.control.close();h.input.value='';h.name.value='';h.control.begin();finish({bvid:A,name:'旧标题'});
 assert.equal(await save,null);assert.equal(h.name.value,'');h.control.close();
});
test('automatic titles are cleared when changing video and manual fallback remains usable',async()=>{
 const h=form(async()=>({bvid:A,name:'自动标题'}));h.input.value=A;await h.control.read();assert.equal(h.name.value,'自动标题');
 h.input.value=B;h.input.input();assert.equal(h.name.value,'');h.control.close();
 let calls=0;const fallback=form(async()=>{calls++;throw new Error('unavailable');});fallback.input.value=A;
 await assert.rejects(fallback.control.read(),/手动/);fallback.name.value='手动输入';fallback.name.input();
 assert.equal((await fallback.control.read()).verified,false);assert.equal(calls,1);fallback.control.close();
});
function edge(fetch) {
 const context=vm.createContext({URL,URLSearchParams,Request,Response,Headers,fetch,console,addEventListener(){}});
 vm.runInContext(read('edge-functions/bilibili.js'),context);
 return path=>context.handleRequest(new Request('https://edge.example'+path,{headers:{Origin:'https://snow-gladys.com'}}));
}
test('edge metadata reads only the video info endpoint and coalesces requests',async()=>{
 const calls=[];const request=edge(async url=>{calls.push(url);return new Response(JSON.stringify({code:0,data:{bvid:A,title:'实际视频标题'}}));});
 const [a,b]=await Promise.all([request('/info?bvid='+A),request('/info?bvid='+A)]);
 assert.deepEqual(await a.json(),{bvid:A,name:'实际视频标题'});assert.equal(b.status,200);
 assert.equal((await request('/info?bvid='+A)).status,200);assert.equal(calls.length,1);assert.ok(calls[0].includes('/x/web-interface/view?bvid='));
});
test('short link parsing restricts network destinations and cancels unused bodies',async()=>{
 const calls=[];let cancelled=false;
 const request=edge(async(url,init)=>{
  calls.push(url);
  if(url.startsWith('https://b23.tv/')) {assert.equal(init.redirect,'manual');return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{Location:'https://www.bilibili.com/video/'+A+'/?share_source=copy'}});}
  return new Response(JSON.stringify({code:0,data:{bvid:A,title:'歌名'}}));
 });
 assert.deepEqual(await(await request('/info?url='+encodeURIComponent('https://b23.tv/AbC123'))).json(),{bvid:A,name:'歌名'});
 assert.equal(cancelled,true);assert.equal(calls.length,2);
 for(const url of ['https://evil.example/','http://b23.tv/AbC123','https://user@b23.tv/AbC123','https://b23.tv:444/AbC123','https://b23.tv/a/b']) assert.equal((await request('/info?url='+encodeURIComponent(url))).status,400);
 assert.equal(calls.length,2);
 const redirected=[];const reject=edge(async url=>{redirected.push(url);return new Response(null,{status:302,headers:{Location:'https://evil.example/video/'+A}});});
 assert.equal((await reject('/info?url='+encodeURIComponent('https://b23.tv/AbC123'))).status,422);assert.equal(redirected.length,1);
});
test('metadata missing, deleted and risk-controlled videos remain distinguishable',async()=>{
 for(const [data,status,code] of [[{code:0,data:{}},502,'UPSTREAM_INVALID_DATA'],[{code:-404},404,'VIDEO_NOT_FOUND'],[{code:-412},503,'BILI_RISK_CONTROL']]){
  const response=await edge(async()=>new Response(JSON.stringify(data)))('/info?bvid='+A);
  assert.equal(response.status,status);assert.equal((await response.json()).code,code);
 }
});
test('failed local save preserves the old list and concurrent submits do not add twice',async()=>{
 const player=read('index.js'),start=player.indexOf('        async function submitCustomForm()'),end=player.indexOf('        loadSongs();',start);
 const fields={'custom-form-name':{dataset:{}},'custom-form-lyrics':{value:''},'custom-form-submit':{},'custom-form-info-status':{}};
 let finish,reads=0,saves=0;
 const context=vm.createContext({customFormSaving:false,customFormTargetPlaylist:'',customList:[],document:{getElementById:id=>fields[id]},
  customSongEntry:{session:1,current:()=>true,read(){reads++;return new Promise(resolve=>{finish=resolve;});}},
  saveCustomToStorage(){saves++;return false;},closeCustomForm(){assert.fail('failed save must remain editable');},showToast(){assert.fail('failed save must not report success');},
  buildSongList(){assert.fail('failed save must not change the library');}});
 vm.runInContext(player.slice(start,end),context);
 const first=context.submitCustomForm();await context.submitCustomForm();assert.equal(reads,1);
 finish({bvid:A,name:'歌曲',verified:true});await first;
 assert.equal(saves,1);assert.equal(context.customList.length,0);assert.match(fields['custom-form-info-status'].textContent,/保存失败/);assert.equal(fields['custom-form-submit'].disabled,false);
});
