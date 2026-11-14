import {collectionScope,taskCollectionScope} from './collection-scope.js';
import {APP_ID,APP_BUILD} from './build.js';
import {applyCandidateScores,authorAssessmentKey,sampleVideos} from './scoring.js';
import {createServer,type Server,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TaskStore} from './store.js';
import {JobManager} from './jobs.js';
import {BrowserCollector} from './browser.js';
import {Analyzer} from './analyzer.js';
import {PROVIDERS,normalizeProviderConfig,profileId,listProviderModels,type ProviderConfig} from './providers.js';
import {WindowsCredentialStore,type SavedProfile,type CredentialStore} from './credentials.js';
import {createTask,rankAuthors,selectTopVideos,taskOptions,researchOptions,DEFAULT_MODEL} from './domain.js';
import {exportTask} from './export.js';
import type {Collector,AnalysisEngine,ResearchTask,BrowserStatus} from './types.js';
class PublicError extends Error {constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new PublicError(status,message);};
function object(value:unknown,allowed:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return fail(400,'请求内容必须为JSON对象');const data=value as Record<string,unknown>;if(Object.keys(data).some(k=>!allowed.includes(k)))fail(400,'包含不支持的字段');return data;}
function text(value:unknown,name:string,max:number,optional=false):string|undefined {if(value===undefined&&optional)return; if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\0]/.test(value))return fail(400,`请填写有效的${name}`);return value.trim();}
function mode(value:unknown):'engagement'|'likes' {if(value===undefined)return 'likes';if(value!=='likes'&&value!=='engagement')return fail(400,'排名口径无效');return 'likes';}
function refresh(task:ResearchTask){
 task.selectionLocked=false;const hadSummary=task.summary!==undefined||task.summaryUsage!==undefined;
 if(task.collectionVersion===3||task.collectionVersion===4&&task.rankingRequested)applyCandidateScores(task);else{task.ranking=rankAuthors(task);task.selectedVideoIds=task.ranking.slice(0,taskOptions(task).authorCount).flatMap(a=>selectTopVideos(task,a.authorId).map(v=>v.id));}
 task.selectionLocked=true;
 if((task.collectionVersion===3||task.collectionVersion===4&&task.rankingRequested)&&task.rankingOnly!==false){const searchPending=task.collectionVersion===4&&!task.searchDone;task.status=!searchPending&&task.candidateScores?.length&&task.candidateScores.every(r=>r.compositeScore!==null)?'complete':'partial';task.message='已更新全部候选综合排名，未评分账号保留在表格末尾'+(searchPending?'；搜索尚未完成，可继续补充候选':'');}
 else{task.status='ready_analysis';task.message='已重算主页点赞排名和选片，请点击分析入选作品以处理尚未完成项';}
 if(task.collectionVersion!==3){delete task.summary;delete task.summaryUsage;}
 if(hadSummary)task.message+=task.collectionVersion===3?'；入选集合变动时旧汇总归档，新集合另行计次':'；旧汇总已失效，汇总调用预算不重置';
 task.events.push({at:new Date().toISOString(),message:task.message});
}
async function body(req:IncomingMessage):Promise<unknown>{if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))fail(415,'仅接受JSON请求');if(Number(req.headers['content-length'])>32768)fail(413,'请求内容过大');const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>32768)fail(413,'请求内容过大');chunks.push(b);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return fail(400,'JSON内容无效');}}
function send(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
export async function createApp(options:{root?:string;collector?:Collector;analyzer?:AnalysisEngine;store?:TaskStore;credentials?:CredentialStore}={}):Promise<{server:Server;jobs:JobManager;store:TaskStore;close:()=>Promise<void>;settings:()=>{configured:boolean;model:string;provider:ProviderConfig['provider'];baseURL:string;persisted:boolean;profiles:unknown[];providers:typeof PROVIDERS;error?:string}}>{
 const root=resolve(options.root??join(dirname(fileURLToPath(import.meta.url)),'..'));
 const store=options.store??new TaskStore(join(root,'data'));
 const collector=options.collector??new BrowserCollector({profileDir:join(root,'.local','browser-profile')});
 const analyzer=options.analyzer??new Analyzer();const credentials=options.credentials??new WindowsCredentialStore(join(root,'.local','openai-settings.dpapi'));let settingsError:string|undefined;
 let selected=normalizeProviderConfig({}),profiles:SavedProfile[]=[];
 try{const saved=await credentials.load();if(saved){selected=normalizeProviderConfig(saved);profiles=saved.profiles?.map(p=>({...normalizeProviderConfig(p),apiKey:p.apiKey}))??[];if(saved.apiKey&&!profiles.some(p=>profileId(p)===profileId(selected)))profiles.push({...selected,apiKey:saved.apiKey});const current=profiles.find(p=>profileId(p)===profileId(selected));if(current)analyzer.configure(current.apiKey,selected.model,selected);}}catch{settingsError='无法恢复已保存的加密设置，请重新填写并保存';}
 const currentProfile=(config:ProviderConfig)=>profiles.find(p=>profileId(p)===profileId(config));
 const settings=()=>({configured:!!currentProfile(selected),...selected,persisted:!!currentProfile(selected),profiles:profiles.map(({provider,baseURL,model})=>({provider,baseURL,model,persisted:true as const})),providers:PROVIDERS,...settingsError?{error:settingsError}:{}});
 await store.recover();const jobs=new JobManager(store,collector,analyzer),token=randomBytes(32).toString('hex');let busy=false,closing=false;
 const applySelected=()=>{const current=currentProfile(selected);if(current)analyzer.configure(current.apiKey,selected.model,selected);else analyzer.clear();};
 const taskConfig=(task:ResearchTask):ProviderConfig=>{
  if(task.analysisConfig)return normalizeProviderConfig(task.analysisConfig);
  if(!task.authors.some(a=>a.relevance||(a.relevanceCalls??0)>0))return selected;
  const openai=currentProfile(normalizeProviderConfig({})),models=[DEFAULT_MODEL,...openai?[openai.model]:[]];
  const model=models.find(model=>task.authors.some(a=>a.relevanceCacheKey===authorAssessmentKey(task.keyword,a,sampleVideos(task,a),model,taskCollectionScope(task).profileLimit)))??openai?.model??DEFAULT_MODEL;
  return normalizeProviderConfig({provider:'openai',model});
 };
 const unknownLegacyModel=(task:ResearchTask)=>{
  if(task.analysisConfig||!task.authors.some(a=>a.relevance||(a.relevanceCalls??0)>0))return false;
  const openai=currentProfile(normalizeProviderConfig({})),models=[DEFAULT_MODEL,...openai?[openai.model]:[]];
  return !models.some(model=>task.authors.some(a=>a.relevanceCacheKey===authorAssessmentKey(task.keyword,a,sampleVideos(task,a),model,taskCollectionScope(task).profileLimit)));
 };
 const startTask=async(id:string,stage:'resume'|'score'|'analyze'|'sample'='resume',vid?:string)=>{const task=await store.load(id);if(!task)fail(404,'任务不存在');if(unknownLegacyModel(task!)){task!.status='waiting_api';task!.phase='score';task!.message='原评分模型无法核实，已保留历史结果与调用次数，请新建任务重新评分。';task!.events.push({at:new Date().toISOString(),message:task!.message});await store.save(task!);return;}const config=taskConfig(task!),profile=currentProfile(config);if(profile)analyzer.configure(profile.apiKey,config.model,config);else analyzer.clear();await jobs.start(id,stage,vid,config);};
 const draftConfig=(data:Record<string,unknown>)=>{try{const provider=data.provider===undefined?selected.provider:text(data.provider,'厂商',30)!;const same=provider===selected.provider;return normalizeProviderConfig({provider:provider as ProviderConfig['provider'],baseURL:data.baseURL===undefined?(same?selected.baseURL:undefined):text(data.baseURL,'接口地址',500),model:data.model===undefined?(same?selected.model:undefined):text(data.model,'模型名称',120)});}catch{return fail(400,'厂商、接口地址或模型配置无效');}};
 const ensureIdle=()=>{if(jobs.activeId||busy)fail(409,'已有任务或浏览器操作正在运行，请先暂停');};
 const browserStatus=async():Promise<BrowserStatus>=>{
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{if(collector.getBrowserStatus)return await Promise.race([collector.getBrowserStatus(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('status timeout')),2200);})]);}
  catch{/* A page transition or an older collector must not break the status UI. */}
  finally{clearTimeout(timeout);}
  return {browser:'unknown',login:'unknown',message:'暂时无法确认浏览器和抖音登录状态，请刷新状态',checkedAt:new Date().toISOString()};
 };
 const server=createServer((req,res)=>{void handle(req,res).catch(error=>{if(res.headersSent){res.end();return;}const known=error instanceof PublicError;send(res,known?error.status:500,{error:known?error.message:'操作失败，请检查运行状态后重试'});});});
 async function handle(req:IncomingMessage,res:ServerResponse){
  res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('content-security-policy',"default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const address=server.address(),port=typeof address==='object'&&address?address.port:3210;
  const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];const host=req.headers.host??'';
  if(!hosts.includes(host))fail(403,'仅允许本机访问');
  if(req.headers.origin!==undefined&&req.headers.origin!==`http://${host}`)fail(403,'请求来源无效');
  if(closing)fail(503,'服务正在关闭');
  const url=new URL(req.url??'/',`http://${host}`);let pathname:string;try{pathname=decodeURIComponent(url.pathname);}catch{return fail(400,'路径无效');}
  const write=req.method==='POST';if(req.method!=='GET'&&!write)fail(405,'请求方法不支持');
  let data:Record<string,unknown>={};
  if(write){const supplied=req.headers['x-session-token'];if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))fail(403,'会话校验失败，请刷新页面');data=object(await body(req),['provider','baseURL','endpointConfirmed','apiKey','model','clear','keyword','mode','action','authorId','videoId','note','options','collectionScope']);}
  if(req.method==='GET'&&pathname==='/health')return send(res,200,{ok:true,app:APP_ID,build:APP_BUILD});
  if(req.method==='GET'&&pathname==='/api/bootstrap')return send(res,200,{token,build:APP_BUILD,settings:settings(),tasks:await store.list()});
  if(req.method==='GET'&&pathname==='/api/browser/status')return send(res,200,await browserStatus());
  if(write&&pathname==='/api/settings'){
   ensureIdle();busy=true;try{object(data,['apiKey','model','clear','provider','baseURL','endpointConfirmed']);
   if(data.clear!==undefined&&typeof data.clear!=='boolean')fail(400,'清除设置参数无效');
   if(data.endpointConfirmed!==undefined&&typeof data.endpointConfirmed!=='boolean')fail(400,'接口确认参数无效');
   const config=draftConfig(data),existing=currentProfile(config);
   if(data.clear!==true&&!config.model)fail(400,'请填写模型名称或推理接入点ID');
   let next:SavedProfile[];
   if(data.clear===true){if(data.apiKey!==undefined||data.model!==undefined)fail(400,'清除设置不能同时提交凭据');next=profiles.filter(p=>profileId(p)!==profileId(config));}
   else{if(config.provider==='custom'&&!existing&&data.endpointConfirmed!==true)fail(400,'请明确确认自定义接口地址后保存');const key=data.apiKey===undefined?existing?.apiKey:text(data.apiKey,'API Key',512)!;if(!key)fail(400,'首次保存此厂商及接口请填写API Key');if((config.model+config.baseURL).includes(key!))fail(400,'模型名称无效');next=[...profiles.filter(p=>profileId(p)!==profileId(config)),{...config,apiKey:key!}];}
   const previousSelected=selected,nextSelected=data.clear===true&&profileId(config)!==profileId(selected)?selected:config;
   const active=next.find(p=>profileId(p)===profileId(nextSelected));
   try{await credentials.save({...nextSelected,apiKey:active?.apiKey??'',profiles:next});}catch{fail(500,'加密保存失败，设置未更新，请检查本机Windows账户和文件访问');}
   profiles=next;selected=nextSelected;settingsError=undefined;applySelected();
   if(data.clear!==true){const waiting=(await store.list()).find(t=>t.collectionVersion===4&&t.rankingRequested&&t.status==='waiting_api'&&!unknownLegacyModel(t)&&profileId(taskConfig(t))===profileId(config)&&!!currentProfile(taskConfig(t))&&(t.analysisConfig||t.authors.some(a=>a.relevance||(a.relevanceCalls??0)>0)||profileId(previousSelected)===profileId(config)));if(waiting)await startTask(waiting.id);}
   return send(res,200,settings());}finally{busy=false;}
  }
  if(write&&pathname==='/api/settings/models'){object(data,['apiKey','model','provider','baseURL','endpointConfirmed']);ensureIdle();busy=true;try{const config=draftConfig(data),existing=currentProfile(config);if(config.provider==='custom'&&!existing&&data.endpointConfirmed!==true)fail(400,'请明确确认自定义接口地址后获取模型');const key=data.apiKey===undefined?existing?.apiKey:text(data.apiKey,'API Key',512);if(!key)fail(400,'请填写此厂商及接口的API Key');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const result=await listProviderModels(config,key!,controller.signal);return send(res,200,result);}catch{fail(400,'模型列表获取失败，请检查该接口的密钥与模型列表支持');}finally{clearTimeout(timer);}}finally{busy=false;}}
  if(write&&pathname==='/api/settings/test'){object(data,[]);ensureIdle();busy=true;try{applySelected();const result=await analyzer.testConnection();return send(res,200,{ok:result.ok,message:result.ok?'文字连接测试成功；本次测试产生API用量':'文字连接测试失败，请检查密钥、模型和网络'});}finally{busy=false;}}
  if(write&&pathname==='/api/browser/open'){object(data,[]);ensureIdle();busy=true;try{await collector.openLogin();return send(res,200,{ok:true,status:await browserStatus()});}finally{busy=false;}}
  if(write&&pathname==='/api/tasks'){object(data,['keyword','mode','options','collectionScope']);ensureIdle();let scope,collection;try{scope=researchOptions(data.options);collection=collectionScope(data.collectionScope);}catch(error){fail(400,(error as Error).message);}const task=createTask(text(data.keyword,'关键词',200)!,mode(data.mode),scope,4,collection);task.rankingRequested=true;task.profileRanking=true;busy=true;try{await store.save(task);await startTask(task.id);return send(res,202,(await jobs.get(task.id))??task);}finally{busy=false;}}
  const match=pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(action|export|frames)(?:\/(.*))?)?$/);
  if(match){const [,id,kind,file]=match;if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))fail(400,'任务ID无效');const task=(await jobs.get(id))??fail(404,'任务不存在');
   if(!kind&&req.method==='GET')return send(res,200,task);
   if(kind==='action'&&write&&!file){object(data,['action','mode','authorId','videoId','note']);const action=data.action;
    if(action==='pause'||action==='cancel'){
     if(jobs.activeId===id){jobs.stop(id,action);return send(res,200,(await jobs.get(id))??task);}
     const updated=await jobs.mutate(id,t=>{t.status=action==='cancel'?'cancelled':'paused';t.message=action==='cancel'?'任务已取消，已采集证据保留':'任务已暂停，点击继续可恢复';t.events.push({at:new Date().toISOString(),message:t.message});});
     return send(res,200,updated);
    }
    if(action==='note'){const vid=text(data.videoId,'作品ID',120)!;if(typeof data.note!=='string'||data.note.length>8000||data.note.includes('\0'))fail(400,'备注无效');if(!task.videos.some(v=>v.id===vid))fail(400,'作品不存在');return send(res,200,await jobs.mutate(id,t=>{t.videos.find(v=>v.id===vid)!.manualNote=data.note as string;}));}
    if(!['resume','score','expand','analyze','recompute','exclude','sample'].includes(String(action)))fail(400,'操作无效');
    if(['analyze','sample'].includes(String(action))&&task.collectionVersion===3&&task.rankingOnly!==false)fail(400,'当前任务只生成完整排名，不再选片或分析入选作品');
    ensureIdle();
    if(task.collectionVersion===4&&!['resume','score','exclude','recompute'].includes(String(action)))fail(400,'当前任务在搜索去重后评分排序，不扩展搜索或分析视频');
    ensureIdle();busy=true;try{
    if(action==='recompute'){const next=mode(data.mode);return send(res,200,await jobs.mutate(id,t=>{t.mode=next;refresh(t);}));}
    if(action==='exclude'){const authorId=text(data.authorId,'博主ID',120)!;if(!task.authors.some(a=>a.id===authorId))fail(400,'博主不存在');return send(res,200,await jobs.mutate(id,t=>{if(!t.excludedAuthorIds.includes(authorId))t.excludedAuthorIds.push(authorId);refresh(t);}));}
    let upgraded=false;
    if(action==='expand'&&task.collectionVersion===3)fail(400,'当前采样固定为综合排序前50条；需要更新结果请新建任务');
    if(['resume','score','expand'].includes(String(action))&&(task.collectionVersion!==4||task.limits.policy!=='raw50')){const archive='legacy-before-search50.json';await store.archiveLegacy(task,archive);const migrated=await jobs.mutate(id,t=>{const fresh=createTask(t.keyword,'likes',taskOptions(t),4);t.collectionVersion=4;t.rankingOnly=true;t.rankingRequested=true;t.profileRanking=true;t.options=fresh.options;t.createdAt=fresh.createdAt;t.cutoff=fresh.cutoff;t.limits=fresh.limits;t.videos=[];t.authors=[];t.ranking=[];t.candidateScores=[];t.selectedVideoIds=[];t.searchDone=false;t.searchCheckpoint=undefined;t.selectionLocked=false;t.totalFrames=0;t.summary=undefined;t.summaryUsage=undefined;t.summaryCalls=0;t.errors=[];t.events.push({at:new Date().toISOString(),message:'旧任务已归档；改为搜索前50条视频并去重博主，不操作筛选菜单或调用评分模型'});});Object.assign(task,migrated);upgraded=true;}
    if(action==='expand'&&task.collectionVersion!==3&&task.collectionVersion!==4)await jobs.mutate(id,t=>{t.limits.searchPerSort+=100;t.limits.maxSearchVideos+=200;t.limits.maxAuthors+=20;t.limits.profileMax+=300;t.searchDone=false;t.selectionLocked=false;for(const a of t.authors)a.cardsCollected=false;t.summary=undefined;t.summaryUsage=undefined;t.status='partial';t.message='样本范围已扩大，旧汇总失效；汇总调用预算不重置';});
    if(task.collectionVersion===4&&['resume','score'].includes(String(action)))await jobs.mutate(id,t=>{t.rankingRequested=true;t.profileRanking=true;});
    let vid:string|undefined;if(action==='sample'){vid=text(data.videoId,'作品ID',120)!;if(!task.selectedVideoIds.includes(vid))fail(400,'只允许补采已入选作品');}
    await startTask(id,action==='analyze'?'analyze':action==='sample'?'sample':action==='score'&&(task.collectionVersion===3||task.collectionVersion===4)&&!upgraded?'score':'resume',vid);return send(res,202,(await jobs.get(id))??task);
    }finally{busy=false;}
   }
   if(kind==='export'&&req.method==='GET'&&!file){const format=url.searchParams.get('format')??'md';if(format!=='md'&&format!=='csv')return fail(400,'导出格式无效');const output=exportTask(task,format);await writeFile(join(store.taskDir(id),`report.${format}`),output,'utf8');res.writeHead(200,{'content-type':format==='md'?'text/markdown; charset=utf-8':'text/csv; charset=utf-8','content-disposition':`attachment; filename="report-${id}.${format}"`});return res.end(output);}
   if(kind==='frames'&&req.method==='GET'){if(!file||!/^[a-zA-Z0-9_-]{1,160}\.jpe?g$/i.test(file))fail(400,'截图文件名无效');try{const frameRoot=await realpath(store.frameDir(id)),target=await realpath(join(frameRoot,file)),rel=relative(frameRoot,target);if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))fail(400,'截图路径无效');const info=await stat(target);if(!info.isFile()||info.size>12*1024*1024)fail(400,'截图文件无效');res.writeHead(200,{'content-type':'image/jpeg'});return res.end(await readFile(target));}catch(error){if(error instanceof PublicError)throw error;fail(404,'截图不存在');}}
  }
  if(req.method==='GET'&&['/','/index.html','/app.js','/style.css','/brand-logo.png'].includes(pathname)){const name=pathname==='/'?'index.html':pathname.slice(1);try{const bytes=await readFile(join(root,'public',name));res.writeHead(200,{'content-type':name.endsWith('.png')?'image/png':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(bytes);}catch{fail(404,'页面不存在');}}
  fail(404,'未找到请求内容');
 }
 async function bounded(work:Promise<unknown>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([work,new Promise<void>(r=>{timer=setTimeout(r,ms);})]);}finally{clearTimeout(timer);}}
 async function close(){if(closing)return;closing=true;analyzer.clear();if(jobs.activeId)jobs.stop(jobs.activeId,'pause');try{await bounded(jobs.wait(),15000);}finally{try{await bounded(collector.close(),5000);}finally{await new Promise<void>(r=>{if(!server.listening)return r();const timer=setTimeout(()=>{server.closeAllConnections();r();},2000);timer.unref();server.close(()=>{clearTimeout(timer);r();});server.closeIdleConnections();});}}}
 return {server,jobs,store,close,settings};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){const raw=process.env.PORT??'3210',port=Number(raw);if(!/^\d+$/.test(raw)||!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT必须为有效端口');const app=await createApp();app.server.listen(port,'127.0.0.1',()=>console.log(`本机调研已启动：http://127.0.0.1:${port}`));for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});}
