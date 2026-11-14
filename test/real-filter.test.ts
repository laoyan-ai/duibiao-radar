import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';import {BrowserCollector} from '../src/browser.js';
const make=()=>new BrowserCollector({profileDir:'unused',timings:{navigation:0,click:0,scroll:0,stability:0}});
test('actual filter shape accepts current selection, never clicks header tabs, and only changes date/type',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.setContent(await readFile(new URL('./fixtures/real-filter-shape.html',import.meta.url),'utf8'));const c=make();await (c as any).applySearchLane(p,['综合排序','综合']);assert.deepEqual(await p.evaluate(()=>(window as any).actions),['半年内','视频']);assert.equal(await p.evaluate(()=>(window as any).tabClicks),0);for(const names of [['综合排序','综合'],['半年内'],['视频']])await (c as any).confirmSearchFilter(p,names);
 }finally{await b.close();}
});
test('header highlight cannot prove a hidden or unselected filter; normal click failure retries automatically',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.setContent(await readFile(new URL('./fixtures/real-filter-shape.html',import.meta.url),'utf8'));const c=make();await assert.rejects((c as any).confirmSearchFilter(p,['综合排序','综合']),/筛选/);await assert.rejects((c as any).confirmSearchFilter(p,['视频']),/筛选/);await p.evaluate(()=>(window as any).ignoreDate=1);const logs:string[]=[];await (c as any).applySearchLane(p,['综合排序','综合'],{onProgress:(s:string)=>logs.push(s)});assert.deepEqual(await p.evaluate(()=>(window as any).actions),['半年内','半年内','视频']);assert.ok(logs.some(s=>/自动重试/.test(s)));
 }finally{await b.close();}
});
test('hover-only menu is opened automatically without toggling it closed',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.setContent(await readFile(new URL('./fixtures/real-filter-shape.html',import.meta.url),'utf8'));await p.evaluate(()=>{const trigger=document.querySelector('button')!,menu=document.querySelector<HTMLElement>('#menu')!,wrapper=document.createElement('div');trigger.before(wrapper);wrapper.append(trigger,menu);wrapper.style.width='fit-content';trigger.onmouseenter=()=>{menu.hidden=false;};trigger.onclick=()=>{menu.hidden=true;};wrapper.onmouseleave=()=>{menu.hidden=true;};});await (make() as any).applySearchLane(p,['综合排序','综合']);assert.deepEqual(await p.evaluate(()=>(window as any).actions),['半年内','视频']);assert.equal(await p.evaluate(()=>(window as any).opens),0);
 }finally{await b.close();}
});
test('persistent normal filter failure is bounded and never asks the user to operate the menu',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.setContent(await readFile(new URL('./fixtures/real-filter-shape.html',import.meta.url),'utf8'));await p.evaluate(()=>(window as any).ignoreDate=100);await assert.rejects((make() as any).applySearchLane(p,['综合排序','综合']),error=>/自动筛选未完成/.test(String(error))&&!/等待本人|请在采集浏览器/.test(String(error)));assert.equal((await p.evaluate(()=>(window as any).actions)).length,3);
 }finally{await b.close();}
});
test('contradictory filter states stop after bounded combination checks instead of accepting the wrong sample',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.setContent(await readFile(new URL('./fixtures/real-filter-shape.html',import.meta.url),'utf8'));await p.evaluate(()=>{for(const el of document.querySelectorAll<HTMLElement>('[data-index1="0"],[data-index1="1"]')){const original=el.onclick;el.onclick=function(event){original?.call(this,event);const other=el.getAttribute('data-index1')==='0'?'1':'0';for(const option of document.querySelectorAll(`[data-index1="${other}"]`))option.classList.remove('sDNqBVWH');};}});await assert.rejects((make() as any).applySearchLane(p,['综合排序','综合']),/3次核对后仍不稳定/);assert.ok((await p.evaluate(()=>(window as any).actions)).length<10);
 }finally{await b.close();}
});
