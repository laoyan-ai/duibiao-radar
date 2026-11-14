import {taskCollectionScope} from './collection-scope.js';
import type {ResearchTask} from './types.js';import {buildCandidateScores,sampleVideos} from './scoring.js';
const md=(s:unknown)=>String(s??'').replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;').replace(/([\\`*_[\]#|])/g,'\\$1');
const csv=(s:unknown)=>{let value=String(s??'');if(/^[\s]*[=+@\-\t\r]/.test(value))value="'"+value;return '"'+value.replace(/"/g,'""')+'"';};
const score=(v:number|null)=>v===null?'未评分':v.toFixed(1);
const raw=(v:number|null)=>v===null?'未获取':String(v);
const safe=(url:string)=>{try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:'链接不可用';}catch{return '链接不可用';}};
export function exportCandidates(task:ResearchTask,format:'md'|'csv'):string{
 const rows=task.candidateScores??buildCandidateScores(task);
 const {searchLimit,profileLimit}=taskCollectionScope(task),searchCount=task.searchVideoIds?new Set(task.searchVideoIds).size:task.videos.length;
 if(format==='csv')return '\uFEFF'+[['综合名次','博主','主页','搜索来源','内容相关度分','点赞表现分','综合分','平均点赞','总点赞','最高点赞',task.collectionVersion===4&&!task.profileRanking?'搜索样本数':'主页样本数','点赞有效数','个人简介','评分理由','限制','搜索视频上限','主页作品上限','实际搜索视频数','实际博主数','作品评分依据'],...rows.map(r=>{const a=task.authors.find(a=>a.id===r.authorId)!;return [r.rank||'未评分',a.name,a.url?safe(a.url):'未提供（昵称候选，主页待核对）',(a.sourceSorts??[]).join(' / '),score(r.relevanceScore),score(r.likesScore),score(r.compositeScore),raw(r.meanLikes),raw(r.totalLikes),raw(r.maxLikes),r.sampleCount,r.knownLikesCount,a.bio??'',r.reason,r.warnings.join('；'),searchLimit,profileLimit,searchCount,task.authors.length,JSON.stringify(sampleVideos(task,a).map(v=>{const judgment=a.relevance?.videos.find(item=>item.id===v.id);return {id:v.id,title:v.title,url:safe(v.url),likes:v.likes.value,score:judgment?.score??null,reason:judgment?.reason??'尚无评分依据'};}))];}),...(!rows.length?[[...Array(15).fill(''),searchLimit,profileLimit,searchCount,task.authors.length,'[]']]:[])].map(row=>row.map(csv).join(',')).join('\r\n');
 const lines=[`# ${md(task.keyword)} · 全部候选评分`,'',`任务：${task.id}；状态：${task.status}`,`搜索视频上限：${searchLimit}；主页作品上限：${profileLimit}；实际搜索视频数：${searchCount}；实际博主数：${task.authors.length}；实际评分样本数：${rows.reduce((sum,row)=>sum+row.sampleCount,0)}`,task.profileRanking?`搜索页前${searchLimit}条默认顺序发现候选；从来源核实账号主页，读取昵称、简介及当前前${profileLimit}条视频卡片（含置顶）。只用主页样本评分，未读到的保留缺口，不以搜索视频代替。`:task.collectionVersion===4?`搜索页默认前${searchLimit}条视频，保留原顺序；账号链接去重或昵称暂归组。只用本批搜索卡片标题与点赞评分，未采主页，不等于每个账号${profileLimit}条主页作品。`:`搜索：半年内视频，${task.limits.policy==='combined50'?'综合排序前50条':'旧双路：最多点赞前50＋综合前50'}，去重作者全部保留。主页当前展示前12条（包含置顶），不是账号最高赞12条，也不保证主页样本都在半年内。`,'相关分：简介方向20%＋标题语义均值80%；简介不足时仅按可用标题并降低证据充分度。点赞分：100×log1p(平均点赞)/log1p(本批最大平均点赞)，全零为0；缺失不补零。综合分：相关70%＋点赞30%，缺分不参与综合排名。','', '| 综合名次 | 博主 | 相关度 | 点赞分 | 综合分 | 平均点赞 | 有效/样本 |','|---:|---|---:|---:|---:|---:|---|'];
 for(const r of rows){const a=task.authors.find(a=>a.id===r.authorId)!;lines.push(`| ${r.rank||'—'} | ${md(a.name)} | ${score(r.relevanceScore)} | ${score(r.likesScore)} | ${score(r.compositeScore)} | ${raw(r.meanLikes)} | ${r.knownLikesCount}/${r.sampleCount} |`);}
 for(const r of rows){const a=task.authors.find(a=>a.id===r.authorId)!;lines.push('',`## ${md(a.name)}`,`主页：${md(a.url?safe(a.url):'未提供（昵称候选，主页待核对）')}`,`简介：${md(a.bio||'未获取')}`,`评分理由：${md(r.reason)}`,...r.warnings.map(w=>'- '+md(w)));
  for(const v of sampleVideos(task,a)){const judgment=a.relevance?.videos.find(item=>item.id===v.id);lines.push(`- ${md(v.title||'标题未获取')}；来源 ${md(safe(v.url))}；点赞 ${md(v.likes.raw??'未获取')}；相关分 ${judgment?.score??'未评分'}；${md(judgment?.reason||'尚无评分依据')}`);}
 }
 for(const v of task.videos.filter(v=>task.selectedVideoIds.includes(v.id))){if(!v.analysis&&!v.frames.length)continue;lines.push('',`## 入选作品分析：${md(v.authorName)} · ${md(v.title)}`,`原作品：${md(safe(v.url))}`);
  if(v.analysis){for(const key of ['theme','audience','hook','structure','orientation','person','mainVisual','layout','source','takeaways']as const){const c=v.analysis[key];lines.push(`**${key}**：${md(c.value)}（${c.confidence}）；${md(c.explanation)}；依据 ${c.evidence.map(md).join('、')}`);}lines.push(...v.analysis.limitations.map(x=>'- '+md(x)));}
  for(const f of v.frames)lines.push(`![${md(f.id)} · ${f.actualTime.toFixed(1)}秒](frames/${encodeURIComponent(f.file)})`);
  if(v.manualNote)lines.push('人工备注：'+md(v.manualNote));
 }
 if(task.summary)lines.push('','## 跨作品汇总',md(task.summary));return lines.join('\n');
}
