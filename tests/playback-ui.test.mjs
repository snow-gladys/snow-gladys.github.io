import { installTimeline } from './helpers/player-timeline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../playback-ui.js',import.meta.url),'utf8');
function setup(){
 const frames=new Map();let serial=0,rectReads=0,seeks=0,commits=0,position=10,track='A';
 function element(){const events={},classes=new Set(),values={};return{value:'0',textContent:'',events,style:{setProperty(k,v){values[k]=v;},values},classList:{toggle(k,v){if(v)classes.add(k);else classes.delete(k);},contains:k=>classes.has(k)},addEventListener(k,fn){(events[k]??=[]).push(fn);},dispatch(k,extra={}){for(const fn of events[k]||[])fn({type:k,preventDefault(){},...extra});},setAttribute(k,v){this[k]=v;},setPointerCapture(){},focus(){}};}
 const input=element(),fill=element(),thumb=element(),container=element(),current=element(),total=element(),document=element();document.hidden=false;
 container.getBoundingClientRect=()=>{rectReads++;return{left:10,width:200};};container.querySelector=s=>s.includes('fill')?fill:thumb;
 const window={...element(),PointerEvent:function(){},requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);}};
 const audio={paused:true,ended:false,duration:200,get currentTime(){return position;},set currentTime(v){seeks++;position=v;}};
 vm.runInNewContext(source,{window,document});
 const ui=window.SG_PLAYBACK_UI.createProgress({input,container,current,total,audio:()=>audio,track:()=>track,mainVisible:()=>true,homeVisible:()=>false,format:t=>String(Math.floor(t)),onCommit(){commits++;}});
 function frame(t=17){const current=[...frames];frames.clear();for(const[,fn]of current)fn(t);}
 frame();return{ui,window,document,audio,input,fill,thumb,current,total,container,frames,frame,rectReads:()=>rectReads,seeks:()=>seeks,commits:()=>commits,setTrack:value=>{track=value;}};
}
test('a burst of range input paints the latest value in one frame without seeking',()=>{
 const h=setup();const before=h.fill.style.transform;
 for(let i=0;i<300;i++){h.input.value=String(i/3);h.input.dispatch('input');}
 assert.equal(h.seeks(),0);assert.equal(h.fill.style.transform,before);assert.equal(h.frames.size,1);
 h.frame(100);assert.equal(h.current.textContent,'199');assert.equal(h.rectReads(),1);
 h.input.dispatch('change');h.document.dispatch('pointerup');assert.equal(h.seeks(),1);assert.equal(h.commits(),1);assert.equal(h.ui.dragging,false);
});
test('pointer dragging uses track coordinates, commits once outside, and clamps boundaries',()=>{
 const h=setup();h.input.dispatch('pointerdown',{button:0,pointerId:1,clientX:110});h.input.dispatch('pointermove',{pointerId:1,clientX:500});h.frame(100);
 assert.equal(h.seeks(),0);assert.equal(h.current.textContent,'200');assert.equal(h.rectReads(),2);
 h.document.dispatch('pointerup',{pointerId:1});h.input.dispatch('change');assert.equal(h.seeks(),1);assert.equal(h.audio.currentTime,200);
});
test('cancelled drag and lost focus restore progress without moving the audio',()=>{
 for(const event of ['pointercancel','blur']){const h=setup();h.input.dispatch('pointerdown',{button:0,pointerId:1,clientX:150});h.frame(100);(event==='blur'?h.window:h.input).dispatch(event);h.frame(200);assert.equal(h.seeks(),0);assert.equal(h.ui.dragging,false);assert.equal(h.current.textContent,'10');}
});
test('switching songs during a drag cannot seek the newly selected song',()=>{
 const h=setup();h.input.dispatch('pointerdown',{button:0,pointerId:1,clientX:150});h.setTrack('B');h.ui.cancel();
 h.input.dispatch('pointermove',{pointerId:1,clientX:180});h.input.dispatch('input');h.input.dispatch('change');h.document.dispatch('pointerup',{pointerId:1});assert.equal(h.seeks(),0);
 h.input.dispatch('pointerdown',{button:0,pointerId:1,clientX:110});h.document.dispatch('pointerup',{pointerId:1});assert.equal(h.seeks(),1);
});
test('keyboard range input still commits, and hidden pages stop frame callbacks',()=>{
 const h=setup();h.input.value='25';h.input.dispatch('input');h.input.dispatch('change');assert.equal(h.audio.currentTime,50);
 h.audio.paused=false;h.ui.refresh();h.frame(100);assert.equal(h.frames.size,1);
 h.document.hidden=true;h.document.dispatch('visibilitychange');assert.equal(h.frames.size,0);
 h.document.hidden=false;h.document.dispatch('visibilitychange');h.frame(200);assert.equal(h.frames.size,1);
});
test('unknown duration cannot be dragged and repeated refreshes share one frame',()=>{
 const h=setup();h.audio.duration=Infinity;h.input.dispatch('pointerdown',{button:0,pointerId:1,clientX:110});h.input.dispatch('input');h.input.dispatch('change');assert.equal(h.seeks(),0);
 for(let i=0;i<100;i++)h.ui.refresh();assert.equal(h.frames.size,1);h.frame(100);assert.equal(h.frames.size,0);assert.ok(!h.fill.style.transform.includes('NaN'));
});
test('frame tasks keep only the latest call and can cancel stale searches',()=>{
 const h=setup(),seen=[];const task=h.window.SG_PLAYBACK_UI.frameTask(value=>seen.push(value));
 for(let i=0;i<12;i++)task(i);h.frame();assert.deepEqual(seen,[11]);task(22);task.cancel();h.frame();assert.deepEqual(seen,[11]);
});
test('audio events dispatch the latest progress function exactly once after rebinding',()=>{
 const player=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const start=player.indexOf('        function handleAudioProgress('),end=player.indexOf('        // 单独抽离 ended',start);
 let calls=0;const audio=new EventTarget(),noop=()=>{};
 const context=vm.createContext({currentPlayingBvid:'',playbackHealth:null,bgmAudio:audio,updateProgressDisplay:()=>calls++,handleAudioEnded:noop,handleAudioPlay:noop,handleAudioPause:noop,handleAudioError:noop,onVisualizerWaiting:noop,onVisualizerPlaying:noop});
 installTimeline(context,player);vm.runInContext(readFileSync(new URL('../playback-buffer.js',import.meta.url),'utf8'),context);
 vm.runInContext(player.slice(start,end),context);context.bindAudioEvents(audio);context.updateProgressDisplay=()=>calls+=10;context.bindAudioEvents(audio);context.bindAudioEvents(audio);
 audio.dispatchEvent(new Event('timeupdate'));assert.equal(calls,10);audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(calls,20);
 context.bgmAudio=new EventTarget();audio.dispatchEvent(new Event('timeupdate'));assert.equal(calls,20);
});
