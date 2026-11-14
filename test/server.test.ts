import {test} from 'node:test';
import {APP_ID,APP_BUILD} from '../src/build.js';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/server.js';
import type {Collector,AnalysisEngine} from '../src/types.js';
import {createTask as createVersionedTask} from '../src/domain.js';

const createTask=(keyword:string,mode:'engagement'|'likes'='likes',options?:unknown)=>createVersionedTask(keyword,mode,options,2);
test('saving API settings continues a waiting search-ranking task without re-searching',async t=>{
 const selected=engine();let calls=0;selected.scoreAuthor=async(_keyword,_author,videos)=>{calls++;return {assessment:{profileScore:null,videos:videos.map(v=>({id:v.id,score:90,reason:'离线标题依据'})),reason:'离线测试'},cacheKey:'test',cached:false};};
 const f=await fixture(t,{...collector,search:async()=>{throw Error('不能重搜');}},selected),item=createVersionedTask('FDE','likes',undefined,4);item.rankingRequested=true;item.searchDone=true;
 const metric={raw:null,value:null,approximate:false};item.videos=[{id:'123',url:'https://www.douyin.com/video/123',authorId:'a',authorName:'作者',authorUrl:'https://www.douyin.com/user/a',title:'FDE现场落地',description:'',dateText:'',publishedAt:null,duration:null,likes:{raw:'50',value:50,approximate:false},favorites:metric,shares:metric,kind:'unknown',related:true,collectedAt:item.createdAt,frames:[]}];
 await f.store.save(item);await f.jobs.start(item.id);await f.jobs.wait();assert.equal((await f.store.load(item.id))!.status,'waiting_api');
 const r=await f.post('/api/settings',{apiKey:'fake-offline-key'});assert.equal(r.status,200);await f.jobs.wait();assert.equal((await f.store.load(item.id))!.status,'complete');assert.equal(calls,1);
});
const collector:Collector={openLogin:async()=>{},search:async()=>({videos:[],authors:[],reason:'fixture'}),collectAuthor:async()=>({videos:[],coverage:'complete',reason:'fixture'}),inspectVideo:async v=>v,sample:async()=>[],close:async()=>{}};
test('browser status is readonly with conservative fallback and open includes current status',async t=>{
 let opened=0,reads=0;
 const selected={...collector,openLogin:async()=>{opened++;},getBrowserStatus:async()=>{reads++;return {browser:'open' as const,login:'logged_out' as const,message:'请登录',checkedAt:new Date().toISOString()};}};
 const f=await fixture(t,selected);
 const status=await fetch(f.base+'/api/browser/status');assert.equal(status.status,200);assert.equal((await status.json() as any).login,'logged_out');assert.equal(opened,0);assert.equal(reads,1);
 const response=await f.post('/api/browser/open');assert.equal(response.status,200);const data=await response.json() as any;assert.equal(data.ok,true);assert.equal(data.status.login,'logged_out');assert.equal(opened,1);
 const fallback=await fixture(t);assert.equal((await (await fetch(fallback.base+'/api/browser/status')).json() as any).login,'unknown');
 const broken=await fixture(t,{...collector,getBrowserStatus:async()=>{throw Error('navigation');}});assert.equal((await (await fetch(broken.base+'/api/browser/status')).json() as any).browser,'unknown');
});
test('stalled collector status times out without blocking other API reads',async t=>{
 const f=await fixture(t,{...collector,getBrowserStatus:()=>new Promise(()=>{})});
 const start=Date.now(),pending=fetch(f.base+'/api/browser/status');
 assert.equal((await fetch(f.base+'/health')).status,200);
 const status=await pending;assert.equal(status.status,200);assert.equal((await status.json() as any).login,'unknown');assert.ok(Date.now()-start<3500);
});
function engine():AnalysisEngine{let key='',model='';return {configure:(k,m)=>{key=k;model=m;},clear:()=>{key='';model='';},status:()=>({configured:!!key,model}),testConnection:async()=>({ok:true,message:'fixture'}),analyze:async()=>{throw Error('unused');},summarize:async()=>({summary:'fixture'})};}
async function fixture(t:any,selectedCollector:Collector=collector,selectedEngine:AnalysisEngine=engine()){const root=await mkdtemp(join(tmpdir(),'dy-server-'));await mkdir(join(root,'public'));await writeFile(join(root,'public','index.html'),'<h1>本机调研</h1>');const credentials={value:undefined as {apiKey:string;model:string}|undefined,async load(){return this.value;},async save(value:{apiKey:string;model:string}){this.value=value;},async clear(){this.value=undefined;}};const app=await createApp({root,collector:selectedCollector,analyzer:selectedEngine,credentials});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const port=(app.server.address() as any).port,base=`http://127.0.0.1:${port}`;const boot=await (await fetch(base+'/api/bootstrap')).json() as any;const post=(path:string,body:any={},headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-session-token':boot.token,...headers},body:JSON.stringify(body)});t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});return {...app,root,base,post,boot,credentials};}

test('resuming a dual-search task archives its old cohort and clears its incompatible checkpoint',async t=>{
 const f=await fixture(t),old=createVersionedTask('FDE');old.limits={policy:'dual50',searchPerSort:50,maxSearchVideos:100,maxAuthors:100,profileMax:12};old.summary='双路历史';old.searchDone=false;old.searchCheckpoint={version:1,keyword:'FDE',videos:[],authors:[],lanes:{likes:{seenIds:['old'],done:true},combined:{seenIds:[],done:false}},reason:'旧断点'};await f.store.save(old);
 assert.equal((await f.post(`/api/tasks/${old.id}/action`,{action:'resume'})).status,202);await f.jobs.wait();const updated=(await f.store.load(old.id))!;assert.equal(updated.limits.policy,'raw50');assert.equal(updated.limits.maxAuthors,50);assert.equal(updated.searchCheckpoint,undefined);assert.equal(updated.summary,undefined);
 const archived=JSON.parse(await readFile(join(f.store.taskDir(old.id),'legacy-before-search50.json'),'utf8'));assert.equal(archived.summary,'双路历史');assert.deepEqual(archived.searchCheckpoint.lanes.likes.seenIds,['old']);
});

test('ranking-only tasks reject old batch-analysis actions',async t=>{
 const f=await fixture(t),item=createVersionedTask('完整排名');item.authors=[{id:'a',name:'候选',url:'https://www.douyin.com/user/a',coverage:'partial',reason:'',fetchedCount:0}];await f.store.save(item);
 for(const action of ['analyze','sample']){const response=await f.post(`/api/tasks/${item.id}/action`,{action});assert.equal(response.status,400);assert.match((await response.json() as any).error,/完整排名/);}
 const response=await f.post(`/api/tasks/${item.id}/action`,{action:'exclude',authorId:'a'});assert.equal(response.status,200);const changed=await response.json() as any;assert.equal(changed.status,'partial');assert.doesNotMatch(changed.message,/分析入选/);assert.deepEqual(changed.selectedVideoIds,[]);
});

test('task actions preserve the first execution event beyond the historical two hundred record cap',async t=>{
 const f=await fixture(t),item=createVersionedTask('full-history','likes',undefined,4);item.rankingRequested=true;item.status='paused';item.events=Array.from({length:650},(_,i)=>({at:item.createdAt,message:'历史记录-'+i}));await f.store.save(item);
 for(const action of ['pause','cancel','recompute']){const r=await f.post(`/api/tasks/${item.id}/action`,{action});assert.equal(r.status,200);const updated=(await f.store.load(item.id))!;assert.deepEqual(updated.events.slice(0,650),item.events);}
 assert.equal((await f.store.load(item.id))!.events.length,653);
});

test('new tasks validate and freeze independent search and homepage limits while old tasks remain unchanged',async t=>{
 const f=await fixture(t);const first=await f.post('/api/tasks',{keyword:'custom-scope',collectionScope:{searchLimit:100,profileLimit:30}});assert.equal(first.status,202);const created=await first.json() as any;await f.jobs.wait();
 assert.deepEqual(created.collectionScope,{searchLimit:100,profileLimit:30});assert.equal(created.limits.maxSearchVideos,100);assert.equal(created.limits.maxAuthors,100);
 for(const collectionScope of [{searchLimit:201,profileLimit:12},{searchLimit:0},{searchLimit:1.5},{profileLimit:31},{profileLimit:0},{profileLimit:'20'},'100',{unknown:1}]){const r=await f.post('/api/tasks',{keyword:'invalid',collectionScope});assert.equal(r.status,400,JSON.stringify(collectionScope));}
 assert.equal((await f.store.list()).length,1,'invalid scope must not create tasks');
 const second=await f.post('/api/tasks',{keyword:'default-scope'});assert.equal(second.status,202);const defaultTask=await second.json() as any;await f.jobs.wait();assert.deepEqual(defaultTask.collectionScope,{searchLimit:50,profileLimit:12});
 assert.deepEqual((await f.store.load(created.id))!.collectionScope,{searchLimit:100,profileLimit:30},'new defaults do not change an existing task');
});

test('recomputing an incompletely searched scoped task keeps continuation available even when known authors are scored',async t=>{
 const metric={raw:null,value:null,approximate:false};
 const f=await fixture(t),item=createVersionedTask('partial-scope','likes',undefined,4,{searchLimit:100,profileLimit:30});item.rankingRequested=true;item.profileRanking=true;item.searchDone=false;item.status='partial';
 item.authors=[{id:'a',name:'作者',url:'https://www.douyin.com/user/a',coverage:'partial',reason:'one found',fetchedCount:1,profileCollected:true,profileSampleIds:['v'],bio:'企业AI',relevance:{profileScore:90,videos:[{id:'v',score:90,reason:'企业AI'}],reason:'相关'}}];
 item.videos=[{id:'v',url:'https://www.douyin.com/video/1',authorId:'a',authorName:'作者',authorUrl:item.authors[0].url,title:'企业AI',description:'',dateText:'',publishedAt:null,duration:null,likes:{raw:'1',value:1,approximate:false},favorites:metric,shares:metric,kind:'video',related:true,collectedAt:item.createdAt,frames:[]}];await f.store.save(item);
 const r=await f.post(`/api/tasks/${item.id}/action`,{action:'recompute'});assert.equal(r.status,200);assert.equal((await r.json() as any).status,'partial');
});

test('brand PNG is served with image MIME and arbitrary files stay inaccessible',async t=>{
 const f=await fixture(t);const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');await writeFile(join(f.root,'public','brand-logo.png'),bytes);
 const response=await fetch(f.base+'/brand-logo.png');assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/^image\/png/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal((await fetch(f.base+'/other.png')).status,404);
});

test('health and bootstrap identify the running backend build',async t=>{
 const f=await fixture(t);assert.equal(f.boot.build,APP_BUILD);
 assert.deepEqual(await(await fetch(f.base+'/health')).json(),{ok:true,app:APP_ID,build:APP_BUILD});
});

test('new task persists custom scope and invalid scope receives 400; model defaults to Sol',async t=>{
 const f=await fixture(t);for(const options of [{authorCount:0},{days:'30'},{videosPerAuthor:99},{oops:1},null])assert.equal((await f.post('/api/tasks',{keyword:'FDE',options})).status,400);
 const response=await f.post('/api/tasks',{keyword:'FDE',options:{authorCount:3,videosPerAuthor:2,days:180}});assert.equal(response.status,202);const task=await response.json() as any;await f.jobs.wait();assert.equal(task.collectionVersion,4);assert.equal(task.limits.policy,'raw50');for(const action of ['analyze','sample','expand'])assert.equal((await f.post('/api/tasks/'+task.id+'/action',{action})).status,400);assert.deepEqual((await f.store.load(task.id) as any).options,{authorCount:3,videosPerAuthor:2,days:180});
 assert.equal((await f.post('/api/settings',{apiKey:'fake-only-test'})).status,200);const state=await(await fetch(f.base+'/api/bootstrap')).json() as any;assert.equal(state.settings.model,'gpt-6.1-sol');
});
test('bootstrap/static and memory-only settings, clear, sanitized errors',async t=>{const f=await fixture(t);assert.equal(f.boot.settings.configured,false);assert.match(await(await fetch(f.base+'/')).text(),/本机调研/);let r=await f.post('/api/settings',{apiKey:'secret-example',model:'image-model'});assert.equal(r.status,200);assert.ok(!(await r.text()).includes('secret-example'));const b=await(await fetch(f.base+'/api/bootstrap')).json() as any;assert.equal(b.settings.configured,true);assert.equal(b.settings.model,'image-model');assert.equal(b.settings.persisted,true);assert.equal(b.settings.provider,'openai');assert.equal(b.settings.profiles.length,1);assert.equal((await f.post('/api/settings',{apiKey:'x',model:'bad\nmodel'})).status,400);assert.equal((await f.post('/api/settings',{clear:true})).status,200);assert.equal((await(await fetch(f.base+'/api/bootstrap')).json() as any).settings.configured,false);assert.equal((await f.post('/api/settings',{extra:'secret'})).status,400);});
test('write security: token, origin, host, JSON and size checks',async t=>{const f=await fixture(t);assert.equal((await f.post('/api/browser/open',{}, {'x-session-token':''})).status,403);assert.equal((await f.post('/api/browser/open',{}, {origin:'https://evil.example'})).status,403);assert.equal(await new Promise<number>(resolve=>{const req=request(f.base+'/health',{headers:{host:'evil.example'}},r=>{r.resume();resolve(r.statusCode!);});req.end();}),403);assert.equal((await f.post('/api/browser/open',{}, {'content-type':'text/plain'})).status,415);assert.equal((await f.post('/api/tasks',{keyword:'x'.repeat(40000)})).status,413);assert.equal((await f.post('/api/browser/open',{}, {origin:f.base})).status,200);});
test('task status/actions, missing ids and safe filenames',async t=>{const f=await fixture(t);assert.equal((await f.post('/api/tasks',{keyword:'  '})).status,400);const r=await f.post('/api/tasks',{keyword:'AI'});assert.equal(r.status,202);const task=await r.json() as any;assert.ok(task.id);await f.jobs.wait();assert.equal((await fetch(f.base+'/api/tasks/'+task.id)).status,200);assert.equal((await fetch(f.base+'/api/tasks/missing')).status,404);assert.equal((await f.post('/api/tasks/missing/action',{action:'resume'})).status,404);assert.equal((await f.post('/api/tasks/'+task.id+'/action',{action:'recompute',mode:'likes'})).status,200);assert.equal((await f.post('/api/tasks/'+task.id+'/action',{action:'note',videoId:'missing',note:'hi'})).status,400);const ex=await fetch(f.base+'/api/tasks/'+task.id+'/export?format=md');assert.equal(ex.status,200);assert.match(ex.headers.get('content-disposition')!,/^attachment;/);assert.match(await readFile(join(f.store.taskDir(task.id),'report.md'),'utf8'),/AI/);assert.equal((await fetch(f.base+'/api/tasks/'+task.id+'/frames/%2e%2e%5csecret.jpg')).status,400);assert.equal((await fetch(f.base+'/api/tasks/'+task.id+'/frames/not.jpg')).status,404);assert.equal((await fetch(f.base+'/src/server.ts')).status,404);});
test('existing frame JPEG is served while non-JPEG names are rejected',async t=>{const f=await fixture(t);const task=createTask('safe');await f.store.save(task);await mkdir(f.store.frameDir(task.id),{recursive:true});await writeFile(join(f.store.frameDir(task.id),'frame.jpg'),Buffer.from([0xff,0xd8,0xff,0xd9]));assert.equal((await fetch(f.base+'/api/tasks/'+task.id+'/frames/frame.jpg')).status,200);assert.equal((await fetch(f.base+'/api/tasks/'+task.id+'/frames/task.json')).status,400);});
test('concurrent creates reserve one worker and active mutations are denied',async t=>{
 const blocked:Collector={...collector,search:async(_keyword,_limits,options)=>await new Promise((resolve,reject)=>{if(options?.signal?.aborted){reject(new Error('aborted'));return;}options?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})};
 const f=await fixture(t,blocked);const responses=await Promise.all([f.post('/api/tasks',{keyword:'one'}),f.post('/api/tasks',{keyword:'two'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]);const task=await responses.find(r=>r.status===202)!.json() as any;
 assert.equal((await f.post('/api/browser/open')).status,409);assert.equal((await f.post('/api/tasks/'+task.id+'/action',{action:'expand'})).status,409);assert.equal((await f.post('/api/tasks/'+task.id+'/action',{action:'recompute',mode:'likes'})).status,409);assert.equal((await f.post('/api/tasks/'+task.id+'/action',{action:'pause'})).status,200);await f.jobs.wait();assert.equal((await f.jobs.get(task.id))!.status,'paused');
});
test('frame symlink cannot escape evidence directory',async t=>{const f=await fixture(t);const task=createTask('safe');await f.store.save(task);await mkdir(f.store.frameDir(task.id),{recursive:true});await writeFile(join(f.root,'outside.jpg'),'private');try{await symlink(join(f.root,'outside.jpg'),join(f.store.frameDir(task.id),'escape.jpg'));}catch(e){if((e as NodeJS.ErrnoException).code==='EPERM'){t.skip('Windows file symlink privilege unavailable');return;}throw e;}assert.equal((await fetch(f.base+'/api/tasks/'+task.id+'/frames/escape.jpg')).status,400);});
test('pause and cancel persist inactive task state without interrupting another worker',async t=>{
 const blocked:Collector={...collector,search:async(_keyword,_limits,options)=>await new Promise((resolve,reject)=>{if(options?.signal?.aborted){reject(new Error('aborted'));return;}options?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})};
 const f=await fixture(t,blocked);const active=await(await f.post('/api/tasks',{keyword:'running'})).json() as any;
 for(const status of ['paused','partial','waiting_api'] as const){const saved=createTask('saved');saved.status=status;saved.summary='已有研究证据';await f.store.save(saved);await writeFile(join(f.store.taskDir(saved.id),'evidence.txt'),'preserve');
  const paused=await f.post('/api/tasks/'+saved.id+'/action',{action:'pause'});assert.equal(paused.status,200);assert.equal((await paused.json() as any).status,'paused');assert.equal((await f.store.load(saved.id))!.status,'paused');
  const cancelled=await f.post('/api/tasks/'+saved.id+'/action',{action:'cancel'});assert.equal(cancelled.status,200);assert.equal((await cancelled.json() as any).status,'cancelled');const stored=(await f.store.load(saved.id))!;assert.equal(stored.status,'cancelled');assert.equal(stored.summary,'已有研究证据');assert.equal(await readFile(join(f.store.taskDir(saved.id),'evidence.txt'),'utf8'),'preserve');assert.equal(f.jobs.activeId,active.id);
 }
 await f.post('/api/tasks/'+active.id+'/action',{action:'pause'});await f.jobs.wait();
});
test('recompute and exclude invalidate completed summary without resetting paid-call budget',async t=>{
 const f=await fixture(t);
 for(const action of ['recompute','exclude'] as const){const saved=createTask('saved');saved.status='complete';saved.summary='旧输入汇总';saved.summaryUsage={total_tokens:100};saved.summaryCalls=1;saved.authors=[{id:'author',name:'作者',url:'https://www.douyin.com/user/author',coverage:'complete',reason:'fixture',fetchedCount:0}];await f.store.save(saved);
  const response=await f.post('/api/tasks/'+saved.id+'/action',{action,...action==='recompute'?{mode:'likes'}:{authorId:'author'}});assert.equal(response.status,200);const current=await response.json() as any;assert.equal(current.status,'ready_analysis');assert.equal(current.summary,undefined);assert.equal(current.summaryUsage,undefined);assert.equal(current.summaryCalls,1);assert.match(current.message,/分析入选/);assert.ok(current.events.some((event:any)=>event.message.includes('旧汇总已失效')));assert.equal(f.jobs.activeId,undefined);const persisted=(await f.store.load(saved.id))!;assert.equal(persisted.summary,undefined);assert.equal(persisted.summaryCalls,1);
 }
});

test('legacy expansion archives prior evidence and rebuilds fixed raw50 search without expanding bounds',async t=>{
 const f=await fixture(t);const item=createTask('FDE');item.status='complete';item.summary='old result';item.summaryUsage={total_tokens:1};item.summaryCalls=1;await f.store.save(item);
 assert.equal((await f.post(`/api/tasks/${item.id}/action`,{action:'expand'})).status,202);await f.jobs.wait();const after=await f.store.load(item.id);
 assert.equal(after!.summary,undefined);assert.equal(after!.summaryUsage,undefined);assert.equal(after!.summaryCalls,0);assert.equal(after!.limits.searchPerSort,50);assert.equal(after!.collectionVersion,4);const archive=JSON.parse(await readFile(join(f.store.taskDir(item.id),'legacy-before-search50.json'),'utf8'));assert.equal(archive.summary,'old result');assert.equal(archive.summaryCalls,1);assert.equal((await f.post(`/api/tasks/${item.id}/action`,{action:'expand'})).status,400);
});

test('saved credentials restore after server recreation, blank key updates model, and clear removes saved configuration',async t=>{
 const f=await fixture(t);assert.equal((await f.post('/api/settings',{apiKey:'fake-persisted-only',model:'gpt-6.1-sol'})).status,200);assert.equal((await f.post('/api/settings',{model:'gpt-5.4'})).status,200);assert.equal(f.credentials.value!.apiKey,'fake-persisted-only');
 await f.close();const restored=await createApp({root:f.root,collector,analyzer:engine(),credentials:f.credentials});t.after(()=>restored.close());assert.equal((restored as any).settings().configured,true);assert.equal((restored as any).settings().model,'gpt-5.4');await f.credentials.clear();
});
test('async encrypted settings save cannot race a new paid task start',async t=>{
 const f=await fixture(t);let entered:()=>void=()=>{},release:()=>void=()=>{};const waiting=new Promise<void>(r=>{entered=r;});f.credentials.save=async value=>{entered();await new Promise<void>(r=>{release=r;});f.credentials.value=value;};
 const saving=f.post('/api/settings',{apiKey:'fake-only-test'});await waiting;let response:Response;try{response=await f.post('/api/tasks',{keyword:'FDE'});}finally{release();}assert.equal((await saving).status,200);assert.equal(response!.status,409);
});

test('profiles isolate credentials and clearing selected profile preserves other providers',async t=>{
 const f=await fixture(t);
 assert.equal((await f.post('/api/settings',{apiKey:'fake-openai-profile',model:'gpt-6.1-sol'})).status,200);
 assert.equal((await f.post('/api/settings',{provider:'deepseek'})).status,400);
 assert.equal((await f.post('/api/settings',{provider:'deepseek',apiKey:'fake-deepseek-profile',model:'deepseek-chat'})).status,200);
 let state=(await (await fetch(f.base+'/api/bootstrap')).json() as any).settings;
 assert.equal(state.provider,'deepseek');assert.equal(state.profiles.length,2);assert.ok(!JSON.stringify(state).includes('fake-'));
 assert.equal((await f.post('/api/settings',{provider:'openai',model:'gpt-5.4'})).status,200);
 assert.equal(f.credentials.value!.apiKey,'fake-openai-profile');
 assert.equal((await f.post('/api/settings',{clear:true})).status,200);
 state=(await (await fetch(f.base+'/api/bootstrap')).json() as any).settings;
 assert.equal(state.configured,false);assert.equal(state.profiles.length,1);assert.equal(state.profiles[0].provider,'deepseek');
});
test('custom endpoint confirmation and model draft do not save or invoke generation',async t=>{
 const f=await fixture(t);assert.equal((await f.post('/api/settings',{provider:'custom',baseURL:'https://models.example/v1',model:'fixture-model',apiKey:'fake-custom'})).status,400);
 assert.equal((await f.post('/api/settings',{provider:'custom',baseURL:'https://models.example/v1',model:'fixture-model',apiKey:'fake-custom',endpointConfirmed:true})).status,200);
 assert.equal((await f.post('/api/settings',{provider:'custom',baseURL:'https://other.example/v1',endpointConfirmed:true})).status,400);
 const before=JSON.stringify(f.credentials.value),reply=await f.post('/api/settings/models',{provider:'deepseek'});assert.equal(reply.status,400);assert.equal(JSON.stringify(f.credentials.value),before);
});

test('resumed scoring uses bound provider key and original model while selected settings stay independent',async t=>{
 let key='',model='',provider='';const calls:{key:string;model:string;provider:string}[]=[];const selected=engine();selected.configure=(k,m,c)=>{key=k;model=m;provider=c?.provider??'openai';};selected.status=()=>({configured:!!key,model});selected.clear=()=>{key='';model='';};selected.scoreAuthor=async()=>{calls.push({key,model,provider});throw Error('offline failure');};
 const f=await fixture(t,{...collector,collectAuthor:async()=>({videos:item.videos,coverage:'complete',reason:'fixture'})},selected);await f.post('/api/settings',{provider:'deepseek',apiKey:'fake-bound-deepseek',model:'deepseek-chat'});
 const item=createVersionedTask('FDE','likes',undefined,4);item.rankingRequested=true;item.searchDone=true;const metric={raw:null,value:null,approximate:false};item.videos=[{id:'123',url:'https://www.douyin.com/video/123',authorId:'a',authorName:'作者',authorUrl:'https://www.douyin.com/user/a',title:'FDE',description:'',dateText:'',publishedAt:null,duration:null,likes:{raw:'50',value:50,approximate:false},favorites:metric,shares:metric,kind:'unknown',related:true,collectedAt:item.createdAt,frames:[]}];await f.store.save(item);
 assert.equal((await f.post(`/api/tasks/${item.id}/action`,{action:'resume'})).status,202);await f.jobs.wait();let task=(await f.store.load(item.id))!;assert.equal(task.analysisConfig?.provider,'deepseek');assert.equal(calls.length,1);
 await f.post('/api/settings',{provider:'deepseek',model:'deepseek-reasoner'});await f.post('/api/settings',{provider:'openai',apiKey:'fake-new-default',model:'gpt-5.4'});
 assert.equal((await f.post(`/api/tasks/${item.id}/action`,{action:'score'})).status,202);await f.jobs.wait();assert.deepEqual(calls[1],{key:'fake-bound-deepseek',model:'deepseek-chat',provider:'deepseek'});
 assert.equal((await (await fetch(f.base+'/api/bootstrap')).json() as any).settings.provider,'openai');
 await f.post('/api/settings',{provider:'deepseek',clear:true});
 assert.equal((await f.post(`/api/tasks/${item.id}/action`,{action:'score'})).status,202);await f.jobs.wait();task=(await f.store.load(item.id))!;assert.equal(task.status,'waiting_api');assert.equal(calls.length,2);assert.equal(task.authors[0].relevanceCalls,2);
 await f.post('/api/settings',{provider:'openai',model:'gpt-6.1-sol'});await f.jobs.wait();assert.equal((await f.store.load(item.id))!.status,'waiting_api');assert.equal(calls.length,2);
});

test('clearing an inactive draft profile keeps selected default and unrelated switch does not auto-run unbound waiting task',async t=>{
 const f=await fixture(t);await f.post('/api/settings',{apiKey:'fake-active-openai'});await f.post('/api/settings',{provider:'deepseek',apiKey:'fake-inactive-deepseek',model:'deepseek-chat'});await f.post('/api/settings',{provider:'openai'});
 await f.post('/api/settings',{provider:'deepseek',clear:true});let state=(await (await fetch(f.base+'/api/bootstrap')).json() as any).settings;assert.equal(state.provider,'openai');assert.equal(state.configured,true);
 const item=createVersionedTask('waiting','likes',undefined,4);item.status='waiting_api';item.rankingRequested=true;await f.store.save(item);
 await f.post('/api/settings',{provider:'deepseek',apiKey:'fake-new-deepseek',model:'deepseek-chat'});await f.jobs.wait();assert.equal((await f.store.load(item.id))!.status,'waiting_api');
});

test('unrecoverable legacy model preserves old assessments and budget without paying or guessing a provider',async t=>{
 let calls=0;const selected=engine();selected.scoreAuthor=async()=>{calls++;throw Error('should not pay');};const f=await fixture(t,collector,selected);await f.post('/api/settings',{apiKey:'fake-default'});
 const item=createVersionedTask('legacy','likes',undefined,4);item.searchDone=true;item.rankingRequested=true;item.authors=[{id:'a',name:'作者',url:'https://www.douyin.com/user/a',coverage:'complete',reason:'saved',fetchedCount:1,relevanceCalls:1,relevanceCacheKey:'unrecoverable-old-hash',relevance:{profileScore:90,videos:[],reason:'历史'}}];item.events=Array.from({length:650},(_,i)=>({at:item.createdAt,message:'原始历史-'+i}));await f.store.save(item);
 await f.post(`/api/tasks/${item.id}/action`,{action:'score'});await f.jobs.wait();const task=(await f.store.load(item.id))!;assert.equal(task.status,'waiting_api');assert.match(task.message,/原评分模型无法核实/);assert.equal(task.events.length,651);assert.equal(task.events[0].message,'原始历史-0');assert.equal(task.authors[0].relevanceCalls,1);assert.equal(task.authors[0].relevance?.profileScore,90);assert.equal(task.analysisConfig,undefined);assert.equal(calls,0);
 await f.post('/api/settings',{model:'gpt-5.4'});await f.jobs.wait();assert.equal((await f.store.load(item.id))!.message,task.message);assert.equal(calls,0);
});
