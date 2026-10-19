import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('wardrobe.js');
function harness(){
 const images=[],draws=[],events=[],cache=new Map();const avatars=new Map();
 const context=vm.createContext({selected:'gladys',artworkCache:cache,avatars,Image:function(){images.push(this);this.naturalWidth=2560;this.naturalHeight=400;},
  image:id=>avatars.get(id)||id+'.webp',cropRect:(w,h,z,x,y)=>({x:(w-h)*x,y:0,side:h}),
  document:{createElement:()=>({getContext:()=>({fillRect(){},drawImage(...args){draws.push(args);}}),toDataURL:()=> 'data:image/jpeg;base64,image'+draws.length})},
  root:{dispatchEvent:event=>events.push(event.type)},CustomEvent:function(type){this.type=type;}});
 vm.runInContext(source.slice(source.indexOf('    function artwork()'),source.indexOf('    function apply()')),context);
 return{context,images,draws,events,avatars,cache,run:code=>vm.runInContext(code,context)};
}
test('artwork renders the same crop as the selected portrait into a persistent square image',()=>{
 const h=harness();h.run("refreshArtwork({id:'gladys',position:'65% 50%'})");h.images[0].onload();
 const result=h.run('artwork()');assert.equal(result[0].type,'image/jpeg');assert.equal(result[0].sizes,'512x512');
 assert.ok(result[0].src.startsWith('data:image/jpeg;'));assert.equal(h.draws[0][1],1404);assert.equal(h.events.length,1);
 h.run("refreshArtwork({id:'gladys',position:'65% 50%'})");assert.equal(h.images.length,1);
});
test('a replaced avatar rejects a stale render; custom portraits use their own centered crop',()=>{
 const h=harness();h.run("refreshArtwork({id:'gladys',position:'65% 50%'})");
 h.avatars.set('gladys','blob:new-avatar');h.run("refreshArtwork({id:'gladys',position:'65% 50%'})");h.images[0].onload();assert.equal(h.draws.length,0);
 h.images[1].onload();assert.equal(h.draws[0][1],1080);assert.equal(h.run('artwork().length'),1);
 h.avatars.delete('gladys');assert.equal(h.run('artwork().length'),0);
 h.run("refreshArtwork({id:'gladys',position:'65% 50%'})");h.images[2].onload();assert.equal(h.draws.length,2);
});
test('switching profiles cannot publish an older profile as the active artwork',()=>{
 const h=harness();h.run("refreshArtwork({id:'gladys',position:'50% 50%'}); selected='fiona'; refreshArtwork({id:'fiona',position:'50% 50%'})");
 h.images[0].onload();assert.equal(h.events.length,0);assert.equal(h.run('artwork().length'),0);
 h.images[1].onload();assert.equal(h.events.length,1);assert.equal(h.run('artwork().length'),1);
});
test('regular media session updates include current artwork and respect the user off switch',()=>{
 const player=read('index.js');const start=player.indexOf('        function updateMediaSession()');const end=player.indexOf('        // 原生 HLS',start);
 const session={setActionHandler(){}};const art=[{src:'data:image/jpeg;base64,current',type:'image/jpeg',sizes:'512x512'}];
 const context=vm.createContext({navigator:{mediaSession:session},settings:{},window:{SG_WARDROBE:{artwork:()=>art}},bgmAudio:{paused:false},currentPlayingBvid:'BV17uZQBHEDo',getSongNameByBvid:()=> '歌曲',MediaMetadata:function(data){Object.assign(this,data);}});
 vm.runInContext(player.slice(start,end),context);context.updateMediaSession();assert.equal(session.metadata.artwork,art);
 context.settings.mediaSession='off';context.updateMediaSession();assert.equal(session.metadata,null);assert.equal(session.playbackState,'none');
});
