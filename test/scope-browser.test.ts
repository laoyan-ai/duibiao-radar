import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {BrowserCollector} from '../src/browser.js';import {createTask} from '../src/domain.js';import type {SearchCheckpoint} from '../src/types.js';
const searchHtml=(count:number,end=false)=>`<main>${Array.from({length:count},(_,i)=>`<li><a href="/video/${1000+i}"><h3>FDE ${i}</h3></a><a href="/user/a${i}">作者${i}</a><span>10</span></li>`).join('')}${end?'<p>没有更多了</p>':''}</main>`;
test('raw policy reads all 200 authors, saves budget-bound checkpoint and resumes without navigation',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();let visits=0,saved:SearchCheckpoint|undefined;
 await p.route('https://www.douyin.com/**',async r=>{visits++;await r.fulfill({contentType:'text/html',body:searchHtml(205)});});
 const c=new BrowserCollector({profileDir:'unused',timings:{navigation:0,click:0,scroll:0,stability:0}});(c as any).ensure=async()=>p;
 const limits=createTask('FDE','likes',undefined,4,{searchLimit:200,profileLimit:30}).limits;
 const result=await c.search('FDE',limits,{onSearchCheckpoint:async x=>{saved=x;}});assert.equal(result.videos.length,200);assert.equal(result.authors.length,200);assert.equal(saved?.searchLimit,200);assert.equal(saved?.lanes.combined.done,true);assert.match(result.reason,/200\/200/);
 const resumed=await c.search('FDE',limits,{searchCheckpoint:saved});assert.equal(resumed.videos.length,200);assert.equal(visits,1);
 await assert.rejects(c.search('FDE',{...limits,maxSearchVideos:100},{searchCheckpoint:saved}),/范围|上限|预算|不一致/);assert.equal(visits,1);
 }finally{await b.close();}
});
test('raw policy reports underfill, binds partial checkpoint and accepts historical missing budget only at 50',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();let saved:SearchCheckpoint|undefined;
 await p.route('https://www.douyin.com/**',r=>r.fulfill({contentType:'text/html',body:searchHtml(7,true)}));const c=new BrowserCollector({profileDir:'unused',timings:{navigation:0,click:0,scroll:0,stability:0}});(c as any).ensure=async()=>p;
 const limits=createTask('FDE','likes',undefined,4,{searchLimit:100}).limits;const result=await c.search('FDE',limits,{onSearchCheckpoint:async x=>{saved=x;}});assert.equal(result.videos.length,7);assert.match(result.reason,/7\/100/);assert.equal(saved?.searchLimit,100);
 const legacy={...saved!,searchLimit:undefined};await assert.rejects(c.search('FDE',limits,{searchCheckpoint:legacy}),/范围|上限|预算|不一致/);const out=await c.search('FDE',{...limits,maxSearchVideos:50},{searchCheckpoint:legacy});assert.equal(out.videos.length,7);
 for(const n of [0,201,1.5])await assert.rejects(c.search('FDE',{...limits,maxSearchVideos:n}),/1.*200|整数/);
 }finally{await b.close();}
});
test('homepage sampling honors 30 current cards including pinned without opening posts',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage(),visits:string[]=[];
 await p.route('https://www.douyin.com/**',r=>{visits.push(r.request().url());return r.fulfill({contentType:'text/html',body:'<div data-e2e="user-info"><h1>作者</h1></div><main data-e2e="user-post-list"><ul>'+Array.from({length:35},(_,i)=>`<li><a href="/video/${2000+i}"><span>${i+1}</span><p>${i===0?'置顶 ':''}作品${i}</p></a></li>`).join('')+'</ul></main>'});});const c=new BrowserCollector({profileDir:'unused',timings:{navigation:0,click:0,scroll:0,stability:0}});(c as any).ensure=async()=>p;
 const result=await c.collectAuthor({id:'a',name:'作者',url:'https://www.douyin.com/user/a',coverage:'partial',reason:'',fetchedCount:0},'',30,{requireOwnPosts:true});assert.equal(result.videos.length,30);assert.equal(result.videos[0].id,'2000');assert.equal(result.videos[29].id,'2029');assert.equal(visits.length,1);
 }finally{await b.close();}
});

test('interrupted 100-budget search resumes all saved identities and rejects a 200-budget draft',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();let count=23,saved:SearchCheckpoint|undefined;const control=new AbortController();
 await p.route('https://www.douyin.com/**',r=>r.fulfill({contentType:'text/html',body:searchHtml(count)}));const c=new BrowserCollector({profileDir:'unused',timings:{navigation:0,click:0,scroll:0,stability:0}});(c as any).ensure=async()=>p;const limits=createTask('FDE','likes',undefined,4,{searchLimit:100,profileLimit:20}).limits;
 await assert.rejects(c.search('FDE',limits,{signal:control.signal,onSearchCheckpoint:async x=>{saved=structuredClone(x);control.abort(Error('local pause'));}}),/local pause/);assert.equal(saved?.videos.length,23);assert.equal(saved?.searchLimit,100);assert.equal(saved?.lanes.combined.done,false);
 count=120;const out=await c.search('FDE',limits,{searchCheckpoint:saved});assert.equal(out.videos.length,100);assert.equal(out.videos[0].id,'1000');assert.equal(out.videos[99].id,'1099');assert.equal(out.authors.length,100);
 await assert.rejects(c.search('FDE',{...limits,maxSearchVideos:200},{searchCheckpoint:saved}),/不一致/);
 }finally{await b.close();}
});
