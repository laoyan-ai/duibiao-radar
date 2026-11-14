import {taskCollectionScope} from './collection-scope.js';
import {exportCandidates} from './candidate-export.js';
import type {ResearchTask,Metric} from './types.js';
import {taskOptions} from './domain.js';
const md=(v:string)=>String(v).replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;').replace(/([\\`*_[\]#|])/g,'\\$1');
const metric=(m:Metric)=>m.value===null?'未获取':`${m.raw??m.value}${m.approximate?'（展示近似值）':''}`;
const csv=(s:unknown)=>{let text=String(s??'');if(/^[\s]*[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
export function exportTask(task:ResearchTask,format:'md'|'csv'):string {
 if(task.collectionVersion===4&&task.rankingRequested)return exportCandidates(task,format);
 if(task.collectionVersion===4){
  const {searchLimit,profileLimit}=taskCollectionScope(task),searchCount=task.searchVideoIds?new Set(task.searchVideoIds).size:task.videos.length;
  const rows=task.authors.map((a,i)=>{const videos=task.videos.filter(v=>v.authorId===a.id);return [i+1,a.name,a.url,videos.length,videos.map(v=>v.url).join(' '),videos.map(v=>v.title).join(' / '),a.identity==='nickname'?'昵称暂归组，主页未核实':a.identity==='truncated'?'昵称不完整，不合并':'账号链接'];});
  const missing=task.videos.filter(v=>!v.authorId);
  const csvRows=[...rows,...missing.map(v=>['','作者未获取','',1,v.url,v.title,''])];
  if(!csvRows.length)csvRows.push(Array(7).fill(''));
  if(format==='csv')return '\uFEFF'+[['出现顺序','博主','主页链接','出现次数','来源视频链接','来源标题','身份依据','搜索视频上限','主页作品上限','实际搜索视频数','实际博主数'],...csvRows.map(row=>[...row,searchLimit,profileLimit,searchCount,task.authors.length])].map(row=>row.map(csv).join(',')).join('\r\n');
  return [`# ${md(task.keyword)} · 搜索前${searchLimit}条视频的去重博主`,'',`采集时间：${task.createdAt}；搜索视频上限：${searchLimit}；主页作品上限：${profileLimit}；实际搜索视频数：${searchCount}；实际博主数：${task.authors.length}；缺少作者${missing.length}条。`,`状态：${task.status}；${md(task.message)}`,'有主页链接按账号去重；没有链接按昵称暂归组，同名可能不同账号。按搜索页出现顺序，不切换排序、不限制日期、不读取主页、不调用模型。类型未知的卡片保留未核实标记；不代表全站覆盖。','',...task.authors.flatMap((a,i)=>[`## ${i+1}. ${md(a.name)}`,`主页：${a.url||'未提供（昵称归组，账号待核对）'}`,`身份依据：${a.identity==='nickname'?'完整昵称暂归组，同名可能不同账号':a.identity==='truncated'?'昵称不完整，单独保留':'公开账号链接'}`,...task.videos.filter(v=>v.authorId===a.id).map(v=>`- ${md(v.title)}：${v.url}${v.kind==='unknown'?'（类型未核实）':''}`),'']),...(missing.length?['## 缺少作者链接',...missing.map(v=>`- ${md(v.title)}：${v.url}`)]:[])].join('\n');
 }
 if(task.collectionVersion===3)return exportCandidates(task,format);
 const scope=taskOptions(task);
 const videos=task.videos.filter(v=>task.selectedVideoIds.includes(v.id));
 if(format==='csv')return '\uFEFF'+[['博主','标题','发布时间','点赞','收藏','分享','相关话题','原视频','采集时间','备注','时间范围','博主数量','每位作品上限','主页卡片点赞','主页卡片日期'],...videos.map(v=>[v.authorName,v.title,v.publishedAt??'未核实',metric(v.likes),metric(v.favorites),metric(v.shares),v.related?'是':'否',v.url,v.collectedAt,v.manualNote??'',scope.days,scope.authorCount,scope.videosPerAuthor,metric(v.rankingSnapshot?.likes??v.likes),v.rankingSnapshot?.publishedAt??'未核实'])].map(row=>row.map(csv).join(',')).join('\r\n');
 const lines=[`# ${md(task.keyword)} · 博主内容调研`,``, `任务时间：${task.createdAt}；近${scope.days}天截止：${task.cutoff}；范围：${scope.authorCount}位博主，每位最多${scope.videosPerAuthor}条`,`状态：${task.status}；${md(task.message)}`,`排名口径：${task.mode==='likes'?'主页点赞快照（仅点赞）':'点赞＋收藏＋分享；相关作品互动最高五条累计'}。榜单仅代表已采集卡片样本；日期未知的卡片计入暂定排名，不能保证所选时间范围或全站绝对排名。仅对手动启动分析的入选作品打开详情。`,``,`## 博主比较`,``,`| 博主 | 互动分 | 覆盖 | 说明 |`,`|---|---:|---|---|`];
 for(const r of task.ranking){const a=task.authors.find(a=>a.id===r.authorId);lines.push(`| ${md(a?.name??r.authorId)} | ${r.score} | ${r.eligible?'窗口已核实':'样本暂定'} | ${md(r.reasons.join('；'))} |`);}
 for(const v of videos){lines.push('',`## ${md(v.authorName)} · ${md(v.title)}`,'',`原视频：${v.url}`,`发布日期：${v.publishedAt??'未核实'}；点赞 ${metric(v.likes)} / 收藏 ${metric(v.favorites)} / 分享 ${metric(v.shares)}`,`与关键词相关：${v.related?'是':'否'}；采集时间：${v.collectedAt}`);
  if(v.rankingSnapshot)lines.push(`主页排名快照：点赞 ${metric(v.rankingSnapshot.likes)}；卡片日期 ${v.rankingSnapshot.publishedAt??'未核实'}；分析详情更新不自动改榜/补位。`);
  if(v.analysis){for(const [key,label]of [['theme','内容主题'],['audience','受众'],['hook','切入点'],['structure','可见结构'],['orientation','画幅'],['person','人物'],['mainVisual','主画面'],['layout','合成布局'],['source','素材来源'],['takeaways','可借鉴方式']]as const){const c=v.analysis[key];lines.push('',`**${label}**：${md(c.value)}（${c.confidence}）`,`${md(c.explanation)}；依据：${c.evidence.map(md).join('、')}`);}lines.push('',...v.analysis.limitations.map(l=>'- '+md(l)));}else lines.push('','分析尚未完成：'+md(v.analysisError??v.samplingError??'等待模型或可用画面'));
  for(const f of v.frames)lines.push('',`![${f.id} · ${f.actualTime.toFixed(1)}s](frames/${encodeURIComponent(f.file)})`);
  if(v.manualNote)lines.push('','本人备注：'+md(v.manualNote));
 }
 if(task.summary)lines.push('','## 跨作品归纳','',md(task.summary));if(task.errors.length)lines.push('','## 限制与失败','',...task.errors.map(e=>'- '+md(e)));return lines.join('\n');
}
