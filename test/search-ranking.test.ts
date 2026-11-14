import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createTask} from '../src/domain.js';import {TaskStore} from '../src/store.js';import {JobManager} from '../src/jobs.js';import {exportTask} from '../src/export.js';
test('search dedup automatically continues scoring saved authors; keeps scores and no repeated browser or paid calls on resume',async()=>{
 const root=await mkdtemp(join(tmpdir(),'search-ranking-'));try{
  const store=new TaskStore(root),t=createTask('FDE','likes',undefined,4);t.rankingRequested=true;t.searchDone=true;
  const metric={raw:null,value:null,approximate:false};t.videos=[['1','@相近主题',10],['2','@泛AI',100]].map(([id,name,likes])=>({id:String(id),url:'https://www.douyin.com/video/'+id,authorId:'',authorName:'',authorUrl:'',title:'示例'+id,description:'标题\n'+name+'\n1月前',dateText:'1月前',publishedAt:null,duration:null,likes:{raw:String(likes),value:Number(likes),approximate:false},favorites:metric,shares:metric,kind:'unknown',related:true,collectedAt:t.createdAt,frames:[]})) as any;
  let configured=false,calls=0;const forbidden=async()=>{throw Error('不能重新搜索、采主页或打开视频');};
  const engine:any={status:()=>({configured,model:'offline-test'}),scoreAuthor:async(_k:any,_a:any,v:any[])=>{calls++;return {assessment:{profileScore:null,videos:v.map(v=>({id:v.id,score:v.id==='1'?95:10,reason:'对应标题'})),reason:'离线模拟依据'},cacheKey:'test',cached:false};}};
  const jobs=new JobManager(store,{search:forbidden,collectAuthor:forbidden,inspectVideo:forbidden} as any,engine);await store.save(t);await jobs.start(t.id);await jobs.wait();
  let done=(await store.load(t.id))!;assert.equal(done.status,'waiting_api');assert.equal(done.phase,'score');assert.equal(done.progress?.completed,0);assert.equal(done.progress?.total,2);assert.equal(done.authors.length,2);assert.equal(done.candidateScores?.length,2);assert.equal(calls,0);
  configured=true;await jobs.start(t.id);await jobs.wait();done=(await store.load(t.id))!;assert.equal(done.status,'complete');assert.equal(done.phase,'rank');assert.equal(calls,2);assert.equal(done.candidateScores![0].authorId,'nickname:'+encodeURIComponent('相近主题'));assert.ok(done.candidateScores![0].compositeScore!>done.candidateScores![1].compositeScore!);
  assert.match(done.candidateScores![0].warnings.join(),/搜索/);assert.match(exportTask(done,'md'),/综合分/);assert.match(exportTask(done,'csv'),/内容相关度分/);
  await jobs.start(t.id);await jobs.wait();assert.equal(calls,2);assert.equal((await store.load(t.id))!.authors[0].relevanceCalls,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
