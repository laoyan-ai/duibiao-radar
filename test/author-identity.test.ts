import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {readVisibleSnapshot,parseCards} from '../src/browser.js';
import {organizeSearchAuthors} from '../src/search-authors.js';
import {createTask} from '../src/domain.js';
import {JobManager} from '../src/jobs.js';import {TaskStore} from '../src/store.js';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const metric={raw:null,value:null,approximate:false};
const video=(id:string,description:string,authorId='',authorName='')=>({id,url:'https://www.douyin.com/video/'+id,authorId,authorName,authorUrl:authorId?'https://www.douyin.com/user/'+authorId:'',title:'FDE',description,dateText:'',publishedAt:null,duration:null,likes:metric,favorites:metric,shares:metric,kind:'unknown' as const,related:true,collectedAt:new Date().toISOString(),frames:[]});
test('real search markup exposes nickname spans without any user link',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();await p.setContent('<li><div class="search-result-card"><a href="https://www.douyin.com/video/123"><div><div>FDE #测试</div><div><span><span>@</span><span>老严 AI（示例）</span></span><span>1月前</span></div></div></a></div></li>');
 const cards=parseCards(await p.evaluate(readVisibleSnapshot),'FDE');assert.equal(cards[0].authorName,'老严 AI（示例）');assert.equal(cards[0].authorUrl,'');
 const result=organizeSearchAuthors(cards);assert.equal(result.authors.length,1);assert.equal(result.authors[0].identity,'nickname');assert.equal(result.authors[0].url,'');
 }finally{await b.close();}
});
test('saved card tails recover full nicknames; mentions inside titles and truncated names never falsely merge',()=>{
 const result=organizeSearchAuthors([video('1','03:21\n804\n标题 @别人\n@相同昵称\n1月前'),video('2','标题\n@相同昵称\n2天前'),video('3','标题 @提及其他人\n2天前'),video('4','标题\n@截断…\n2天前'),video('5','标题\n@截断…\n2天前'),video('6','', 'real-a','同名'),video('7','', 'real-b','同名')]);
 assert.equal(result.authors.length,5);assert.equal(result.videos[0].authorId,result.videos[1].authorId);assert.equal(result.videos[2].authorId,'');assert.notEqual(result.videos[3].authorId,result.videos[4].authorId);assert.notEqual(result.videos[5].authorId,result.videos[6].authorId);
 assert.equal(result.authors[0].identity,'nickname');assert.equal(result.authors.at(-1)!.identity,'account');
 assert.deepEqual(organizeSearchAuthors(result.videos),result);
});
test('resume completed 50-video zero-author task repairs saved names without new browser search',async()=>{
 const root=await mkdtemp(join(tmpdir(),'author-repair-'));try{const store=new TaskStore(root),t=createTask('FDE','likes',undefined,4);t.searchDone=true;t.videos=Array.from({length:50},(_,i)=>video(String(i),'标题\n@作者'+i%8+'\n1月前'));await store.save(t);
 const forbidden=async()=>{throw Error('禁止重搜或调用模型');};const jobs=new JobManager(store,{search:forbidden} as any,{status:forbidden} as any);await jobs.start(t.id);await jobs.wait();const done=(await store.load(t.id))!;assert.equal(done.authors.length,8);assert.equal(done.status,'complete');assert.doesNotMatch(done.message,/找到0|本次搜索完成.*已读取/);
 }finally{await rm(root,{recursive:true,force:true});}
});
