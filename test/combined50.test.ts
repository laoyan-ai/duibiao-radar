import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';import {BrowserCollector} from '../src/browser.js';
test('combined50 reads only comprehensive top50, deduplicates authors and resumes its own checkpoint',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await browser.newPage();let partial=true;const html=(await readFile(new URL('./fixtures/browser-dual50.html',import.meta.url),'utf8')).replace('最多点赞</button>','不支持点赞排序</button>').replace("href=\"/user/author-'+id","href=\"/user/author-'+(id===1041?1040:id)");await p.route('https://www.douyin.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:partial?html.replace('i<55','i<20'):html}));
 const make=()=>{const c=new BrowserCollector({profileDir:'unused',timings:{navigation:0,click:0,scroll:0,stability:0}});(c as any).ensure=async()=>p;return c;};
 const limits={policy:'combined50' as any,searchPerSort:50,maxSearchVideos:50,maxAuthors:50,profileMax:12},controller=new AbortController();let saved:any;
 await assert.rejects(make().search('FDE',limits,{signal:controller.signal,onSearchCheckpoint:async s=>{saved=structuredClone(s);controller.abort(Error('停止'));}}),/停止/);
 assert.equal(saved.policy,'combined50');assert.equal(saved.lanes.combined.seenIds.length,21);assert.equal(saved.lanes.likes.seenIds.length,0);
 partial=false;let last:any;const result=await make().search('FDE',limits,{searchCheckpoint:saved,onSearchCheckpoint:async s=>{last=s;}});
 assert.equal(result.videos.length,49);assert.equal(last.lanes.combined.seenIds.length,50);assert.equal(result.authors.length,48);assert.ok(result.authors.every(a=>a.sourceSorts?.join()==='combined'));assert.deepEqual(await p.evaluate(()=> (window as any).actions),['综合排序','半年内','视频']);assert.doesNotMatch(result.reason,/最多点赞/);
 }finally{await browser.close();}
});
