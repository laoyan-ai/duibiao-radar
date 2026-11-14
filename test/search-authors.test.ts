import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserCollector} from '../src/browser.js';
import {createTask} from '../src/domain.js';
import {JobManager} from '../src/jobs.js';
import {TaskStore} from '../src/store.js';
import {exportTask} from '../src/export.js';

test('raw50: first 50 video cards, stable author dedup, missing author counts, no filters or detail visits; checkpoint resumes',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();let count=20;const visits:string[]=[];
  await page.route('https://www.douyin.com/**',async route=>{visits.push(route.request().url());await route.fulfill({contentType:'text/html',body:`<main>${Array.from({length:count},(_,i)=>`<li><a href="/video/${1000+i}"><h3>FDE ${i}</h3></a>${i===2?'':`<a href="/user/a${i%7}">博主${i%7}</a>`}<span>${1000-i}</span></li>`).join('')}</main>`});});
  const collector=()=>{const c=new BrowserCollector({profileDir:'unused',timings:{navigation:0,click:0,scroll:0,stability:0}});(c as any).ensure=async()=>page;(c as any).applySearchLane=()=>{throw Error('不可操作筛选菜单');};return c;};
  const task=createTask('FDE','likes',undefined,4);let saved:any;const controller=new AbortController();
  await assert.rejects(collector().search('FDE',task.limits,{signal:controller.signal,onSearchCheckpoint:async s=>{saved=structuredClone(s);controller.abort(Error('停止'));}}),/停止/);
  assert.equal(saved.videos.length,20);count=60;
  const result=await collector().search('FDE',task.limits,{searchCheckpoint:saved});
  assert.equal(result.videos.length,50);assert.equal(result.videos[49].id,'1049');assert.equal(result.authors.length,7);
  assert.deepEqual(result.authors.map(a=>a.id),['a0','a1','a3','a4','a5','a6','a2']);
  assert.equal(result.videos.filter(v=>!v.authorId).length,1);assert.match(result.reason,/1条作者未识别/);
  assert.ok(visits.every(url=>url.includes('/search/FDE?type=video')));
 }finally{await browser.close();}
});

test('raw50 job completes without profiles or model calls, exports evidence, finished resume does not search again',async()=>{
 const root=await mkdtemp(join(tmpdir(),'search-authors-'));try{
  const task=createTask('FDE','likes',undefined,4),store=new TaskStore(root);let calls=0;
  const metric={raw:null,value:null,approximate:false};
  const videos=Array.from({length:50},(_,i)=>({id:String(i),url:`https://www.douyin.com/video/${i}`,authorId:i===0?'':'a'+i%3,authorName:'博主'+i%3,authorUrl:'https://www.douyin.com/user/a'+i%3,title:'FDE '+i,description:'',dateText:'',publishedAt:null,duration:null,likes:metric,favorites:metric,shares:metric,kind:'unknown' as const,related:true,collectedAt:task.createdAt,frames:[]}));
  const forbidden=async()=>{throw Error('禁止主页、详情、采样和模型调用');};
  const collector:any={search:async()=>{calls++;return {videos,authors:[],reason:'读取50条，1条缺少作者'};},collectAuthor:forbidden,inspectVideo:forbidden,sample:forbidden,close:async()=>{}};
  const engine:any={status:()=>{throw Error('不应检查模型配置');},scoreAuthor:forbidden,analyze:forbidden,summarize:forbidden};
  const jobs=new JobManager(store,collector,engine);await store.save(task);await jobs.start(task.id);await jobs.wait();
  const done=(await store.load(task.id))!;assert.equal(done.status,'complete');assert.equal(done.authors.length,4);assert.equal(done.videos.length,50);assert.deepEqual(done.ranking,[]);assert.deepEqual(done.selectedVideoIds,[]);
  const md=exportTask(done,'md'),csv=exportTask(done,'csv');assert.match(md,/前50/);assert.match(md,/https:\/\/www.douyin.com\/video\/1/);assert.match(csv,/出现次数/);assert.doesNotMatch(md,/综合分|评分依据/);
  await jobs.start(task.id);await jobs.wait();assert.equal(calls,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
