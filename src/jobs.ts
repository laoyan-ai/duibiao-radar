import {taskCollectionScope} from './collection-scope.js';
import {normalizeProviderConfig,type ProviderConfig} from './providers.js';
import {organizeSearchAuthors} from './search-authors.js';
import {applyCandidateScores,sampleVideos,authorAssessmentKey,assessmentInput,validateAssessment} from './scoring.js';
import type {Collector,AnalysisEngine,ResearchTask,Video,TaskProgress,OperationOptions} from './types.js';import {TaskStore} from './store.js';
import {rankAuthors,selectTopVideos,isInWindow,samplingTimes,accountSelectionReasons,taskOptions,frameBudget} from './domain.js';
export class JobManager {
 private runConfig?:ProviderConfig;
 private active?:{task:ResearchTask;controller:AbortController;stop?:'pause'|'cancel';promise:Promise<void>;interrupt?:Promise<void>;lastProgressSave:number};
 constructor(public store:TaskStore,public collector:Collector,public analyzer:AnalysisEngine){}
 get activeId():string|undefined{return this.active?.task.id;}
 async get(id:string):Promise<ResearchTask|undefined>{return this.active?.task.id===id?this.active.task:this.store.load(id);}
 async mutate(id:string,callback:(task:ResearchTask)=>void):Promise<ResearchTask>{const t=await this.get(id);if(!t)throw new Error('任务不存在');callback(t);await this.store.save(t);return t;}
 async start(id:string,stage:'resume'|'score'|'analyze'|'sample'='resume',videoId?:string,config?:ProviderConfig):Promise<void>{
  if(this.active)throw new Error('另一个采集任务正在运行');const task=await this.store.load(id);if(!task)throw new Error('任务不存在');if(this.active)throw new Error('另一个采集任务正在运行');
  if(stage==='sample'&&(!task.videos.some(v=>v.id===videoId)||!task.selectedVideoIds.includes(videoId!)))throw new Error('作品不存在');
  if(task.collectionVersion!==2&&task.collectionVersion!==3&&task.collectionVersion!==4){for(const a of task.authors)if(a.fetchedCount>0)a.cardsCollected=true;task.collectionVersion=2;task.selectionLocked=false;task.summary=undefined;task.summaryUsage=undefined;this.event(task,'已切换主页卡片排名：不再逐条打开候选详情，保留旧数据');}if(task.mode!=='likes'){task.mode='likes';task.selectionLocked=false;task.summary=undefined;task.summaryUsage=undefined;this.event(task,'按本人新要求统一仅点赞，收藏/转发不再触发详情补查');}for(const v of task.videos)v.rankingSnapshot??=this.snapshot(v);
  this.runConfig=config??task.analysisConfig;
  task.runStartedAt=new Date().toISOString();task.progress=undefined;
  task.status=stage==='analyze'||stage==='score'?'analyzing':stage==='sample'?'sampling':'collecting';task.message='任务已开始，正在恢复进度';
  const active={task,controller:new AbortController(),stop:undefined as 'pause'|'cancel'|undefined,promise:Promise.resolve(),interrupt:undefined as Promise<void>|undefined,lastProgressSave:0};this.active=active;
  active.promise=this.execute(task,stage,videoId).catch(async e=>{
   const message=publicError(e);
   task.status=active.stop==='cancel'?'cancelled':active.stop==='pause'?'paused':blocking(message)?'waiting_user':'failed';
   task.message=active.stop==='cancel'?'任务已取消，已采集证据保留':active.stop==='pause'?'任务已暂停，点击继续可恢复':message;
   this.event(task,task.message);await this.store.save(task);
  }).finally(async()=>{try{await active.interrupt;if(active.stop){const status=active.stop==='cancel'?'cancelled':'paused';if(task.status!==status){task.status=status;this.event(task,status==='cancelled'?'任务已取消，已采集证据保留':'任务已暂停，点击继续可恢复');}await this.store.save(task);}}finally{if(this.active===active)this.active=undefined;}});
 }
 stop(id:string,kind:'pause'|'cancel'):void {const active=this.active;if(active?.task.id!==id||active.stop)return;active.stop=kind;active.task.status='stopping';this.event(active.task,kind==='cancel'?'正在停止当前任务：中断采集与模型请求，保留已保存结果':'正在暂停：中断当前操作并保存进度');void this.store.save(active.task).catch(()=>this.error(active.task,'停止请求快照未能写入，等待任务结束时再次保存'));active.controller.abort();active.interrupt=Promise.resolve().then(()=>this.collector.close()).catch(()=>{this.error(active.task,'采集窗口关闭未确认，请检查独立浏览器');});}
 async wait():Promise<void>{await this.active?.promise;}
 private event(t:ResearchTask,message:string){t.message=message;t.updatedAt=new Date().toISOString();t.events.push({at:t.updatedAt,message});}
 private check(){if(this.active?.controller.signal.aborted)throw new Error('操作中止');}
 private async checkpoint(t:ResearchTask,status:ResearchTask['status'],phase:string,message:string,progress?:TaskProgress){this.check();if(t.phase!==phase||progress)t.progress=progress;t.status=status;t.phase=phase;this.event(t,message);await this.store.save(t);}
 private options(t:ResearchTask):OperationOptions{
  return {
   requireOwnPosts:t.profileRanking,
   profileLimit:taskCollectionScope(t).profileLimit,
   signal:this.active!.controller.signal,
   searchCheckpoint:t.searchCheckpoint,
   onSearchCheckpoint:async checkpoint=>{
    this.check();if((t.collectionVersion!==3&&t.collectionVersion!==4)||checkpoint.keyword!==t.keyword)return;
    if(t.collectionVersion===4&&checkpoint.policy==='raw50'){
     const {searchLimit}=taskCollectionScope(t);
     if((checkpoint.searchLimit??50)!==searchLimit)throw new Error('搜索断点上限与本任务采集范围不一致');
     t.searchVideoIds=[...new Set([...(t.searchVideoIds??[]),...checkpoint.videos.filter(v=>v.kind!=='image').map(v=>v.id)])].slice(0,searchLimit);
    }
    t.searchCheckpoint=structuredClone(checkpoint);
    for(const v of checkpoint.videos){if(t.collectionVersion===4){if(t.searchVideoIds?.includes(v.id))this.mergeSearchSource(t,structuredClone(v));}else this.merge(t,structuredClone(v));}
    for(const a of checkpoint.authors){
     const old=t.authors.find(x=>x.id===a.id);
     if(old)old.sourceSorts=[...new Set([...(old.sourceSorts??[]),...(a.sourceSorts??[])])];
     else t.authors.push({...a,coverage:'partial',cardsCollected:false,fetchedCount:0,profileSampleIds:[]});
    }
    this.event(t,checkpoint.reason);this.refresh(t);await this.store.save(t);this.check();
   },
   onProgress:(message:string,progress?:TaskProgress)=>{
    if(this.active?.controller.signal.aborted)return;
    if(progress)t.progress=progress;this.event(t,message);
    if(this.active&&Date.now()-this.active.lastProgressSave>=500){this.active.lastProgressSave=Date.now();void this.store.save(t).catch(()=>this.error(t,'进度快照暂未写入，请检查本机磁盘'));}
   }
  };
 }
 private snapshot(v:Video){return {likes:{...v.likes},title:v.title,dateText:v.dateText,publishedAt:v.publishedAt,kind:v.kind};}
 private mergeSearchSource(t:ResearchTask,v:Video){
  const old=t.videos.find(x=>x.id===v.id);
  // One video can be both a search source and a completed profile sample. Its
  // displayed evidence must keep matching the snapshot already used to score it.
  if(old&&t.profileRanking&&t.authors.some(a=>a.profileCollected&&a.profileSampleIds?.includes(v.id)))return;
  // A repeated search card can have only a nickname even after its creator was
  // verified from the source video. Keep that stronger identity on continuation.
  if(old?.authorId&&!/^(nickname:|unverified:)/.test(old.authorId)&&old.authorUrl)v={...v,authorId:old.authorId,authorName:old.authorName,authorUrl:old.authorUrl};
  this.merge(t,v);
 }
 private merge(t:ResearchTask,v:Video){
  v.related=normalize(v.title+' '+v.description).includes(normalize(t.keyword));const index=t.videos.findIndex(x=>x.id===v.id);
  if(index<0){v.rankingSnapshot=this.snapshot(v);t.videos.push(v);return;}
  const old=t.videos[index];const merged:Video={...old,...v,title:v.title||old.title,dateText:v.dateText||old.dateText,kind:v.kind==='unknown'?old.kind:v.kind,authorId:v.authorId||old.authorId,authorName:v.authorName||old.authorName,authorUrl:v.authorUrl||old.authorUrl,publishedAt:v.publishedAt??old.publishedAt,frames:old.frames,analysis:old.analysis,analysisStatus:old.analysisStatus,analysisError:old.analysisError,analysisCalls:old.analysisCalls,manualNote:old.manualNote,likes:v.likes.value===null?old.likes:v.likes,favorites:v.favorites.value===null?old.favorites:v.favorites,shares:v.shares.value===null?old.shares:v.shares};merged.rankingSnapshot=t.selectionLocked?(old.rankingSnapshot??this.snapshot(old)):this.snapshot(merged);t.videos[index]=merged;
 }
 private error(t:ResearchTask,message:string){if(!t.errors.includes(message))t.errors.push(message);}
 private refresh(t:ResearchTask){if(t.collectionVersion===4&&t.rankingRequested){applyCandidateScores(t);t.totalFrames=0;return;}if(t.collectionVersion===4){t.ranking=[];t.candidateScores=[];t.selectedVideoIds=[];t.totalFrames=0;return;}if(t.collectionVersion===3){if(!t.selectionLocked)applyCandidateScores(t);t.totalFrames=t.videos.reduce((n,v)=>n+v.frames.length,0);return;}for(const author of t.authors){author.selectionReasons=accountSelectionReasons(t,author.id);author.selectionComplete=author.selectionReasons.length===0;}if(!t.selectionLocked){t.ranking=rankAuthors(t);t.selectedVideoIds=t.ranking.slice(0,taskOptions(t).authorCount).flatMap(r=>selectTopVideos(t,r.authorId).map(v=>v.id));}t.totalFrames=t.videos.reduce((sum,v)=>sum+v.frames.length,0);}
 private async capture(t:ResearchTask,v:Video,extra=false){
  this.check();const capacity=Math.min(10-v.frames.length,frameBudget(t)-t.totalFrames);if(capacity<=0)return;
  if(!v.duration||!v.width||!v.height){try{const updated=await this.collector.inspectVideo(v,this.options(t));this.merge(t,updated);v=t.videos.find(x=>x.id===v.id)!;}catch(e){if(blocking(publicError(e)))throw e;this.error(t,`作品${v.id}详情：${publicError(e)}`);}}
  if(v.kind==='image'||(t.collectionVersion!==3&&v.publishedAt&&Number.isFinite(Date.parse(v.publishedAt))&&!isInWindow(v,t.cutoff,t.createdAt))){v.analysisStatus='skipped';v.analysisError='入选后核实为范围外作品或图文，已跳过，不自动打开其他作品补位';v.samplingComplete=true;await this.store.save(t);return;}
  let targets=v.duration?samplingTimes(v.duration):undefined;
  if(extra&&v.duration)targets=[.1,.35,.65,.9,.95].map(p=>Math.min(v.duration!-.2,v.duration!*p));
  if(targets)targets=targets.filter(time=>!v.frames.some(f=>Math.abs(f.targetTime-time)<.3)).slice(0,capacity);
  if(targets?.length===0)return;
  try{
   const frames=await this.collector.sample(v,this.store.frameDir(t.id),targets,this.options(t));this.check();
   const ids=new Set(v.frames.map(f=>f.id));for(const frame of frames.slice(0,capacity)){if(!ids.has(frame.id)){v.frames.push(frame);ids.add(frame.id);}}
   v.samplingError=frames.length?undefined:'未获取到可用画面';if(!extra&&frames.length)v.samplingComplete=true;if(extra&&frames.length){v.analysisStatus='stale';v.analysis=undefined;t.summary=undefined;t.summaryUsage=undefined;}this.refresh(t);
  }catch(e){if(this.active?.controller.signal.aborted||blocking(publicError(e)))throw e;v.samplingError=publicError(e);this.error(t,`作品${v.id}截图：${v.samplingError}`);}
  await this.store.save(t);
 }
 private async collectSearchAuthors(t:ResearchTask){
  const {searchLimit,profileLimit}=taskCollectionScope(t);
  let reason='';
  if(!t.searchDone){
   await this.checkpoint(t,'searching','search',`按搜索页面顺序读取前${searchLimit}条视频，不操作筛选菜单`);
   const result=await this.collector.search(t.keyword,t.limits,this.options(t));this.check();
   const sourceVideos=[...new Map(result.videos.filter(v=>v.kind!=='image').map(v=>[v.id,v])).values()];
   t.searchVideoIds=[...new Set([...(t.searchVideoIds??[]),...sourceVideos.map(v=>v.id)])].slice(0,searchLimit);
   for(const v of sourceVideos)if(t.searchVideoIds.includes(v.id))this.mergeSearchSource(t,v);
   if(!t.profileRanking)t.videos=t.videos.filter(v=>t.searchVideoIds!.includes(v.id));
   t.searchDone=result.complete??t.searchVideoIds.length>=searchLimit;
   await this.checkpoint(t,'collecting','authors','正在按账号链接去重博主');
   reason=result.reason;await this.store.save(t);
  }
  t.searchVideoIds??=t.videos.slice(0,searchLimit).map(v=>v.id);
  const previous=new Map(t.authors.map(a=>[a.id,a]));const recovered=organizeSearchAuthors(t.profileRanking?t.videos.filter(v=>t.searchVideoIds!.includes(v.id)):t.videos);
  if(t.profileRanking){for(const v of recovered.videos){const i=t.videos.findIndex(x=>x.id===v.id);t.videos[i]=v;}}else t.videos=recovered.videos;
  t.authors=recovered.authors.map(a=>{const old=previous.get(a.id);return {...old,...a,...old?.profileCollected?{fetchedCount:old.fetchedCount,coverage:old.coverage,reason:old.reason}:{}};});if(t.rankingRequested&&!t.profileRanking)for(const a of t.authors){a.profileSampleIds=t.videos.filter(v=>v.authorId===a.id).slice(0,profileLimit).map(v=>v.id);a.cardsCollected=true;a.fetchedCount=a.profileSampleIds.length;}if(t.profileRanking)for(const a of t.authors)if(!a.profileCollected){a.cardsCollected=false;a.profileSampleIds=[];a.relevance=undefined;a.relevanceCacheKey=undefined;a.relevanceCalls=0;a.bio=undefined;a.profileName=undefined;}this.refresh(t);
  t.phase='authors';t.status=t.rankingRequested?'collecting':t.searchDone&&t.authors.length?'complete':'partial';
  const sourceVideos=t.profileRanking?t.videos.filter(v=>t.searchVideoIds!.includes(v.id)):t.videos;const missing=sourceVideos.filter(v=>!v.authorId).length,unverified=t.authors.filter(a=>a.identity!=='account').length;
  this.event(t,`已读${sourceVideos.length}/${searchLimit}条视频，得到${t.authors.length}个作者候选；${missing}条作者未识别。${unverified?unverified+'个候选按昵称暂归组，主页待核对。':''}${t.searchDone?'搜索已结束。':'搜索未完整，可继续。'+(reason?' '+reason.split('；')[0]:'')}`);
  t.progress={completed:sourceVideos.length,total:searchLimit,unit:'条视频'};await this.store.save(t);
 }
 private async resolveProfileAuthors(t:ResearchTask){
  const ids=t.searchVideoIds??[];
  for(const [i,id] of ids.entries()){
   this.check();const v=t.videos.find(v=>v.id===id)!;
   if(v.authorId&&!/^(nickname:|unverified:)/.test(v.authorId)&&v.authorUrl)continue;
   await this.checkpoint(t,'collecting','authors',`核实来源视频作者主页 ${i+1}/${ids.length}：${v.authorName||v.id}`,{completed:i,total:ids.length,unit:'条来源视频'});
   try{
    if(!this.collector.resolveAuthor)throw Error('当前采集器不支持从来源视频核实主页，不能用搜索样本代替');
    const a=await this.collector.resolveAuthor(v,this.options(t));this.check();
    const url=new URL(a.url);if(url.hostname!=='www.douyin.com'||url.pathname!=='/user/'+a.id||a.identity!=='account')throw Error('返回的作者主页身份与地址不一致');
    v.authorId=a.id;v.authorUrl=a.url;v.authorName=a.name;
   }catch(error){if(this.active?.controller.signal.aborted||blocking(publicError(error)))throw error;this.error(t,`来源视频${v.id}主页核实：${publicError(error)}`);}
   await this.store.save(t);
  }
  const previous=new Map(t.authors.map(a=>[a.id,a]));const grouped=organizeSearchAuthors(t.videos.filter(v=>ids.includes(v.id)));
  t.authors=grouped.authors.map(a=>{const old=previous.get(a.id);return {...old,...a,...old?.profileCollected?{fetchedCount:old.fetchedCount,coverage:old.coverage,reason:old.reason}:{}};});
  for(const a of t.authors)if(!a.profileCollected){a.cardsCollected=false;a.profileSampleIds=[];a.bio=undefined;a.profileName=undefined;a.relevance=undefined;a.relevanceCacheKey=undefined;a.relevanceCalls=0;a.fetchedCount=0;}
  this.refresh(t);await this.store.save(t);
 }
 private async rankCandidates(t:ResearchTask,stage:'resume'|'score'){
  const opts=this.options(t),{profileLimit}=taskCollectionScope(t);t.selectionLocked=false;
  if(t.collectionVersion!==4&&stage==='resume'&&!t.searchDone){
   await this.checkpoint(t,'searching','search',t.limits.policy==='combined50'?'搜索综合排序前50条，筛选半年内视频':'双路搜索：最多点赞50条＋综合50条，筛选半年内视频');
   const result=await this.collector.search(t.keyword,t.limits,opts);this.check();
   for(const v of result.videos)this.merge(t,v);
   const authors=new Map<string,ResearchTask['authors'][number]>();for(const a of result.authors){const previous=authors.get(a.id);if(previous)previous.sourceSorts=[...new Set([...(previous.sourceSorts??[]),...(a.sourceSorts??[])])];else authors.set(a.id,{...a,coverage:'partial',cardsCollected:false,fetchedCount:0,profileSampleIds:[],reason:'搜索候选，等待主页12条'});}
   t.authors=[...authors.values()];t.searchDone=true;t.searchCheckpoint=undefined;this.event(t,result.reason);this.refresh(t);await this.store.save(t);
  }
  if(t.profileRanking)await this.resolveProfileAuthors(t);
  for(const [i,a] of t.authors.entries()){
   this.check();if(a.cardsCollected)continue;
   if(t.profileRanking&&a.identity!=='account'){a.relevanceError=`主页身份未核实，不能读取前${profileLimit}条或评分；未使用搜索样本替代`;continue;}
   await this.checkpoint(t,'collecting','authors',`读取主页前${profileLimit}条及简介：${a.name}`,{completed:i,total:t.authors.length,unit:'位候选'});
   try{const result=await this.collector.collectAuthor(a,t.cutoff,profileLimit,opts);this.check();const ids=new Set<string>();for(const v of result.videos){if(v.kind==='image'||ids.has(v.id))continue;if(ids.size>=profileLimit)break;ids.add(v.id);this.merge(t,{...v,authorId:a.id,authorName:a.name,authorUrl:a.url});}a.profileSampleIds=[...ids];a.cardsCollected=true;a.fetchedCount=ids.size;a.coverage=result.coverage;a.reason=result.reason;a.profileName=result.profile?.name||a.name;a.bio=result.profile?.bio||'';}
   catch(error){if(blocking(publicError(error))||this.active?.controller.signal.aborted)throw error;a.reason=publicError(error);a.relevanceError='主页未读取成功，评分资料不足';this.error(t,`${a.name}主页：${a.reason}`);}
   if(t.profileRanking&&a.cardsCollected)a.profileCollected=true;
   this.refresh(t);await this.store.save(t);
  }
  if(!t.authors.length){t.status='partial';this.event(t,'没有可归属作者的搜索结果，不能编造候选');await this.store.save(t);return;}
  if(t.profileRanking&&!t.authors.some(a=>a.profileCollected)){t.status='partial';t.phase='authors';this.event(t,'尚无成功读取的作者主页；已保留来源与失败原因，未用搜索样本代替评分。点击继续可补未完成项。');await this.store.save(t);return;}
  if(!this.analyzer.status().configured||!this.analyzer.scoreAuthor){t.status='waiting_api';t.phase='score';t.progress={completed:0,total:t.authors.length,unit:'位待评分候选'};this.event(t,t.profileRanking?`主页昵称、简介和前${profileLimit}条卡片已保存，主页平均点赞排序可查看；相关度与综合评分待配置API，尚未全部完成。保存API后自动继续。`:t.collectionVersion===4?'博主去重已完成，点赞排序已就绪；相关度与综合评分待配置API，尚未全部完成。保存API设置后自动继续，无需重新搜索。':'主页数据已保存；配置API后点击“计算/继续账号评分”，只发送简介和标题，不打开视频');this.refresh(t);await this.store.save(t);return;}
  for(const a of t.authors){const key=authorAssessmentKey(t.keyword,a,sampleVideos(t,a),(this.analyzer.status().cacheIdentity??this.analyzer.status().model),profileLimit);if(a.relevanceCacheKey!==key){a.relevance=undefined;a.relevanceCalls=0;a.relevanceError=undefined;a.relevanceCacheKey=key;}}
  this.refresh(t);await this.store.save(t);
  for(const [i,a] of t.authors.entries()){
   if(t.profileRanking&&!a.profileCollected)continue;
   this.check();const videos=sampleVideos(t,a),input=assessmentInput(t.keyword,a,videos,profileLimit),key=authorAssessmentKey(t.keyword,a,videos,(this.analyzer.status().cacheIdentity??this.analyzer.status().model),profileLimit);
   if(a.relevanceCacheKey!==key){a.relevance=undefined;a.relevanceCalls=0;a.relevanceError=undefined;a.relevanceCacheKey=key;}
   if(a.relevance){try{validateAssessment(a.relevance,input);continue;}catch{a.relevance=undefined;}}
   if(!input.author.bio&&!input.videos.length){a.relevanceError='简介和作品标题均缺失，无法给出主题分';continue;}
   if((a.relevanceCalls??0)>=(stage==='score'?2:1)){a.relevanceError=(a.relevanceCalls??0)>=2?'已达到该份资料两次评分上限':'首次评分未成功，可明确点击继续评分重试';continue;}
   if(!t.analysisConfig){t.analysisConfig={...(this.runConfig??normalizeProviderConfig({provider:this.analyzer.status().provider,baseURL:this.analyzer.status().baseURL,model:this.analyzer.status().model||undefined}))};await this.store.save(t);}
   await this.checkpoint(t,'analyzing','score',`语义评分 ${i+1}/${t.authors.length}：${a.name}（仅简介和标题）`,{completed:i,total:t.authors.length,unit:'位候选'});
   a.relevanceCalls=(a.relevanceCalls??0)+1;await this.store.save(t);
   try{const response=await this.analyzer.scoreAuthor(t.keyword,a,videos,opts);this.check();validateAssessment(response.assessment,input);a.relevance=response.assessment;a.relevanceUsage=response.usage;a.relevanceError=undefined;}
   catch(error){if(this.active?.controller.signal.aborted)throw error;a.relevanceError=publicError(error);this.error(t,`${a.name}主题评分：${a.relevanceError}`);}
   this.refresh(t);t.progress={completed:i+1,total:t.authors.length,unit:'位候选'};await this.store.save(t);
  }
  this.refresh(t);t.selectionLocked=true;t.status=t.rankingOnly!==false?(t.candidateScores?.every(r=>r.compositeScore!==null)&&(t.collectionVersion!==4||t.searchDone)?'complete':'partial'):t.selectedVideoIds.length?'ready_analysis':'partial';t.phase='rank';this.event(t,`候选排序已生成：${t.authors.length}位全部可见，${t.candidateScores?.filter(r=>r.compositeScore!==null).length??0}位有综合分；按综合分查看完整排名${t.collectionVersion===4&&!t.searchDone?'。搜索尚未完成，可继续补充来源及新作者':''}`);await this.store.save(t);
 }
 private async execute(t:ResearchTask,stage:'resume'|'score'|'analyze'|'sample',videoId?:string){
  if(t.collectionVersion===4){if(stage!=='resume'&&stage!=='score')throw new Error('当前任务不进行选片或视频分析');await this.collectSearchAuthors(t);if(t.rankingRequested&&t.authors.length)return this.rankCandidates(t,stage);return;}
  if(t.collectionVersion===3&&(stage==='resume'||stage==='score'))return this.rankCandidates(t,stage);
  const opts=this.options(t);
  if(stage==='resume'){
   if(!t.searchDone){await this.checkpoint(t,'searching','search',`搜索“${t.keyword}”近${taskOptions(t).days}天候选作品`);const results=await this.collector.search(t.keyword,t.limits,opts);this.check();for(const v of results.videos)this.merge(t,v);for(const a of results.authors){if(!t.authors.some(x=>x.id===a.id)&&t.authors.length<t.limits.maxAuthors)t.authors.push({...a,coverage:'partial',fetchedCount:0,reason:'搜索候选，尚未读取作者作品'});}t.searchDone=true;this.event(t,results.reason);await this.store.save(t);}
   const candidates=t.authors.slice(0,t.limits.maxAuthors);
   for(const [authorIndex,author] of candidates.entries()){
    this.check();if(t.excludedAuthorIds.includes(author.id)||author.cardsCollected)continue;
    await this.checkpoint(t,'collecting','authors',`读取 ${author.name} 的近${taskOptions(t).days}天作品（最多${t.limits.profileMax}条）`,{completed:authorIndex,total:candidates.length,unit:'位博主'});
    try{const result=await this.collector.collectAuthor(author,t.cutoff,t.limits.profileMax,opts);this.check();for(const v of result.videos)this.merge(t,{...v,authorId:author.id,authorName:author.name,authorUrl:author.url});author.cardsCollected=true;author.coverage=result.coverage;author.reason=result.reason;author.fetchedCount=t.videos.filter(v=>v.authorId===author.id).length;}
    catch(e){if(blocking(publicError(e))||this.active?.controller.signal.aborted)throw e;author.reason=publicError(e);author.coverage='partial';this.error(t,`${author.name}作品读取：${author.reason}`);}
    await this.store.save(t);
   }
   t.selectionLocked=false;await this.checkpoint(t,'collecting','rank','主页卡片读取完成，正在按点赞排名（日期缺失不补开详情）');this.refresh(t);t.selectionLocked=true;
   t.status=t.selectedVideoIds.length?'ready_analysis':'partial';this.event(t,t.selectedVideoIds.length?`主页点赞排名已就绪：入选${t.selectedVideoIds.length}条。日期未核实时范围暂定；点击“分析入选作品”才打开详情。`:'主页卡片缺少可比较点赞或作者，无法排名；未打开详情补取');await this.store.save(t);return;
  }
  this.refresh(t);t.selectionLocked=true;
  if(stage==='sample'){
   const video=t.videos.find(v=>v.id===videoId)!;await this.checkpoint(t,'sampling','sample','补采代表画面');await this.capture(t,video,video.frames.length>0);t.status='partial';t.message='截帧完成，可查看证据并点击模型分析';await this.store.save(t);return;
  }
  if(stage==='analyze')for(const [sampleIndex,id] of t.selectedVideoIds.entries()){const v=t.videos.find(v=>v.id===id)!;this.check();if(v.samplingComplete||v.frames.length>=Math.min(5,samplingTimes(v.duration??0).length||5))continue;await this.checkpoint(t,'sampling','sample',`截取代表画面：${v.authorName} · ${v.title.slice(0,35)}`,{completed:sampleIndex,total:t.selectedVideoIds.length,unit:'条作品'});await this.capture(t,v);t.progress={completed:sampleIndex+1,total:t.selectedVideoIds.length,unit:'条作品'};await this.store.save(t);}
  const selected=t.selectedVideoIds.map(id=>t.videos.find(v=>v.id===id)!).filter(Boolean);
  if(!selected.length){t.status='partial';t.message='尚无日期和点赞均可核实的入选作品；查看采集范围或继续扩展';await this.store.save(t);return;}
  if(!this.analyzer.status().configured){t.status='waiting_api';t.phase='analyze';t.progress={completed:0,total:selected.length,unit:'条待分析作品'};t.message='采集结果已保存；请在设置中填写API Key和图像模型后点击模型分析';await this.store.save(t);return;}
  for(const [analysisIndex,id] of t.selectedVideoIds.entries()){
   let v=t.videos.find(v=>v.id===id)!;this.check();if(v.analysisStatus==='skipped'||v.analysisStatus==='complete'&&v.analysis)continue;
   if(!v.frames.length){v.analysisError='没有可用截图，无法进行形式分析';v.analysisStatus='failed';continue;}
   if((v.analysisCalls??0)>=2){v.analysisError='已达到每条作品两次分析上限';continue;}
   await this.checkpoint(t,'analyzing','analyze',`分析内容与形式：${v.authorName} · ${v.title.slice(0,35)}`,{completed:analysisIndex,total:t.selectedVideoIds.length,unit:'条作品'});
   try{
    if(!t.analysisConfig){t.analysisConfig={...(this.runConfig??normalizeProviderConfig({provider:this.analyzer.status().provider,baseURL:this.analyzer.status().baseURL,model:this.analyzer.status().model||undefined}))};await this.store.save(t);}
    v.analysisCalls=(v.analysisCalls??0)+1;v.analysisStatus='running';await this.store.save(t);
    const first=await this.analyzer.analyze(v,this.store.frameDir(t.id),opts);this.check();v.analysis=first.analysis;v.usage=first.usage;v.analysisStatus='complete';v.analysisError=undefined;await this.store.save(t);
    if(v.analysis.needsMoreFrames&&(v.analysisCalls??0)<2&&v.frames.length<10&&t.totalFrames<frameBudget(t)){
     const count=v.frames.length;await this.capture(t,v,true);v=t.videos.find(x=>x.id===id)!;
     if(v.frames.length>count){v.analysisCalls=(v.analysisCalls??0)+1;v.analysisStatus='running';await this.store.save(t);const second=await this.analyzer.analyze(v,this.store.frameDir(t.id),opts);this.check();v.analysis=second.analysis;v.usage=second.usage;v.analysisStatus='complete';}
    }
   }catch(e){if(this.active?.controller.signal.aborted)throw e;v.analysisError=publicError(e);v.analysisStatus='failed';this.error(t,`作品${v.id}模型分析：${v.analysisError}`);}t.progress={completed:analysisIndex+1,total:t.selectedVideoIds.length,unit:'条已处理作品'};await this.store.save(t);
  }
  const final=t.selectedVideoIds.map(id=>t.videos.find(v=>v.id===id)!);
  if(final.some(v=>v.analysisStatus==='complete')&&final.every(v=>v.analysisStatus==='complete'||v.analysisStatus==='skipped'||(v.analysisCalls??0)>=2)&&!t.summaryCalls){
   await this.checkpoint(t,'analyzing','summary','正在汇总跨作品共性与创作参考',{completed:0,total:1,unit:'份汇总'});t.summaryCalls=1;await this.store.save(t);try{const result=await this.analyzer.summarize(t,opts);this.check();t.summary=result.summary;t.summaryUsage=result.usage;t.progress={completed:1,total:1,unit:'份汇总'};}catch(e){if(this.active?.controller.signal.aborted)throw e;this.error(t,`跨作品汇总：${publicError(e)}`);}
  }
  this.refresh(t);const complete=Boolean(t.summary)&&(t.collectionVersion===3?t.candidateScores?.filter(r=>!r.excluded).every(r=>r.compositeScore!==null):t.ranking.slice(0,taskOptions(t).authorCount).every(r=>r.eligible&&t.authors.find(a=>a.id===r.authorId)?.selectionComplete))&&final.every(v=>v.analysisStatus==='complete');
  t.status=complete?'complete':'partial';t.message=complete?'当前候选范围的采集与分析完成；请核对覆盖口径和证据':'部分完成：存在覆盖、指标、截图或分析缺口，请查看详情';this.event(t,t.message);await this.store.save(t);
 }
}
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const publicError=(e:unknown)=>e instanceof Error?e.message.slice(0,300):'操作失败，请重试';
const blocking=(s:string)=>/等待本人|登录|验证码|访问受限|人机|captcha|login|浏览器.*关闭|验证页面/i.test(s);
