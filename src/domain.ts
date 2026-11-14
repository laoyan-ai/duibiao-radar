import {collectionScope} from './collection-scope.js';
import type {Metric,Video,ResearchTask,RankedAuthor,ResearchOptions} from './types.js';
export const DEFAULT_MODEL='gpt-6.1-sol';
export function researchOptions(value:unknown=undefined):ResearchOptions {
 if(value===undefined)return {authorCount:5,videosPerAuthor:5,days:90};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('调研范围必须为有效对象');
 const data=value as Record<string,unknown>;if(Object.keys(data).some(k=>!['authorCount','videosPerAuthor','days'].includes(k)))throw new Error('调研范围包含未知字段');
 const result={authorCount:5,videosPerAuthor:5,days:90};
 for(const key of ['authorCount','videosPerAuthor','days'] as const){const n=data[key]===undefined?result[key]:data[key];const max=key==='days'?365:20;if(typeof n!=='number'||!Number.isInteger(n)||n<1||n>max)throw new Error(key==='days'?'时间范围须为1—365的整数天数':'博主数量和每位作品数须为1—20的整数');result[key]=n;}
 return result;
}
export function taskOptions(task:ResearchTask):ResearchOptions{return researchOptions(task.options);}
export function frameBudget(task:ResearchTask):number {const o=taskOptions(task);return o.authorCount*o.videosPerAuthor*10;}
export function parseMetric(raw:string|null|undefined):Metric {
 const text=raw==null?null:String(raw).trim(); const m=text?.replace(/,/g,'').match(/^(\d+(?:\.\d+)?)\s*(万|亿|[kKmMwW])?\+?$/);
 if(!m)return {raw:text,value:null,approximate:false};
 const unit=m[2]?.toLowerCase();const multiplier=unit==='万'||unit==='w'?10000:unit==='亿'?1e8:unit==='k'?1000:unit==='m'?1e6:1;
 const value=Number(m[1])*multiplier;
 return {raw:text,value:Number.isFinite(value)&&value>=0?Math.round(value):null,approximate:!!unit||!!text?.includes('+')};
}
export function parsePublishDate(raw:string,now=new Date()):string|null {
 const text=raw.trim().replace(/^[·\s]+/,'');
 if(/\d+\s*(个月|月|年)前/.test(text))return null;
 const relative=text.match(/^(\d+)\s*(分钟|小时|天|周)前$/);
 if(relative){const ms=Number(relative[1])*({'分钟':60000,'小时':3600000,'天':86400000,'周':604800000}[relative[2]]??0);return new Date(now.getTime()-ms).toISOString();}
 if(/^(刚刚|今天|昨天)$/.test(text))return new Date(now.getTime()-(text==='昨天'?86400000:0)).toISOString();
 const m=text.match(/(?:(\d{4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})(?:日)?/);if(!m)return null;
 const localNow=new Date(now.getTime()+8*3600000);let year=m[1]?+m[1]:localNow.getUTCFullYear();const month=+m[2],day=+m[3];
 const clock=text.slice(m.index!+m[0].length).match(/^[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);const hour=clock?+clock[1]:12,minute=clock?+clock[2]:0,second=clock?.[3]?+clock[3]:0;
 if(hour>23||minute>59||second>59)return null;
 let localStamp=Date.UTC(year,month-1,day,hour,minute,second),stamp=localStamp-8*3600000;if(!m[1]&&stamp>now.getTime()+86400000){year--;localStamp=Date.UTC(year,month-1,day,hour,minute,second);stamp=localStamp-8*3600000;}
 const d=new Date(localStamp);if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
 return new Date(stamp).toISOString();
}
export function isInWindow(video:Video,cutoff:string,end:string):boolean {
 if(!video.publishedAt||video.kind!=='video')return false;const t=Date.parse(video.publishedAt);return Number.isFinite(t)&&t>=Date.parse(cutoff)&&t<=Date.parse(end);
}
export function rankingVideo(video:Video):Video {return video.rankingSnapshot?{...video,...video.rankingSnapshot}:video;}
export function cardInWindow(video:Video,task:ResearchTask):boolean {if(video.kind==='image')return false;if(!video.publishedAt||!Number.isFinite(Date.parse(video.publishedAt)))return true;const stamp=Date.parse(video.publishedAt);return stamp>=Date.parse(task.cutoff)&&stamp<=Date.parse(task.createdAt);}
export function rankAuthors(task:ResearchTask):RankedAuthor[] {
 const rank=task.authors.filter(a=>!task.excludedAuthorIds.includes(a.id)).map(author=>{
  const related=task.videos.map(rankingVideo).filter(v=>v.authorId===author.id&&v.related&&v.kind!=='image');
  const recent=related.filter(v=>cardInWindow(v,task));const reasons:string[]=[];
  if(author.coverage!=='complete')reasons.push('所选时间内作品覆盖尚未证实完整');
  if(related.some(v=>v.publishedAt===null))reasons.push('存在日期未核实的相关卡片，时间范围暂定');
  if(related.some(v=>v.kind==='unknown'&&(!v.publishedAt||(Date.parse(v.publishedAt)>=Date.parse(task.cutoff)&&Date.parse(v.publishedAt)<=Date.parse(task.createdAt)))))reasons.push('存在类型未核实的相关作品');
  const valid=recent.filter(v=>v.likes.value!==null&&(task.mode==='likes'||(v.favorites.value!==null&&v.shares.value!==null)));
  if(valid.length!==recent.length)reasons.push('存在排名指标未获取的相关作品');if(!valid.length)reasons.push('没有可比较的相关作品');
  const score=(v:Video)=>v.likes.value!+(task.mode==='likes'?0:v.favorites.value!+v.shares.value!);
  valid.sort((a,b)=>score(b)-score(a)||(b.likes.value!-a.likes.value!)||a.id.localeCompare(b.id));
  const best=valid.slice(0,5);const sum=(key:'likes'|'favorites'|'shares')=>best.reduce((n,v)=>n+(v[key].value??0),0);
  return {authorId:author.id,score:best.reduce((n,v)=>n+score(v),0),likes:sum('likes'),favorites:sum('favorites'),shares:sum('shares'),videoIds:best.map(v=>v.id),eligible:!reasons.length,reasons,rank:0};
 });
 rank.sort((a,b)=>(task.mode==='likes'?0:Number(b.eligible)-Number(a.eligible))||b.score-a.score||b.likes-a.likes||b.shares-a.shares||a.authorId.localeCompare(b.authorId));
 rank.forEach((r,i)=>r.rank=i+1);return rank;
}
export function selectTopVideos(task:ResearchTask,authorId:string):Video[] {
 return task.videos.map(rankingVideo).filter(v=>v.authorId===authorId&&cardInWindow(v,task)&&v.likes.value!==null).sort((a,b)=>b.likes.value!-a.likes.value!||Date.parse(b.publishedAt!)-Date.parse(a.publishedAt!)||a.id.localeCompare(b.id)).slice(0,taskOptions(task).videosPerAuthor);
}
export function samplingTimes(duration:number):number[] {
 if(!Number.isFinite(duration)||duration<=0)return [];const end=Math.max(0,duration-.2);
 return [...new Set([Math.min(3,duration*.1),duration*.2,duration*.5,duration*.8,Math.max(duration-3,duration*.9)].map(x=>Math.round(Math.min(end,Math.max(0,x))*1000)/1000))].sort((a,b)=>a-b);
}
export function createTask(keyword:string,mode:'engagement'|'likes'='likes',value?:unknown,version:2|3|4=3,collection?:unknown):ResearchTask {
 const scope=collectionScope(collection);const options=researchOptions(value);if(version===3)options.days=180;const now=new Date().toISOString();return {id:crypto.randomUUID(),keyword:keyword.trim(),createdAt:now,cutoff:new Date(Date.parse(now)-options.days*86400000).toISOString(),updatedAt:now,status:'idle',phase:'ready',message:'等待开始',mode,options,collectionVersion:version,...version===4?{collectionScope:scope}:{},rankingOnly:version>=3,selectionLocked:false,limits:version===4?{searchPerSort:scope.searchLimit,maxSearchVideos:scope.searchLimit,maxAuthors:scope.searchLimit,profileMax:scope.profileLimit,policy:'raw50'}:version===3?{searchPerSort:50,maxSearchVideos:50,maxAuthors:50,profileMax:12,policy:'combined50'}:{searchPerSort:100,maxSearchVideos:Math.max(200,options.authorCount*20),maxAuthors:Math.max(20,options.authorCount),profileMax:300},videos:[],authors:[],ranking:[],excludedAuthorIds:[],selectedVideoIds:[],errors:[],events:[],searchDone:false,totalFrames:0};
}
export function accountSelectionReasons(task:ResearchTask,authorId:string):string[]{
 const reasons:string[]=[];const author=task.authors.find(a=>a.id===authorId);if(author?.coverage!=='complete')reasons.push('账号作品列表覆盖未完整核实');
 const potential=task.videos.map(rankingVideo).filter(v=>v.authorId===authorId&&v.kind!=='image'&&(!v.publishedAt||(Date.parse(v.publishedAt)>=Date.parse(task.cutoff)&&Date.parse(v.publishedAt)<=Date.parse(task.createdAt))));
 if(potential.some(v=>!v.publishedAt))reasons.push('存在日期未核实、可能影响账号高赞作品的作品');
 if(potential.some(v=>v.kind==='unknown'))reasons.push('存在类型未核实的账号作品');
 if(potential.some(v=>v.likes.value===null))reasons.push('存在点赞未获取、可能影响账号高赞作品的作品');return reasons;
}
