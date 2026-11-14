import {createHash} from 'node:crypto';
import {collectionScope,taskCollectionScope} from './collection-scope.js';
import type {Author,Video,SemanticAssessment,ResearchTask,CandidateScore} from './types.js';
export const SCORING_VERSION='bio20-title80-loglikes-70-30-v1';
const round=(n:number)=>Math.round(n*10)/10;
const card=(v:Video):Video=>v.rankingSnapshot?{...v,...v.rankingSnapshot}:v;
export function sampleVideos(task:ResearchTask,author:Author):Video[]{
 const byId=new Map(task.videos.map(v=>[v.id,v]));return [...new Set(author.profileSampleIds??[])].slice(0,taskCollectionScope(task).profileLimit).map(id=>byId.get(id)).filter((v):v is Video=>!!v).map(card);
}
export function assessmentInput(keyword:string,author:Author,videos:Video[],profileLimit=12){
 const limit=collectionScope({profileLimit}).profileLimit;
 return {version:SCORING_VERSION,keyword:keyword.trim(),author:{id:author.id,name:(author.profileName||author.name).slice(0,200),bio:(author.bio||'').trim().slice(0,2000)},videos:videos.slice(0,limit).map(card).filter(v=>v.title.trim()).map(v=>({id:v.id,title:v.title.trim().slice(0,800)})),...(limit===12?{}:{collectionScope:{profileLimit:limit}})};
}
export function authorAssessmentKey(keyword:string,author:Author,videos:Video[],model:string,profileLimit=12):string{return createHash('sha256').update(JSON.stringify({model,input:assessmentInput(keyword,author,videos,profileLimit)})).digest('hex');}
export function validateAssessment(value:SemanticAssessment,input:ReturnType<typeof assessmentInput>):void{
 const score=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100;
 if(!value||!(value.profileScore===null||score(value.profileScore))||!Array.isArray(value.videos)||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>2000)throw Error('账号评分格式校验失败');
 if(!input.author.bio&&value.profileScore!==null)throw Error('简介为空不能编造简介评分');
 const expected=new Set(input.videos.map(v=>v.id)),seen=new Set<string>();
 for(const item of value.videos){if(!expected.has(item.id)||seen.has(item.id)||!score(item.score)||typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>600)throw Error('账号评分引用或范围校验失败');seen.add(item.id);}
 if(seen.size!==expected.size)throw Error('账号评分缺少标题依据');
 if(value.profileScore===null&&!value.videos.length)throw Error('账号评分没有可用依据');
}
export function buildCandidateScores(task:ResearchTask):CandidateScore[]{
 const {profileLimit}=taskCollectionScope(task);
 const rows=task.authors.map(author=>{
  const videos=sampleVideos(task,author),known=videos.map(v=>v.likes.value).filter((n):n is number=>n!==null&&Number.isFinite(n)&&n>=0),warnings:string[]=[];
  if(task.profileRanking){warnings.push(`主页当前展示前${profileLimit}条视频（含置顶），不是最高赞${profileLimit}条或完整历史`);if(!author.profileCollected)warnings.push('主页未成功读取，未使用搜索样本代替');}else if(task.collectionVersion===4){warnings.push('仅依据本批搜索视频样本，不代表账号全部作品');if(author.identity==='nickname'||author.identity==='truncated')warnings.push('昵称暂归组，账号身份及主页未核实');}if(videos.length<profileLimit)warnings.push(task.collectionVersion===4&&!task.profileRanking?`搜索样本不足${profileLimit}条，不补造缺失作品`:`主页样本不足${profileLimit}条，不补造缺失作品`);
  if(known.length<videos.length)warnings.push('部分点赞未获取，均值只使用已获取值，不补零');
  if(!author.bio?.trim())warnings.push('未获取个人简介，相关性仅依据可用标题');
  const titleCount=videos.filter(v=>v.title.trim()).length;if(titleCount<6)warnings.push('可用标题较少，主题判断证据有限');
  if(videos.some(v=>!v.publishedAt))warnings.push(task.collectionVersion===4&&!task.profileRanking?'搜索卡片日期未全部核实，不作为限定时间的完整账号数据':`主页日期未全部核实；主页前${profileLimit}条不等于半年内最高赞作品`);
  let relevanceScore:number|null=null,reason=author.relevanceError||'主题相关性尚未评分';
  if(author.relevance){try{validateAssessment(author.relevance,assessmentInput(task.keyword,author,videos,profileLimit));const titleScores=author.relevance.videos.map(v=>v.score),titleMean=titleScores.length?titleScores.reduce((a,b)=>a+b,0)/titleScores.length:null;const bio=author.relevance.profileScore;relevanceScore=round(bio!==null&&titleMean!==null?bio*.2+titleMean*.8:bio??titleMean!);reason=author.relevance.reason;}catch{reason='评分依据缺失或已变化，请重新评分';}}
  const totalLikes=known.length?known.reduce((a,b)=>a+b,0):null;
  return {authorId:author.id,rank:0,relevanceScore,likesScore:null,compositeScore:null,meanLikes:totalLikes===null?null:totalLikes/known.length,totalLikes,maxLikes:known.length?Math.max(...known):null,sampleCount:videos.length,knownLikesCount:known.length,videoIds:videos.map(v=>v.id),reason,warnings,excluded:task.excludedAuthorIds.includes(author.id),selected:false} as CandidateScore;
 });
 const maxMean=Math.max(0,...rows.map(r=>r.meanLikes??0));
 for(const row of rows){row.likesScore=row.meanLikes===null?null:maxMean===0?0:round(100*Math.log1p(row.meanLikes)/Math.log1p(maxMean));row.compositeScore=row.likesScore===null||row.relevanceScore===null?null:round(row.relevanceScore*.7+row.likesScore*.3);}
 rows.sort((a,b)=>Number(b.compositeScore!==null)-Number(a.compositeScore!==null)||(b.compositeScore??0)-(a.compositeScore??0)||(b.relevanceScore??-1)-(a.relevanceScore??-1)||(b.meanLikes??-1)-(a.meanLikes??-1)||a.authorId.localeCompare(b.authorId));
 let selected=0;for(const [i,row] of rows.entries()){row.rank=row.compositeScore===null?0:i+1;if(task.rankingOnly===false&&row.compositeScore!==null&&!row.excluded&&selected<(task.options?.authorCount??5)){row.selected=true;selected++;}}
 return rows;
}
export function applyCandidateScores(task:ResearchTask):void{
 const previousIds=[...task.selectedVideoIds];
 task.candidateScores=buildCandidateScores(task);
 task.ranking=task.candidateScores.map(r=>({authorId:r.authorId,rank:r.rank,score:r.compositeScore??0,likes:r.totalLikes??0,favorites:0,shares:0,videoIds:r.videoIds,eligible:r.compositeScore!==null,reasons:[...r.warnings,...r.compositeScore===null?[r.reason]:[]]}));
 task.selectedVideoIds=task.candidateScores.filter(r=>r.selected).flatMap(row=>{const a=task.authors.find(a=>a.id===row.authorId)!;return sampleVideos(task,a).filter(v=>v.kind!=='image'&&v.likes.value!==null).sort((a,b)=>b.likes.value!-a.likes.value!||a.id.localeCompare(b.id)).slice(0,task.options?.videosPerAuthor??5).map(v=>v.id);});
 if(previousIds.join('|')!==task.selectedVideoIds.join('|')&&(task.summary!==undefined||task.summaryUsage!==undefined||(task.summaryCalls??0)>0)){
  (task.summaryHistory??=[]).push({summary:task.summary,usage:task.summaryUsage,calls:task.summaryCalls??0,selectedVideoIds:previousIds,invalidatedAt:new Date().toISOString()});task.summary=undefined;task.summaryUsage=undefined;task.summaryCalls=0;
  task.events.push({at:new Date().toISOString(),message:'评分输入或入选集合变化，旧汇总已归档；新集合需手动分析，汇总按新集合计次'});
 }
}
