import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTask,parseMetric} from '../src/domain.js';
import {JobManager} from '../src/jobs.js';
import {TaskStore} from '../src/store.js';
import type {Collector,AnalysisEngine,SearchCheckpoint,Video} from '../src/types.js';

test('partial search is saved before interruption and supplied on resume without losing authors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dy-search-checkpoint-'));
 try{
  const store=new TaskStore(root),task=createTask('FDE');await store.save(task);
  const video:Video={id:'v1',url:'https://www.douyin.com/video/v1',authorId:'a',authorName:'作者',authorUrl:'https://www.douyin.com/user/a',title:'FDE工具',description:'',dateText:'',publishedAt:null,duration:null,likes:parseMetric('10'),favorites:parseMetric(null),shares:parseMetric(null),kind:'video',related:true,collectedAt:new Date().toISOString(),frames:[]};
  const author={id:'a',name:'作者',url:video.authorUrl,coverage:'partial' as const,reason:'候选',fetchedCount:0,sourceSorts:['likes']};
  const saved:SearchCheckpoint={version:1,keyword:'FDE',videos:[video],authors:[author],lanes:{likes:{seenIds:['v1'],done:true},combined:{seenIds:[],done:false}},reason:'点赞路已保存'};
  let calls=0;
  const collector:Collector={openLogin:async()=>{},close:async()=>{},sample:async()=>[],inspectVideo:async v=>v,collectAuthor:async()=>({videos:[video],coverage:'partial',reason:'样本',profile:{name:'作者',bio:'AI工具'}}),search:async(_k,_l,opts)=>{
   if(++calls===1){assert.ok(opts?.onSearchCheckpoint);await opts.onSearchCheckpoint(saved);const disk=(await store.load(task.id))!;assert.equal(disk.authors.length,1);assert.equal(disk.videos.length,1);assert.deepEqual(disk.searchCheckpoint,saved);throw Error('等待本人操作：请重新登录');}
   assert.deepEqual(opts?.searchCheckpoint,saved);return {videos:[video],authors:[{...author,sourceSorts:['likes','combined']}],reason:'双路完成'};
  }};
  const analyzer:AnalysisEngine={configure(){},clear(){},status:()=>({configured:false,model:''}),testConnection:async()=>({ok:false,message:'未配置'}),analyze:async()=>{throw Error('禁止模型调用');},summarize:async()=>{throw Error('禁止模型调用');}};
  const jobs=new JobManager(store,collector,analyzer);await jobs.start(task.id);await jobs.wait();let out=(await store.load(task.id))!;
  assert.equal(out.status,'waiting_user');assert.equal(out.searchDone,false);assert.equal(out.authors.length,1);
  await jobs.start(task.id);await jobs.wait();out=(await store.load(task.id))!;
  assert.equal(out.searchDone,true);assert.equal(out.searchCheckpoint,undefined);assert.equal(out.authors.length,1);assert.deepEqual(out.authors[0].sourceSorts,['likes','combined']);assert.equal(out.status,'waiting_api');assert.equal(calls,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
