import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {JobManager} from '../src/jobs.js';import {TaskStore} from '../src/store.js';import {createTask as createVersionedTask,parseMetric} from '../src/domain.js';import type {Collector,Video,AnalysisEngine} from '../src/types.js';

const createTask=(keyword:string,mode:'engagement'|'likes'='likes',options?:unknown)=>createVersionedTask(keyword,mode,options,2);
const makeVideo=(id:string,related=true):Video=>({id,url:'https://www.douyin.com/video/'+id,authorId:'a',authorName:'作者',authorUrl:'https://www.douyin.com/user/a',title:related?'FDE观点':'其他主题',description:'',dateText:'今天',publishedAt:new Date(Date.now()-1000).toISOString(),duration:100,likes:parseMetric(related?'10':'99'),favorites:parseMetric('3'),shares:parseMetric('2'),kind:'video',related,collectedAt:new Date().toISOString(),frames:[]});
const noModel:AnalysisEngine={configure(){},clear(){},status:()=>({configured:false,model:''}),async testConnection(){return {ok:false,message:'未配置'};},async analyze(){throw Error('must not call');},async summarize(){throw Error('must not call');}};
test('hundreds of profile cards rank with zero detail visits; explicit analysis only opens frozen top two',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-card-first-'));try{
 const cards=Array.from({length:200},(_,i)=>({...makeVideo(String(i)),kind:'unknown' as const,publishedAt:null,likes:parseMetric(String(i+1)),favorites:parseMetric(null),shares:parseMetric(null),width:undefined,height:undefined}));
 const a={id:'a',name:'作者',url:cards[0].authorUrl,coverage:'partial' as const,reason:'主页卡片样本',fetchedCount:0};const details:string[]=[],samples:string[]=[];let profiles=0,models=0;
 const claim={value:'仅截图可见',evidence:[],confidence:'low' as const,explanation:'模拟'};const analysis={...Object.fromEntries(['theme','audience','hook','structure','orientation','person','mainVisual','layout','source','takeaways'].map(k=>[k,claim])),needsMoreFrames:false,limitations:[]} as any;
 const model:AnalysisEngine={...noModel,status:()=>({configured:true,model:'fake'}),analyze:async()=>{models++;return {analysis,cached:false};},summarize:async()=>({summary:'模拟汇总'})};
 const c:Collector={openLogin:async()=>{},search:async()=>({videos:[cards[0]],authors:[a],reason:'cards'}),collectAuthor:async()=>{profiles++;return {videos:cards,coverage:'partial',reason:'预算内卡片'};},inspectVideo:async v=>{details.push(v.id);return {...v,kind:'video',publishedAt:null,duration:60,width:720,height:1280};},sample:async v=>{samples.push(v.id);return [{id:v.id+'f',file:v.id+'.jpg',targetTime:3,actualTime:3,width:720,height:1280}];},close:async()=>{}};
 const s=new TaskStore(dir),t=createTask('FDE','engagement',{authorCount:1,videosPerAuthor:2,days:90});await s.save(t);const j=new JobManager(s,c,model);await j.start(t.id);await j.wait();let result=(await s.load(t.id))!;
 assert.equal(details.length,0);assert.equal(samples.length,0);assert.equal(models,0);assert.equal(result.status,'ready_analysis');assert.equal(result.mode,'likes');assert.deepEqual(result.selectedVideoIds,['199','198']);assert.ok(result.ranking[0].reasons.some(x=>/日期/.test(x)));
 await j.start(t.id);await j.wait();assert.equal(profiles,1);assert.equal(details.length,0);
 await j.start(t.id,'analyze');await j.wait();result=(await s.load(t.id))!;assert.deepEqual(details,['199','198']);assert.deepEqual(samples,['199','198']);assert.equal(models,2);assert.deepEqual(result.selectedVideoIds,['199','198']);assert.equal(result.ranking[0].score,990);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('legacy interrupted metrics task reuses collected cards and migrates to ranking without detail calls',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-legacy-cards-'));try{const s=new TaskStore(dir),t=createTask('FDE','engagement');t.collectionVersion=undefined;t.searchDone=true;t.videos=[{...makeVideo('1'),publishedAt:null,kind:'unknown'}];t.authors=[{id:'a',name:'作者',url:t.videos[0].authorUrl,coverage:'partial',reason:'旧卡片',fetchedCount:1}];t.summary='旧汇总';t.summaryCalls=1;
 const c:Collector={openLogin:async()=>{},search:async()=>{throw Error('must reuse search');},collectAuthor:async()=>{throw Error('must reuse profile');},inspectVideo:async()=>{throw Error('must not inspect');},sample:async()=>{throw Error('must not sample');},close:async()=>{}};
 await s.save(t);const j=new JobManager(s,c,noModel);await j.start(t.id);await j.wait();const out=(await s.load(t.id))!;assert.equal(out.status,'ready_analysis');assert.equal(out.mode,'likes');assert.deepEqual(out.selectedVideoIds,['1']);assert.equal(out.summary,undefined);assert.equal(out.summaryCalls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('profile missing fields cannot erase known search dates/likes in ranking snapshot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-card-merge-'));try{const old={...makeVideo('old'),publishedAt:'2020-01-01T00:00:00Z',likes:parseMetric('500')},recent={...makeVideo('recent'),likes:parseMetric('55')};const a={id:'a',name:'作者',url:old.authorUrl,coverage:'partial' as const,reason:'',fetchedCount:0};
 const c:Collector={openLogin:async()=>{},search:async()=>({videos:[old,recent],authors:[a],reason:'cards'}),collectAuthor:async()=>({videos:[{...old,publishedAt:null,dateText:''},{...recent,publishedAt:null,dateText:'',likes:parseMetric(null)}],coverage:'complete',reason:'end'}),inspectVideo:async()=>{throw Error('no details');},sample:async()=>{throw Error('no sampling');},close:async()=>{}};
 const t=createTask('FDE'),s=new TaskStore(dir);await s.save(t);const j=new JobManager(s,c,noModel);await j.start(t.id);await j.wait();const out=(await s.load(t.id))!;assert.deepEqual(out.selectedVideoIds,['recent']);assert.equal(out.ranking[0].score,55);assert.equal(out.videos.find(v=>v.id==='old')!.rankingSnapshot!.publishedAt,old.publishedAt);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('selected old work is skipped after inspection without opening replacement cards or changing frozen ranking',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-no-backfill-'));try{const s=new TaskStore(dir),t=createTask('FDE');t.selectionLocked=true;t.searchDone=true;t.selectedVideoIds=['1','2'];t.videos=['1','2','3'].map(id=>({...makeVideo(id),publishedAt:null,kind:'unknown' as const}));const opened:string[]=[],sampled:string[]=[];
 const c:Collector={openLogin:async()=>{},search:async()=>{throw Error('no search');},collectAuthor:async()=>{throw Error('no profile');},inspectVideo:async v=>{opened.push(v.id);return {...v,kind:'video',publishedAt:v.id==='1'?'2020-01-01T00:00:00Z':null,duration:30,width:720,height:1280};},sample:async v=>{sampled.push(v.id);return [{id:v.id+'f',file:v.id+'.jpg',targetTime:3,actualTime:3,width:720,height:1280}];},close:async()=>{}};
 await s.save(t);const j=new JobManager(s,c,noModel);await j.start(t.id,'analyze');await j.wait();const out=(await s.load(t.id))!;assert.deepEqual(opened,['1','2']);assert.deepEqual(sampled,['2']);assert.deepEqual(out.selectedVideoIds,['1','2']);assert.equal(out.videos[0].analysisStatus,'skipped');assert.match(out.videos[0].analysisError!,/不自动/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('live counters persist and stop interrupts a browser boundary that does not itself observe AbortSignal',{timeout:3000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-live-stop-'));let release:()=>void=()=>{};let j:JobManager|undefined;
 try{const s=new TaskStore(dir),t=createTask('FDE');await s.save(t);let entered:()=>void=()=>{};const started=new Promise<void>(r=>{entered=r;});let options:any;let closes=0,profiles=0;
 const c:Collector={openLogin:async()=>{},search:async(_k,_l,o)=>{options=o;entered();await new Promise<void>(r=>{release=r;});return {videos:[],authors:[],reason:'test'};},collectAuthor:async()=>{profiles++;return {videos:[],coverage:'complete',reason:'end'};},inspectVideo:async v=>v,sample:async()=>[],close:async()=>{closes++;release();}};
 j=new JobManager(s,c,noModel);await j.start(t.id);await started;options.onProgress('综合搜索已找到7条',{completed:7,unit:'条候选作品'});assert.equal(((await s.load(t.id)) as any).progress.completed,7);assert.ok((await j.get(t.id))!.updatedAt);j.stop(t.id,'cancel');assert.equal((await j.get(t.id))!.status,'stopping');assert.equal(options.signal.aborted,true);await j.wait();assert.equal(closes,1);assert.equal(profiles,0);assert.equal((await s.load(t.id))!.status,'cancelled');
 }finally{release();await j?.wait();await rm(dir,{recursive:true,force:true});}
});
test('stop racing final checkpoint must end cancelled instead of leaving stopping without a worker',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-final-stop-'));let release:()=>void=()=>{};try{
 const s=new TaskStore(dir),original=s.save.bind(s);let entered:()=>void=()=>{},gated=false;const reached=new Promise<void>(r=>{entered=r;});
 s.save=async task=>{if(task.status==='partial'&&!gated){gated=true;entered();await new Promise<void>(r=>{release=r;});}return original(task);};
 const c:Collector={openLogin:async()=>{},search:async()=>({videos:[],authors:[],reason:'fixture'}),collectAuthor:async()=>({videos:[],coverage:'complete',reason:'fixture'}),inspectVideo:async v=>v,sample:async()=>[],close:async()=>{}};
 const t=createTask('FDE');await s.save(t);const j=new JobManager(s,c,noModel);await j.start(t.id);await reached;j.stop(t.id,'cancel');release();await j.wait();assert.equal(j.activeId,undefined);assert.equal((await s.load(t.id))!.status,'cancelled');
 }finally{release();await rm(dir,{recursive:true,force:true});}
});
test('custom six authors and nine works survive resume with frame budget above old 250 cap',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-scope-'));try{
 const authors=Array.from({length:6},(_,i)=>({id:'a'+i,name:'作者'+i,url:'https://www.douyin.com/user/a'+i,coverage:'complete' as const,reason:'end',fetchedCount:9}));
 const videos=authors.flatMap(a=>Array.from({length:9},(_,i)=>({...makeVideo(a.id+'-'+i),authorId:a.id,authorName:a.name,authorUrl:a.url,width:1280,height:720})));let sampleCalls=0;
 const c:Collector={openLogin:async()=>{},search:async()=>({authors,videos,reason:'fixture'}),collectAuthor:async a=>({videos:videos.filter(v=>v.authorId===a.id),coverage:'complete',reason:'end'}),inspectVideo:async v=>v,sample:async v=>{sampleCalls++;return [1,2,3,4,5].map(n=>({id:v.id+'-'+n,file:v.id+'-'+n+'.jpg',targetTime:n,actualTime:n,width:100,height:100}));},close:async()=>{}};
 const t=(createTask as any)('FDE','engagement',{authorCount:6,videosPerAuthor:9,days:180}),s=new TaskStore(dir);await s.save(t);const j=new JobManager(s,c,noModel);await j.start(t.id);await j.wait();assert.equal((await s.load(t.id))!.totalFrames,0);await j.start(t.id,'analyze');await j.wait();const out=(await s.load(t.id))!;assert.equal(out.selectedVideoIds.length,54);assert.equal(out.totalFrames,270);assert.equal(sampleCalls,54);await j.start(t.id);await j.wait();assert.equal(sampleCalls,54);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('job keeps account-wide top works, persists frames and waits for API; resume skips completed frames',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-job-'));try{let sampleCalls=0;const vids=[makeVideo('1'),makeVideo('2',false)];const a={id:'a',name:'作者',url:vids[0].authorUrl,coverage:'complete' as const,reason:'全部读取',fetchedCount:2};
 const c:Collector={async openLogin(){},async search(){return {videos:[vids[0]],authors:[a],reason:'sample'};},async collectAuthor(){return {videos:vids,coverage:'complete',reason:'end'};},async inspectVideo(v){return v;},async sample(v){sampleCalls++;return [0,1,2].map(t=>({id:v.id+'-'+t,file:v.id+'-'+t+'.jpg',targetTime:t,actualTime:t,width:100,height:100}));},async close(){}};
 const s=new TaskStore(dir);const t=createTask('FDE');await s.save(t);const j=new JobManager(s,c,noModel);await j.start(t.id);await j.wait();assert.equal((await s.load(t.id))!.status,'ready_analysis');assert.equal(sampleCalls,0);await j.start(t.id,'analyze');await j.wait();let out=(await s.load(t.id))!;
 assert.equal(out.status,'waiting_api');assert.deepEqual(out.selectedVideoIds,['2','1']);assert.equal(out.totalFrames,6);assert.equal(sampleCalls,2);
 await j.start(t.id);const running=await j.get(t.id);if(j.activeId)assert.notEqual(running!.status,'waiting_api');await j.wait();assert.equal(sampleCalls,2);assert.equal((await s.load(t.id))!.status,'ready_analysis');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('failed bounded summary stays partial, with no silent additional paid request on resume',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-summary-'));try{const s=new TaskStore(dir);const t=createTask('FDE');const v=makeVideo('1');v.frames=[{id:'f',file:'f.jpg',targetTime:1,actualTime:1,width:10,height:10}];t.videos=[v];t.authors=[{id:'a',name:'作者',url:v.authorUrl,coverage:'complete',reason:'end',fetchedCount:1}];t.searchDone=true;
 const claim={value:'unknown',evidence:[],confidence:'low' as const,explanation:'无充分证据'};const analysis=Object.fromEntries(['theme','audience','hook','structure','orientation','person','mainVisual','layout','source','takeaways'].map(k=>[k,claim]));Object.assign(analysis,{needsMoreFrames:false,limitations:[]});let summaryCalls=0;
 const model:AnalysisEngine={...noModel,status:()=>({configured:true,model:'fake'}),async analyze(){return {analysis:analysis as any,cached:false};},async summarize(){summaryCalls++;throw Error('汇总失败');}};
 const c:Collector={async openLogin(){},async search(){throw Error('no');},async collectAuthor(){throw Error('no');},async inspectVideo(v){return v;},async sample(){return [];},async close(){}};
 await s.save(t);const j=new JobManager(s,c,model);await j.start(t.id,'analyze');await j.wait();assert.equal((await s.load(t.id))!.status,'partial');assert.equal(summaryCalls,1);await j.start(t.id,'analyze');await j.wait();assert.equal(summaryCalls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('cancel persists evidence, interrupts boundary and never reports completion or starts another task',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-cancel-'));try{const s=new TaskStore(dir);const t=createTask('FDE');await s.save(t);
 const c:Collector={async openLogin(){},async search(_k,_l,o){await new Promise<void>((resolve,reject)=>{o?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});setTimeout(resolve,200);});return {videos:[],authors:[],reason:'empty'};},async collectAuthor(){throw Error('no');},async inspectVideo(v){return v;},async sample(){return [];},async close(){}};
 const j=new JobManager(s,c,noModel);await j.start(t.id);j.stop(t.id,'cancel');await j.wait();assert.equal((await s.load(t.id))!.status,'cancelled');assert.equal(j.activeId,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
