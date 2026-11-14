import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JobManager} from '../src/jobs.js';
import {TaskStore} from '../src/store.js';
import {createTask} from '../src/domain.js';
import type {Collector,AnalysisEngine} from '../src/types.js';

test('all execution events survive more than six hundred updates, persisted reload and continuation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-full-history-'));try{
  let searches=0;const collector:Collector={openLogin:async()=>{},search:async(_k,_l,options)=>{searches++;for(let i=0;i<650;i++)options?.onProgress?.('执行记录-'+i);return {authors:[],videos:[],reason:'离线搜索结束',complete:true};},collectAuthor:async()=>{throw Error('unused');},inspectVideo:async v=>v,sample:async()=>[],close:async()=>{}};
  const analyzer:AnalysisEngine={configure(){},clear(){},status:()=>{throw Error('no model used');},testConnection:async()=>({ok:false,message:'unused'}),analyze:async()=>{throw Error('unused');},summarize:async()=>{throw Error('unused');}};
  const store=new TaskStore(dir),task=createTask('完整执行记录','likes',undefined,4);task.events.push({at:task.createdAt,message:'最初执行记录'});await store.save(task);
  const jobs=new JobManager(store,collector,analyzer);await jobs.start(task.id);await jobs.wait();
  const saved=(await new TaskStore(dir).load(task.id))!;
  assert.equal(saved.events[0].message,'最初执行记录');assert.deepEqual(saved.events.filter(e=>e.message.startsWith('执行记录-')).map(e=>e.message),Array.from({length:650},(_,i)=>'执行记录-'+i));
  const initialHistory=structuredClone(saved.events);await jobs.start(task.id);await jobs.wait();const resumed=(await store.load(task.id))!;assert.equal(searches,1);assert.deepEqual(resumed.events.slice(0,initialHistory.length),initialHistory);
 }finally{await rm(dir,{recursive:true,force:true});}
});
