'use strict';
const APP_BUILD='2026-11-14-brand-assets-1';
const state = {runtimeCompatible:false,token:'', settings:{configured:false,model:''}, tasks:[], current:null, selectedId:null, authorId:null, pollTimer:null, polling:false, selectionVersion:0, pending:false, stopPending:false, launching:false, stopAfterRequest:false, commandAction:null, launchStartedAt:0, clockTimer:null, noteDrafts:new Map(), browserOpening:false, browserPolling:false, browserTimer:null, browserRevision:0, browserStatus:null, runLogKey:null};
const labels = {ready_analysis:'候选排名已就绪',idle:'待开始',searching:'搜索候选中',collecting:'采集作品中',sampling:'画面采样中',analyzing:'AI 分析中',waiting_user:'等待本人操作',waiting_api:'待配置 API',paused:'已暂停',partial:'部分完成',complete:'本次任务完成',cancelled:'已取消',stopping:'正在停止',failed:'失败'};
const activeStatuses = new Set(['searching','collecting','sampling','analyzing','stopping']);
const claimLabels = {theme:'主题',audience:'面向受众',hook:'问题切入点',structure:'可见内容结构',orientation:'画幅',person:'人物',mainVisual:'主画面',layout:'合成布局',source:'动态来源',takeaways:'可借鉴方式'};
const $ = id => document.getElementById(id);
const defaultModel='gpt-6.1-sol';
const providerPresets=[
 {id:'openai',label:'OpenAI',baseURL:'https://api.openai.com/v1',defaultModel,models:[{id:defaultModel,label:'GPT-6.1 Sol · 默认'},{id:'gpt-5.4-mini',label:'GPT-5.4 mini'},{id:'gpt-5.4',label:'GPT-5.4'}]},
 {id:'deepseek',label:'DeepSeek',baseURL:'https://api.deepseek.com/v1',defaultModel:'deepseek-chat',models:[{id:'deepseek-chat',label:'DeepSeek Chat'},{id:'deepseek-reasoner',label:'DeepSeek Reasoner'}]},
 {id:'qwen',label:'通义千问',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',defaultModel:'qwen-plus',models:[{id:'qwen-plus',label:'Qwen Plus'},{id:'qwen-turbo',label:'Qwen Turbo'}]},
 {id:'doubao',label:'豆包',baseURL:'https://ark.cn-beijing.volces.com/api/v3',defaultModel:'doubao-seed-1-6-250615',models:[]},
 {id:'custom',label:'自定义兼容接口',baseURL:'',defaultModel:'',models:[]}
];
state.providers=providerPresets;state.settingsInitialized=false;state.draftDirty=false;state.modelListRevision=0;state.draftRevision=0;
function providerInfo(id=$('provider').value){return state.providers.find(p=>p.id===id)||providerPresets[0];}
function normalizedAddress(value){return String(value||'').trim().replace(/\/+$/,'');}
function draftConfig(){const info=providerInfo();return {provider:info.id,baseURL:normalizedAddress($('base-url').value||(!state.settingsInitialized?info.baseURL:'')),model:($('model').value==='custom'?$('custom-model').value:$('model').value).trim()};}
function matchingProfile(config=draftConfig()){return state.settings.profiles?.find(p=>p.provider===config.provider&&normalizedAddress(p.baseURL)===config.baseURL);}
function draftDiffers(){const c=draftConfig();return c.provider!==state.settings.provider||c.baseURL!==state.settings.baseURL||c.model!==state.settings.model||!!$('api-key').value.trim();}
function setModels(models,selected){$('model').replaceChildren(...models.map(m=>{const o=el('option',m.label||m.id);o.value=m.id;return o;}),Object.assign(el('option','其他模型（高级）'),{value:'custom'}));$('model').value=models.some(m=>m.id===selected)?selected:'custom';$('custom-model').value=$('model').value==='custom'?selected:'';updateModelField();}
function updateDraftControls(){
 const c=draftConfig(),profile=matchingProfile(c),info=providerInfo();
 $('api-key').required=!profile;$('api-key').placeholder=profile?'此厂商及地址已保存，留空沿用':'填写此厂商及地址的密钥';
 $('settings-status').textContent=(profile?'此地址已加密保存':'此地址未保存')+(draftDiffers()?' · 草稿未生效':'');
 $('settings-status').className=`badge ${profile?'good':'warning'}`;
 $('api-destination').textContent=`密钥发送目标：${c.baseURL||'请填写 HTTPS API 地址'}（经本机服务直连）`;
 $('endpoint-confirmation').hidden=c.provider!=='custom';$('endpoint-confirmed').required=c.provider==='custom'&&!profile;
 $('test-api').disabled=!state.runtimeCompatible||!state.settings.configured||draftDiffers();
 $('clear-api').disabled=!state.runtimeCompatible||!profile;
 $('fetch-models').disabled=!state.runtimeCompatible||state.listingModels;
 $('base-url').readOnly=!['custom','qwen'].includes(info.id);
 updateRuntimeControls();
}
function configureDraft(provider,baseURL,model){
 const info=providerInfo(provider);$('provider').value=info.id;
 const endpoints=info.endpoints?.length?info.endpoints:[{label:'官方地址',url:info.baseURL}];
 $('endpoint-select').replaceChildren(...endpoints.filter(e=>e.url).map(e=>Object.assign(el('option',e.label),{value:e.url})),...(['qwen','custom'].includes(info.id)?[Object.assign(el('option','其他地址（高级）'),{value:'custom'})]:[]));
 $('base-url').value=normalizedAddress(baseURL??info.baseURL);$('endpoint-select').value=endpoints.some(e=>normalizedAddress(e.url)===$('base-url').value)?$('base-url').value:'custom';
 $('address-advanced').hidden=!['qwen','custom'].includes(info.id)||$('endpoint-select').value!=='custom';
 $('api-key').value='';$('endpoint-confirmed').checked=false;state.modelListRevision++;
 setModels(info.models||[],model??info.defaultModel);$('model-source').textContent='预设模型 · 未验证账号权限，请核对厂商控制台。';updateDraftControls();
}
function addressChanged(){state.draftDirty=true;state.draftRevision++;state.modelListRevision++;$('api-key').value='';$('endpoint-confirmed').checked=false;setModels(providerInfo().models||[],providerInfo().defaultModel);$('model-source').textContent='预设模型 · 地址变化后未验证。';updateDraftControls();}
async function fetchModels(){
 clearError();const config=draftConfig(),key=$('api-key').value.trim(),revision=++state.modelListRevision;
 if(config.provider==='custom'&&!matchingProfile()&&!$('endpoint-confirmed').checked){showError('请先确认自定义地址可接收此密钥。');return;}
 const payload={provider:config.provider,baseURL:config.baseURL};if(key)payload.apiKey=key;if(config.provider==='custom')payload.endpointConfirmed=!!$('endpoint-confirmed').checked;
 state.listingModels=true;updateDraftControls();
 try{const result=await api('/api/settings/models',payload);if(revision!==state.modelListRevision)return;const models=Array.isArray(result.models)?result.models:[];setModels(models,config.model);$('model-source').textContent=`${result.source==='remote'?'接口模型列表（不代表调用权限）':'预设模型 · 未验证'} · ${result.message||''}`;}
 catch(error){if(revision===state.modelListRevision){$('api-key').value='';setModels(providerInfo().models||[],config.model);$('model-source').textContent='预设模型 · 未验证；获取失败，请检查地址和凭据后重试。';showError(error);}}
 finally{state.listingModels=false;updateDraftControls();}
}
function collectionScopeOf(task){return {searchLimit:task?.collectionScope?.searchLimit??50,profileLimit:task?.collectionScope?.profileLimit??12};}
function readCollectionScope(){
 const searchLimit=Number($('search-limit').value),profileLimit=Number($('profile-limit').value);
 if(!Number.isInteger(searchLimit)||searchLimit<1||searchLimit>200)throw new Error('搜索视频上限须为1—200的整数。');
 if(!Number.isInteger(profileLimit)||profileLimit<1||profileLimit>30)throw new Error('每位主页作品上限须为1—30的整数。');
 return {searchLimit,profileLimit};
}
function scopeOf(task){return {authorCount:5,videosPerAuthor:5,days:90,...task?.options};}
function rankingOnly(task){return task?.collectionVersion===4||task?.collectionVersion===3&&task.rankingOnly!==false;}
function readResearchOptions(){
  return {};
}
function updateScopeEstimate(){
  $('custom-days-field').hidden=true;$('custom-days').required=false;$('custom-days').disabled=true;
  try{const {searchLimit,profileLimit}=readCollectionScope();$('scope-estimate').textContent=`搜索前${searchLimit}条 · 每位主页${profileLimit}条 · 最多${searchLimit}位去重作者 × ${profileLimit}条＝${searchLimit*profileLimit}条主页作品；不足按实际记录。数量越大，时间与API用量越多。`;$('scope-stamp').textContent=`前${searchLimit}条视频 · 去重后排名`;}catch{$('scope-estimate').textContent='请填写范围内的整数：搜索1—200条，每位主页1—30条。';}
}
function updateModelField(){const custom=$('model').value==='custom';$('custom-model-field').hidden=!custom;$('custom-model').required=custom;$('custom-model').disabled=!custom;}
function el(tag, text, className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=String(text); if(className)node.className=className; return node; }
function date(value) { if(!value)return '日期待核实'; const d=new Date(value); return Number.isNaN(d.getTime())?'日期待核实':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}); }
function number(value) { return typeof value==='number'&&Number.isFinite(value)?Math.round(value).toLocaleString('zh-CN'):'未获取'; }
function metric(m) { if(!m||m.value===null||m.value===undefined)return '未获取'; return `${number(m.value)}${m.approximate?'（约）':''}`; }
function badge(text, tone='') { return el('span',text,`badge ${tone}`); }
function link(text, url, className='') { let target;try{target=new URL(url);}catch{return el('span',text,'muted');} if(!['https:','http:'].includes(target.protocol))return el('span',`${text}（链接不可用）`,'muted');const a=el('a',text,className);a.href=target.href;a.target='_blank';a.rel='noopener noreferrer';return a; }
function button(text, handler, className='') { const node=el('button',text,className);node.type='button';node.addEventListener('click',handler);return node; }
function showError(error) { $('error').textContent=error instanceof Error?error.message:String(error);$('error').hidden=false; }
function clearError() { $('error').hidden=true;$('error').textContent=''; }
const runtimeWriteControls=['start-task','open-browser','settings-save','clear-api','test-api','resume-task','expand-task','recompute-task','analyze-task','score-task'];
const runtimeMessage='本页与后台版本不一致，可能仍在运行旧版后台。请先停止当前任务，再在原启动窗口按 Ctrl+C，重新双击 start.cmd，随后刷新本页。新采集、AI 调用与设置写入已暂停；仍可停止/取消任务、查看和导出已有结果。';
function updateRuntimeControls(){if(!state.runtimeCompatible)for(const id of runtimeWriteControls)$(id).disabled=true;}
function applyRuntimeVersion(build){
  state.runtimeCompatible=build===APP_BUILD;
  $('runtime-notice').hidden=state.runtimeCompatible;
  $('runtime-notice').textContent=state.runtimeCompatible?'':runtimeMessage;
  for(const id of ['start-task','open-browser','settings-save','clear-api'])$(id).disabled=!state.runtimeCompatible;
  $('test-api').disabled=!state.runtimeCompatible||!state.settings.configured;
  if(state.settingsInitialized)updateDraftControls();
  if(state.current)renderTask(state.current);
  updateRuntimeControls();
}
async function api(path, body) {
  const stopping=/^\/api\/tasks\/[^/]+\/action$/.test(path)&&['pause','cancel'].includes(body?.action);
  if(body!==undefined&&!state.runtimeCompatible&&!stopping)throw new Error(runtimeMessage);
  const options={headers:{}};
  if(body!==undefined){options.method='POST';options.headers={'content-type':'application/json','x-session-token':state.token};options.body=JSON.stringify(body);}
  let response;try{response=await fetch(path,options);}catch{throw new Error('无法连接本地服务。请确认启动窗口仍在运行。');}
  let data;try{data=await response.json();}catch{throw new Error(`本地服务返回了不可读的响应（${response.status}）。`);}
  if(!response.ok)throw new Error(typeof data.error==='string'?data.error:`请求失败（${response.status}）`);
  return data;
}

function renderBrowserStatus(status){
 const browser=['closed','opening','open','unknown'].includes(status?.browser)?status.browser:'unknown';
 const login=['logged_in','logged_out','verification','unknown'].includes(status?.login)?status.login:'unknown';
 state.browserStatus={browser,login,message:typeof status?.message==='string'?status.message:''};
 $('browser-status').textContent='浏览器：'+({closed:'未打开',opening:'正在打开',open:'已打开',unknown:'待确认'})[browser];
 $('login-status').textContent='抖音：'+({logged_in:'已登录',logged_out:'未登录',verification:'需要验证',unknown:'待确认'})[login];
 $('browser-status').className='badge '+(browser==='open'?'good':'warning');$('login-status').className='badge '+(login==='logged_in'?'good':'warning');
 $('browser-message').textContent=state.browserStatus.message||'仅在页面能确认时显示登录状态；可点击刷新。';
 $('open-browser').disabled=!state.runtimeCompatible||state.browserOpening;$('open-browser').textContent=state.browserOpening?'正在打开浏览器…':browser==='open'?'前往浏览器 / 登录抖音':'打开浏览器 / 登录抖音';
 $('refresh-browser-status').disabled=state.browserPolling||state.browserOpening;
}
function scheduleBrowserStatus(){if(state.browserTimer)clearTimeout(state.browserTimer);state.browserTimer=null;if(document.visibilityState!=='hidden')state.browserTimer=setTimeout(refreshBrowserStatus,5000);}
async function refreshBrowserStatus(){
 if(state.browserPolling||state.browserOpening||document.visibilityState==='hidden')return;
 if(state.browserTimer)clearTimeout(state.browserTimer);state.browserTimer=null;state.browserPolling=true;const revision=state.browserRevision;$('refresh-browser-status').disabled=true;
 const controller=typeof AbortController==='function'?new AbortController():null;const timeout=controller?setTimeout(()=>controller.abort(),4000):null;
 try{const response=await fetch('/api/browser/status',controller?{signal:controller.signal}:{});if(!response.ok)throw new Error('状态接口暂不可用');const result=await response.json();if(revision===state.browserRevision&&!state.browserOpening)renderBrowserStatus(result.status||result);}
 catch{if(revision===state.browserRevision&&!state.browserOpening)renderBrowserStatus({browser:'unknown',login:'unknown',message:'暂时无法确认浏览器与登录状态，可稍后刷新。'});}
 finally{if(timeout)clearTimeout(timeout);state.browserPolling=false;$('refresh-browser-status').disabled=state.browserOpening;scheduleBrowserStatus();}
}
function renderTaskControls(task){
 const launching=state.launching||!!state.commandAction,active=activeStatuses.has(task?.status),stopping=state.stopPending||state.stopAfterRequest||task?.status==='stopping';
 const finished=task?.status==='complete',waitingAPI=task?.status==='waiting_api';
 const canScore=task?.status!=='ready_analysis'&&!finished&&!active&&!launching&&(task?.collectionVersion===3||task?.rankingRequested)&&(waitingAPI||task?.phase==='score'||task?.phase==='rank');
 for(const id of ['pause-task','resume-task','cancel-task','expand-task','score-task','analyze-task','task-api-settings'])$(id).hidden=true;
 $('stop-current').hidden=!launching&&!active;$('pause-task').hidden=launching||!active||stopping;
 if(!task||launching||active||finished)return;
 $('task-api-settings').hidden=!(canScore&&!state.settings.configured);$('score-task').hidden=!(canScore&&state.settings.configured);$('score-task').textContent='继续 / 重试评分';
 $('resume-task').hidden=canScore||!['paused','cancelled','failed','waiting_user','partial'].includes(task.status);
 if(task.collectionVersion<3)$('expand-task').hidden=!['partial','ready_analysis'].includes(task.status);
 if(!rankingOnly(task))$('analyze-task').hidden=!task.selectedVideoIds?.length;
}
function updateSettings(settings) {
  const preserveDraft=state.settingsInitialized&&state.draftDirty;
  if(Array.isArray(settings.providers)&&settings.providers.length)state.providers=settings.providers;
  const info=providerInfo(settings.provider||'openai');
  state.settings={configured:!!settings.configured,model:settings.model||info.defaultModel,provider:info.id,baseURL:normalizedAddress(settings.baseURL||info.baseURL),persisted:!!settings.persisted,profiles:Array.isArray(settings.profiles)?settings.profiles:[]};
  if(state.settings.persisted&&!matchingProfile(state.settings))state.settings.profiles.push({provider:state.settings.provider,baseURL:state.settings.baseURL,model:state.settings.model,persisted:true});
  if(!preserveDraft){$('provider').replaceChildren(...state.providers.map(p=>Object.assign(el('option',p.label),{value:p.id})));configureDraft(state.settings.provider,state.settings.baseURL,state.settings.model);}
  state.settingsInitialized=true;updateDraftControls();
  $('start-notice').textContent=state.settings.configured?'API已配置 · 综合评分会产生API用量。':'无API先看点赞排名；待评分任务需使用其绑定配置继续。';
  if(settings.error)$('settings-message').textContent=settings.error;
  updateRuntimeControls();
  if(state.current)renderTask(state.current);
}
function renderTaskList() {
  const list=$('task-list');list.replaceChildren();
  if(!state.tasks.length){list.append(el('p','还没有调研记录。输入一个关键词，建立第一份研究。','muted'));return;}
  for(const task of state.tasks){const item=button('',()=>selectTask(task.id),`history-item ${task.id===state.selectedId?'selected':''}`);item.setAttribute('aria-pressed',String(task.id===state.selectedId));item.append(el('strong',task.keyword||'未命名任务'),el('span',`${labels[task.status]||task.status} · ${date(task.createdAt)}`));list.append(item);}
}
function renderAuthors(task) {
  if(task.collectionVersion===4&&!task.rankingRequested){
    const root=$('authors');root.replaceChildren();root.className='author-grid';
    for(const [i,a] of task.authors.entries()){
      const card=el('article',undefined,'author-card');card.append(el('span','出现顺序 '+(i+1),'eyebrow'),link(a.name||'昵称未获取',a.url));
      if(a.identity==='nickname'||a.identity==='truncated')card.append(el('p',a.identity==='truncated'?'昵称不完整 · 单独保留，待核对':'按昵称暂归组 · 主页链接未提供，同名可能不同人','helper'));const videos=task.videos.filter(v=>v.authorId===a.id);card.append(el('p','在本批视频中出现 '+videos.length+' 次','helper'));
      const evidence=el('details');evidence.append(el('summary','查看来源视频（'+videos.length+' 条）'));
      for(const v of videos){const row=el('p');row.append(link(v.title||'标题未获取',v.url));if(v.kind==='unknown')row.append(el('span',' · 类型未核实','muted'));evidence.append(row);}card.append(evidence);root.append(card);
    }
    if(!task.authors.length)root.append(el('p','尚未读取到可归属账号的卡片。','muted'));
    const missing=task.videos.filter(v=>!v.authorId);if(missing.length){const details=el('details');details.append(el('summary','缺少作者链接：'+missing.length+' 条'));for(const v of missing){const row=el('p');row.append(link(v.title||'标题未获取',v.url));details.append(row);}root.append(details);}return;
  }
  if(task.collectionVersion===3||task.collectionVersion===4&&task.rankingRequested){renderCandidateTable(task);return;}
  const root=$('authors');root.replaceChildren();
  root.className='author-grid';
  for(const rank of task.ranking||[]){const author=task.authors.find(a=>a.id===rank.authorId);if(!author)continue;
    const card=el('article',undefined,`author-card ${state.authorId===author.id?'selected':''}`);
    const rankedVideos=task.videos.filter(v=>rank.videoIds?.includes(v.id));
    const total=key=>!rankedVideos.length||rankedVideos.some(v=>v[key]?.value===null||v[key]?.value===undefined)?'未获取':`${number(rank[key])}${rankedVideos.some(v=>v[key].approximate)?'（约）':''}`;
    const approximate=rankedVideos.some(v=>['likes',...(task.mode==='likes'?[]:['favorites','shares'])].some(key=>v[key]?.approximate));
    const score=rankedVideos.length?`${number(rank.score)}${approximate?'（约）':''}`:'尚无可比较分';
    const choose=button('',()=>{state.authorId=state.authorId===author.id?null:author.id;renderTask(state.current);},'author-select');choose.setAttribute('aria-pressed',String(state.authorId===author.id));choose.append(el('span',`${rank.rank ? String(rank.rank).padStart(2,'0'):'—'} · ${rank.eligible?'完整可比较':'暂定候选'}`,'eyebrow'),el('h3',author.name),el('strong',score,'score'),el('span',task.mode==='likes'?'相关作品点赞累计':'本软件互动分','muted'));card.append(choose);
    card.append(badge(author.selectionComplete===true?`已核实近${scopeOf(task).days}天`:'主页卡片样本（范围暂定）',author.coverage==='complete'?'good':'warning'));
    const totals=el('p',`点赞 ${total('likes')} · 收藏 ${total('favorites')} · 分享 ${total('shares')}`,'helper');card.append(totals);
    card.append(el('p',`排名样本 ${rank.videoIds?.length||0} 条 · 账号已读取 ${number(author.fetchedCount)} 条`,'helper'));
    if(author.reason)card.append(el('p',author.reason,'helper'));
    for(const reason of rank.reasons||[])card.append(el('p',reason,'warning-text'));
    if(task.excludedAuthorIds?.includes(author.id))card.append(badge('已人工排除','warning'));
    else card.append(button('排除此歧义候选',()=>taskAction('exclude',{authorId:author.id}),'text-button'));
    card.append(link('打开作者主页 ↗',author.url,'source-link'));root.append(card);
  }
  if(!root.children.length)root.append(el('p','尚无可比较的作者；等待采集结果。','muted'));
}
const candidateSort={key:'compositeScore',direction:'descending'};
function scoreText(value){return typeof value==='number'&&Number.isFinite(value)?String(Math.round(value)):'未获取';}
function renderCandidateTable(task){
 const {profileLimit}=collectionScopeOf(task);
  const root=$('authors');root.replaceChildren();root.className='candidate-table-wrap';
  if(!task.authors?.length){root.append(el('p','尚无候选作者；等待采集结果。','muted'));return;}
  const scores=new Map((task.candidateScores||[]).map(s=>[s.authorId,s]));
  const rows=task.authors.map((author,index)=>({author,index,score:scores.get(author.id)}));const sorting=task.rankingRequested&&candidateSort.key==='compositeScore'&&!rows.some(r=>Number.isFinite(r.score?.compositeScore))?{key:'likesScore',direction:'descending'}:candidateSort;
  rows.sort((a,b)=>{const av=a.score?.[sorting.key],bv=b.score?.[sorting.key],ak=typeof av==='number'&&Number.isFinite(av),bk=typeof bv==='number'&&Number.isFinite(bv);if(!ak||!bk)return ak?-1:bk?1:a.index-b.index;return (sorting.direction==='ascending'?av-bv:bv-av)||a.index-b.index;});
  const table=el('table',undefined,'candidate-table');table.append(el('caption',`全部候选 ${rows.length} 位 · ${sorting.key==='likesScore'&&task.rankingRequested?'综合分待评，先按平均点赞从高到低':'默认综合分从高到低'}；点击分数列可切换排序。`));
  const head=el('thead'),header=el('tr');
  for(const [title,key] of [['全局综合名次'],['昵称 / 来源'],['相关分','relevanceScore'],['点赞分','likesScore'],['综合分','compositeScore'],['原始点赞 / 样本'],['状态 / 评分依据']]){
    const cell=el('th');cell.setAttribute('scope','col');if(key){cell.setAttribute('data-sort-key',key);cell.setAttribute('aria-sort',sorting.key===key?sorting.direction:'none');const control=button(`${title}${candidateSort.key===key?(candidateSort.direction==='ascending'?' ↑':' ↓'):' ↕'}`,()=>{candidateSort.direction=candidateSort.key===key&&candidateSort.direction==='ascending'?'descending':'ascending';candidateSort.key=key;renderCandidateTable(task);},'sort-button');control.setAttribute('data-sort-key',key);cell.append(control);}else cell.textContent=title;header.append(cell);
  }
  head.append(header);table.append(head);const body=el('tbody');
  for(const {author,score} of rows){
    const row=el('tr');row.setAttribute('data-author-id',author.id);if(state.authorId===author.id)row.className='viewing';
    row.append(el('td',score?.rank||'—'));
    const identity=el('td');identity.append(link(author.profileName||author.name||'昵称未获取',author.url),el('p',`来源：${(author.sourceSorts||[]).map(s=>({likes:'点赞',combined:'综合'})[s]||s).join('、')||'未获取'}`,'helper'));row.append(identity);
    for(const key of ['relevanceScore','likesScore','compositeScore'])row.append(el('td',scoreText(score?.[key]),'numeric'));
    const raw=el('td');raw.append(el('p',`均值 ${number(score?.meanLikes)} · 总和 ${number(score?.totalLikes)} · 最高 ${number(score?.maxLikes)}`),el('p',`已知点赞 / 样本 ${number(score?.knownLikesCount)} / ${number(score?.sampleCount)}`,'helper'));row.append(raw);
    const evidence=el('td');const excluded=score?.excluded||task.excludedAuthorIds?.includes(author.id);const complete=typeof score?.compositeScore==='number'&&Number.isFinite(score.compositeScore);
    evidence.append(badge(excluded?'已人工标记排除':complete?'已评分':'待评分 / 数据不足',!excluded&&complete?'good':'warning'));
    if(task.profileRanking&&!complete){const sampling=author.profileCollected?`主页已采 ${number(author.profileSampleIds?.length||0)} 条 · 待评分`:author.identity==='account'?`主页已核实 · 待采集主页前${profileLimit}条`:'待核实作者主页';evidence.append(el('p',sampling,'helper'));}
    const details=el('details');details.append(el('summary',task.collectionVersion===4&&!task.profileRanking?'搜索样本与评分依据':`简介与前${profileLimit}条评分依据`),el('p',`简介：${author.bio||'未获取'}`,'pre-line'),el('p',`简介方向分：${scoreText(author.relevance?.profileScore)}；${author.relevance?.reason||'相关性依据待获取'}`));
    if(score?.reason)details.append(el('p',score.reason));if(author.relevanceError)details.append(el('p',author.relevanceError,'warning-text'));
    const ids=author.profileSampleIds||score?.videoIds||[];const samples=ids.slice(0,profileLimit).map(id=>task.videos.find(v=>v.id===id)).filter(Boolean);
    details.append(el('p',`主页样本：实际${samples.length}条 / 上限${profileLimit}条${samples.length<profileLimit?' · 不足上限，按实际样本评分':''}`,'helper'));
    const list=el('ol');for(const video of samples){const relevance=author.relevance?.videos?.find(v=>v.id===video.id);const item=el('li');item.append(link(video.title||'标题未获取',video.url),el('p',`点赞 ${metric(video.likes)} · 标题相关分 ${scoreText(relevance?.score)} · ${relevance?.reason||'标题依据待获取'}`,'helper'));list.append(item);}details.append(list);
    if(!samples.length)details.append(el('p',task.collectionVersion===4&&!task.profileRanking?'尚无搜索作品样本，未获取的数据不补零。':'尚无主页样本，未获取的数据不补零。','muted'));for(const warning of score?.warnings||[])details.append(el('p',warning,'warning-text'));
    if(author.identity==='nickname'||author.identity==='truncated')evidence.append(el('p','昵称暂归组，主页身份待核对','helper'));evidence.append(details);if(!excluded)evidence.append(button('排除此歧义候选',()=>taskAction('exclude',{authorId:author.id}),'text-button'));row.append(evidence);body.append(row);
  }
  table.append(body);root.append(table);
}
function renderAnalysis(video, parent) {
  if(!video.analysis){const reason=video.analysisError||video.analysisStatus||(state.settings.configured?'尚未生成可验证的分析。':'API 未配置，尚无 AI 分析。');parent.append(el('p',reason,'notice'));return;}
  const section=el('section',undefined,'analysis');section.append(el('h4','AI 判断 · 逐项查看依据'));
  const grid=el('dl',undefined,'claims');
  for(const [field,title] of Object.entries(claimLabels)){
    const claim=video.analysis[field];const row=el('div',undefined,'claim');row.append(el('dt',title));const content=el('dd');content.append(el('strong',claim?.value||'未知'));
    if(claim){content.append(badge(({high:'高置信度',medium:'中置信度',low:'低置信度'})[claim.confidence]||'置信度未知'));content.append(el('p',claim.explanation||'未提供解释','helper'));const evidence=el('p',undefined,'evidence-links');evidence.append(el('span','依据：'));
      if(!claim.evidence?.length)evidence.append(el('span','未提供，需人工核对'));
      for(const ref of claim.evidence||[]){const frame=video.frames?.find(f=>f.id===ref);if(frame){const a=el('a',`${ref} · ${Math.round(Number(frame.actualTime))}s`);a.href=`#frame-${encodeURIComponent(video.id)}-${encodeURIComponent(frame.id)}`;evidence.append(a);}else evidence.append(el('span',ref));}content.append(evidence);}
    row.append(content);grid.append(row);
  }
  section.append(grid);
  if(video.analysis.needsMoreFrames)section.append(el('p','当前证据不足，模型建议补采画面。补采仍受每条 / 每任务预算限制。','notice'));
  if(video.analysis.limitations?.length){const list=el('ul',undefined,'limitations');for(const text of video.analysis.limitations)list.append(el('li',text));section.append(el('h4','不确定性与限制'),list);}
  parent.append(section);
}
function renderVideo(task,video,index) {
  const card=el('article',undefined,'panel video-card');const head=el('div',undefined,'video-heading');head.append(el('span',String(index+1).padStart(2,'0'),'video-number'));const title=el('div');title.append(el('span',video.authorName||'作者待核实','eyebrow'),el('h3',video.title||'未获取标题'));head.append(title);card.append(head);
  const meta=el('div',undefined,'video-meta');meta.append(badge(video.related?'与原关键词相关':'账号全话题作品'),el('span',video.publishedAt?date(video.publishedAt):`日期待核实${video.dateText?`（页面：${video.dateText}）`:''}`),el('span',video.duration===null||video.duration===undefined?'时长未获取':`${video.duration} 秒`),link('原作品 ↗',video.url));card.append(meta);if(!video.rankingSnapshot?.publishedAt&&!video.publishedAt)card.append(el('p','日期未核实：按主页可见点赞进入暂定排名，不能保证属于所选时间范围。','notice'));if(video.rankingSnapshot)card.append(el('p',`主页排名快照点赞：${metric(video.rankingSnapshot.likes)}；详情更新不自动改榜或补位。`,'helper'));
  const metrics=el('dl',undefined,'video-metrics');for(const [label,key] of [['点赞','likes'],['收藏','favorites'],['分享','shares']]){const item=el('div');item.append(el('dt',label),el('dd',metric(video[key])));metrics.append(item);}card.append(metrics,el('p',`指标采集时间：${date(video.collectedAt)}；缩写数值保留近似口径。`,'helper'));
  if(video.description){const detail=el('details');detail.append(el('summary','作品公开文字'),el('p',video.description,'pre-line'));card.append(detail);}
  const evidence=el('section',undefined,'frame-section');evidence.append(el('h4',`画面证据 · ${video.frames?.length||0} 张`));
  if(video.samplingError)evidence.append(el('p',video.samplingError,'notice'));
  const frames=el('div',undefined,'frame-grid');
  for(const frame of video.frames||[]){const figure=el('figure');figure.id=`frame-${encodeURIComponent(video.id)}-${encodeURIComponent(frame.id)}`;const a=el('a');a.href=`/api/tasks/${encodeURIComponent(task.id)}/frames/${encodeURIComponent(frame.file)}`;a.target='_blank';a.rel='noopener';const img=el('img');img.setAttribute('src',a.href);img.setAttribute('alt',`${video.title||'作品'}，实际 ${Math.round(Number(frame.actualTime))} 秒，证据 ${frame.id}`);img.setAttribute('loading','lazy');a.append(img);figure.append(a,el('figcaption',`${frame.id} · 实际 ${Math.round(Number(frame.actualTime))}s / 目标 ${Math.round(Number(frame.targetTime))}s${frame.duplicateOf?` · 重复于 ${frame.duplicateOf}`:''}`));frames.append(figure);}
  evidence.append(frames);if(!video.frames?.length)evidence.append(el('p','尚无可用截图。未取得画面不代表作品没有内容。','muted'));evidence.append(button('补采代表画面',()=>taskAction('sample',{videoId:video.id}),'text-button'));card.append(evidence);
  renderAnalysis(video,card);
  const notes=el('form',undefined,'manual-note');const label=el('label','人工备注（与 AI 判断分开保留）');label.setAttribute('for',`note-${video.id}`);const input=el('textarea');input.id=`note-${video.id}`;input.rows=3;input.maxLength=5000;input.value=state.noteDrafts.get(`${task.id}:${video.id}`)??video.manualNote??'';input.setAttribute('placeholder','记录你的核对结果、标签或可借鉴做法…');input.addEventListener('input',()=>state.noteDrafts.set(`${task.id}:${video.id}`,input.value));const save=el('button','保存备注');save.type='submit';notes.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;await taskAction('note',{videoId:video.id,note:input.value});save.disabled=false;});notes.append(label,input,save);card.append(notes);return card;
}
const runSteps=[['search','搜索候选'],['collect','采集作品'],['rank','账号评分 / 计算排名'],['sample','画面采样'],['analyze','AI 分析'],['summary','汇总报告']];
function currentStep(task){return ({search:'search',authors:'collect',metrics:'collect',score:'rank',rank:'rank',sample:'sample',analyze:'analyze',summary:'summary'})[task?.phase]||({searching:'search',collecting:'collect',sampling:'sample',analyzing:'analyze'})[task?.status]||'search';}
function updateRunClock(){
  if(state.clockTimer)clearTimeout(state.clockTimer);state.clockTimer=null;const task=state.current,active=state.launching||activeStatuses.has(task?.status);const start=state.launching?state.launchStartedAt:Date.parse(task?.runStartedAt||task?.updatedAt||task?.createdAt);const elapsed=Math.max(0,Math.floor((Date.now()-start)/1000));const age=Math.max(0,Math.floor((Date.now()-Date.parse(task?.updatedAt||task?.createdAt))/1000));
  $('run-clock').textContent=active?`已运行 ${Math.floor(elapsed/60)}分${elapsed%60}秒${!state.launching&&age>=20?' · '+age+'秒暂无新进度，正在等待浏览器或模型返回':''}`:'自动运行已停止';
  if(active)state.clockTimer=setTimeout(updateRunClock,1000);
}
function renderRun(task){
  const launching=state.launching||!!state.commandAction;const active=activeStatuses.has(task?.status);const step=currentStep(task),index=runSteps.findIndex(s=>s[0]===step);$('run-console').hidden=!task&&!launching;if(!task&&!launching){if(state.clockTimer)clearTimeout(state.clockTimer);return;}
  $('task-progress').className='panel progress-panel'+(state.launching?' is-launching':'');
  if(state.launching){$('task-progress').hidden=false;$('task-title').textContent=`新任务：${$('keyword').value.trim()||'正在准备'}`;$('task-status').textContent='正在创建';const launchScope=state.launchScope||collectionScopeOf(null);$('task-window').textContent=`搜索前${launchScope.searchLimit}条 · 每位主页前${launchScope.profileLimit}条 · 正在建立新任务。`;}
  $('run-state').textContent=state.stopAfterRequest?'已收到停止请求':launching?'正在启动':labels[task.status]||task.status;
  $('run-console').className='run-console '+(active&&task?.status!=='stopping'?'is-running':'');
  const {searchLimit,profileLimit}=state.launching?(state.launchScope||collectionScopeOf(null)):collectionScopeOf(task);
  const simple=!state.launching&&task?.collectionVersion===4&&!task.rankingRequested;const count=simple?2:state.launching||rankingOnly(task)?3:6;const steps=simple?[['search',`读取前${searchLimit}条视频`],['collect','博主去重']]:task?.collectionVersion===4?[['search',`读取前${searchLimit}条视频`],['collect',task?.profileRanking?`核实主页 / 前${profileLimit}条采样`:'博主去重'],['rank','账号评分 / 计算排名']]:runSteps;
  $('run-stage').textContent=launching?'准备任务 · 正在获取运行确认':`步骤 ${Math.min(index+1,count)}/${count} · ${steps[Math.min(index,count-1)][1]}`;
  $('run-detail').textContent=state.stopAfterRequest?'正在确认任务编号，收到启动确认后立即停止，不会继续下一步。':launching?'请求已提交，正在等待本机服务返回任务编号…':task.message||'等待下一步操作';
  const p=launching?{}:task.progress||{};$('run-count').textContent=Number.isFinite(p.completed)?`本步骤：已处理 ${p.completed}${Number.isFinite(p.total)?' / '+p.total:''} ${p.unit||''}`:'本步骤总量尚未确定，以实时日志为准';
  const meter=$('run-progress');if(Number.isFinite(p.total)&&p.total>0){meter.max=p.total;meter.value=Math.min(p.completed||0,p.total);}else{meter.removeAttribute('value');meter.hidden=!active&&!launching;}if(Number.isFinite(p.total)&&p.total>0)meter.hidden=false;
  for(const [i,[key]] of runSteps.entries()){const node=$('run-step-'+key);node.hidden=i>=count;node.textContent=steps[i]?.[1]||runSteps[i][1];node.className=key===step?'current':'';if(key===step)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');}
  const events=$('run-events');const logKey=state.launching?'launch:'+state.launchStartedAt:task?.id;const oldOffset=events.scrollTop||0;const followLatest=state.runLogKey!==logKey||events.scrollHeight-events.clientHeight-oldOffset<=24;state.runLogKey=logKey;events.replaceChildren();for(const event of (state.launching?[]:task?.events||[])){const item=el('li');item.append(el('time',date(event.at)),el('span',event.message));events.append(item);}
  if(!events.children.length)events.append(el('li',launching?'正在创建任务…':'暂无执行日志。'));
  events.scrollTop=followLatest?events.scrollHeight:oldOffset;
  $('stop-current').disabled=state.stopPending||state.stopAfterRequest||task?.status==='stopping'||(!launching&&['cancelled','complete','failed'].includes(task?.status));$('stop-current').textContent=state.stopPending||state.stopAfterRequest||task?.status==='stopping'?'正在停止…':'■ 停止当前任务';renderTaskControls(task);updateRunClock();
}
async function stopCurrent(){if(state.launching){state.stopAfterRequest=true;renderRun(state.current);return;}if(state.commandAction)state.stopAfterRequest=true;return taskAction('cancel');}
function renderTask(task) {
  state.current=task;
  for(const id of ['task-progress','author-section','export-panel'])$(id).hidden=!task;
  $('summary-panel').hidden=!task?.summary;
  if(!task){renderRun(null);$('authors').replaceChildren();const blank=el('div',undefined,'panel empty-state');blank.append(el('span','从一个关键词开始','eyebrow'),el('h2','尚无调研任务'),el('p','在上方输入话题，建立基于真实作品与画面证据的研究。这里不会预填演示榜单。'));$('report').replaceChildren(blank);updateRuntimeControls();return;}
  $('task-title').textContent=task.keyword;
  $('task-status').textContent=labels[task.status]||task.status;
  $('task-status').className=`badge ${task.status==='complete'?'good':activeStatuses.has(task.status)?'working':'warning'}`;
  $('task-message').textContent=task.message||'等待下一步操作';
  const scope=scopeOf(task),{searchLimit,profileLimit}=collectionScopeOf(task);
  $('task-window').textContent=task.profileRanking?`搜索前${searchLimit}条 · 每位主页前${profileLimit}条 · 全部候选排名 · 支持断点续跑`:task.collectionVersion===4&&task.rankingRequested?'搜索样本评分 · 全部候选排名':task.collectionVersion===4?`搜索前${searchLimit}条 · 按账号去重 · 保留来源`:task.collectionVersion===3?`搜索固定半年内＋视频 · ${task.limits?.policy==='combined50'?'综合排序前50条，去重全部入池（最多50位）':'旧双路各50条（继续时切换综合前50），去重全部入池（最多100位）'}；每主页前12条及简介评分，全部候选按综合分排序，不再筛选前几名。`:`近 ${scope.days} 天 · ${scope.authorCount} 位博主 × 每位最多 ${scope.videosPerAuthor} 条；固定窗口：${date(task.cutoff)} — ${date(task.createdAt)}（北京时间）`;
  const stats=$('coverage-stats');stats.replaceChildren();
  const counts=task.collectionVersion===4?[[(task.searchVideoIds?.length??task.videos?.length)||0,`搜索视频 / 上限${searchLimit}`],[task.authors?.length||0,'作者候选'],[task.videos.filter(v=>!v.authorId).length,'未识别作者'],[task.errors?.length||0,'记录问题']]:[[task.videos?.length||0,'采集作品'],[task.authors?.length||0,'候选作者'],[task.collectionVersion===3?(task.candidateScores||[]).filter(r=>Number.isFinite(r.compositeScore)).length:task.ranking?.filter(r=>r.eligible).length||0,task.collectionVersion===3?'已获综合分':'完整可比较'],[task.totalFrames||0,'证据截图'],[task.errors?.length||0,'记录问题']];for(const [value,label] of counts){const stat=el('div');stat.append(el('strong',value),el('span',label));stats.append(stat);}
  $('task-mode').value='likes';$('analyze-task').textContent=`分析入选作品（${task.selectedVideoIds?.length||0} 条）`;
  const active=activeStatuses.has(task.status);
  $('pause-task').disabled=state.stopPending||!active||task.status==='stopping';$('cancel-task').disabled=state.stopPending||task.status==='stopping'||['cancelled','complete'].includes(task.status);
  for(const id of ['resume-task','expand-task','recompute-task','analyze-task'])$(id).disabled=state.pending||active;
  $('analyze-task').disabled=state.pending||active||!state.settings.configured||!task.selectedVideoIds?.length;
  $('analyze-task').hidden=rankingOnly(task);$('show-all').hidden=rankingOnly(task);$('report').hidden=rankingOnly(task);$('summary-panel').hidden=rankingOnly(task)||!task.summary;
  $('expand-task').hidden=task.collectionVersion>=3;$('score-task').hidden=task.collectionVersion!==3&&!(task.collectionVersion===4&&task.rankingRequested);$('score-task').disabled=state.pending||active||!state.settings.configured;
  $('rank-controls').hidden=task.collectionVersion>=3;$('recompute-task').hidden=task.collectionVersion>=3;$('task-mode').hidden=task.collectionVersion>=3;$('task-mode-label').hidden=task.collectionVersion>=3;
  $('authors-title').textContent=task.rankingRequested?'全部候选与排名':task.collectionVersion===4?'去重后的博主':'博主比较';$('scoring-details').textContent=task.profileRanking?`依据作者主页昵称、简介与前${profileLimit}条视频标题评相关度（简介20%＋标题80%），再与主页样本平均点赞结合，综合分＝相关70%＋点赞30%。主页当前前${profileLimit}条含置顶；不以搜索样本代替，不足${profileLimit}条或字段缺失按实际说明。`:task.collectionVersion===4&&task.rankingRequested?`评分仅依据本批搜索作品标题与点赞，非主页${profileLimit}条样本；相关70%＋点赞30%。未配置API时先按平均点赞排序；缺分不补零。昵称归组身份仍待核对。`:task.collectionVersion===4?'按首次出现顺序展示。有主页链接按账号去重；无链接按昵称暂归组，同名可能不同人。展开可核对来源视频。':task.collectionVersion===3?'相关分＝简介方向分20%＋标题语义分均值80%；缺简介按标题计分并降低证据充分度。点赞分＝100 × log1p(已知样本平均点赞) / log1p(本批最大均值)，全零为0；综合分＝相关70%＋点赞30%。缺值不补零，缺任一分综合为空并排末。主页当前前12条含置顶，并非最高赞12条；标题/简介不能证明视频完整内容，点赞缩写可能近似。':'旧版任务：按已采集话题作品点赞排名，保留原始口径；继续采集将重新应用新版规则。';
  $('scoring-method').textContent=task.rankingRequested||task.collectionVersion===3?'综合分＝相关度70%＋点赞30%。点击列头排序，展开查看依据。':'点击昵称查看主页，展开查看来源。';
  const log=$('task-log');log.replaceChildren();for(const error of task.errors||[])log.append(el('p',error,'warning-text'));for(const event of (task.events||[]))log.append(el('p',`${date(event.at)} · ${event.message}`,'helper'));if(!log.children.length)log.append(el('p','尚无问题或运行记录。','muted'));
  renderAuthors(task);
  // Do not replace a textarea while the user is typing during background progress.
  if(document.activeElement?.tagName!=='TEXTAREA'){
    const report=$('report');report.replaceChildren();const heading=el('div',undefined,'report-heading');heading.append(el('span','第二阶段 · 账号全话题高赞作品','eyebrow'),el('h2',state.authorId?`${task.authors.find(a=>a.id===state.authorId)?.name||'已选作者'}的作品`:'入选作品与证据'));report.append(heading);
    const selected=new Set(task.selectedVideoIds||[]);const videos=(task.videos||[]).filter(v=>selected.has(v.id)&&(!state.authorId||v.authorId===state.authorId));
    if(!videos.length)report.append(el('p','尚无入选作品。候选、账号覆盖或点赞数据不足时，保留真实缺口，不补造作品。','panel empty-state'));
    const authorsShown=new Set();let index=0;
    for(const video of videos){if(!authorsShown.has(video.authorId)){const author=task.authors.find(a=>a.id===video.authorId);report.append(el('p',`${author?.name||video.authorName} · ${task.collectionVersion===3?'主页前12条样本内按点赞入选（非账号完整最高赞）':author?.selectionComplete===true?`账号近${scope.days}天点赞前${scope.videosPerAuthor===5?'五':scope.videosPerAuthor}`:`已采集作品内点赞前${scope.videosPerAuthor===5?'五':scope.videosPerAuthor}`}${author?.reason?` · ${author.reason}`:''}`,'coverage-note'));authorsShown.add(video.authorId);}report.append(renderVideo(task,video,++index));}
  }
  updateRuntimeControls();
  $('task-summary').textContent=task.summary||'';
  $('export-md').href=`/api/tasks/${encodeURIComponent(task.id)}/export?format=md`;$('export-csv').href=`/api/tasks/${encodeURIComponent(task.id)}/export?format=csv`;
  renderRun(task);
}
async function loadBootstrap() { const result=await api('/api/bootstrap');applyRuntimeVersion(result.build);state.token=result.token;state.tasks=Array.isArray(result.tasks)?result.tasks:[];updateSettings({...result.settings,...(result.providers?{providers:result.providers}:{})});renderTaskList();return result; }
function stopPolling(){if(state.pollTimer)clearTimeout(state.pollTimer);state.pollTimer=null;}
function schedulePoll(){stopPolling();if(state.current&&activeStatuses.has(state.current.status))state.pollTimer=setTimeout(pollSelected,1800);}
async function pollSelected(){
  if(state.polling||!state.selectedId)return;state.polling=true;const id=state.selectedId;const version=state.selectionVersion;
  try{const task=await api(`/api/tasks/${encodeURIComponent(id)}`);if(id===state.selectedId&&version===state.selectionVersion){renderTask(task);const i=state.tasks.findIndex(t=>t.id===id);if(i>=0)state.tasks[i]=task;renderTaskList();}}
  catch(error){if(id===state.selectedId)showError(error);}finally{state.polling=false;schedulePoll();}
}
async function selectTask(id){stopPolling();state.selectedId=id;state.authorId=null;candidateSort.key='compositeScore';candidateSort.direction='descending';state.current=null;renderTask(null);const version=++state.selectionVersion;clearError();renderTaskList();$('report').replaceChildren(el('p','正在读取任务…','panel empty-state'));try{const task=await api(`/api/tasks/${encodeURIComponent(id)}`);if(version!==state.selectionVersion)return;renderTask(task);schedulePoll();}catch(error){if(version===state.selectionVersion){renderTask(null);showError(error);}}}
async function taskAction(action, fields={}) {
  const stop=action==='pause'||action==='cancel';if(!state.selectedId||(!stop&&state.pending)||(stop&&state.stopPending))return;
  if(action==='analyze'&&!confirm(`将向任务绑定的 API 厂商发送本次公开作品文字与代表截图，可能产生 API 费用；是否支持图像以实际响应为准。继续分析？`))return;
  clearError();if(stop)state.stopPending=true;else{state.pending=true;state.commandAction=['resume','expand','score','analyze','sample'].includes(action)?action:null;}if(state.current)renderTask(state.current);const id=state.selectedId;
  try{let result=await api(`/api/tasks/${encodeURIComponent(id)}/action`,{action,...fields});if(!stop&&state.stopAfterRequest){result=await api(`/api/tasks/${encodeURIComponent(id)}/action`,{action:'cancel'});state.stopAfterRequest=false;}if(!stop)state.commandAction=null;if(id===state.selectedId){if(result?.id)renderTask(result);await pollSelected();}}
  catch(error){showError(error);}finally{if(stop)state.stopPending=false;else{state.pending=false;state.commandAction=null;}if(state.current)renderTask(state.current);schedulePoll();}
}
function bindEvents(){
  $('stop-current').addEventListener('click',stopCurrent);
  $('model').addEventListener('change',()=>{state.draftDirty=true;state.draftRevision++;state.modelListRevision++;updateModelField();updateDraftControls();});
  for(const id of ['custom-model','api-key'])$(id).addEventListener('input',()=>{state.draftDirty=true;state.draftRevision++;state.modelListRevision++;updateDraftControls();});
  $('provider').addEventListener('change',()=>{state.draftDirty=true;state.draftRevision++;const provider=$('provider').value;const profile=state.settings.profiles?.find(p=>p.provider===provider);configureDraft(provider,profile?.baseURL,profile?.model);});
  $('endpoint-select').addEventListener('change',()=>{const custom=$('endpoint-select').value==='custom';$('address-advanced').hidden=!custom;$('base-url').value=custom?'':$('endpoint-select').value;addressChanged();});
  $('base-url').addEventListener('input',addressChanged);
  $('fetch-models').addEventListener('click',fetchModels);
  $('endpoint-confirmed').addEventListener('change',()=>{state.draftDirty=true;state.draftRevision++;updateDraftControls();});
  updateScopeEstimate();
  $('settings-toggle').addEventListener('click',()=>{const hidden=!$('settings-panel').hidden;$('settings-panel').hidden=hidden;$('settings-toggle').setAttribute('aria-expanded',String(!hidden));});
  $('settings-form').addEventListener('submit',async event=>{
    event.preventDefault();const config=draftConfig(),apiKey=$('api-key').value.trim(),revision=state.draftRevision;clearError();
    if(config.provider==='custom'&&!matchingProfile()&&!$('endpoint-confirmed').checked){showError('请先确认自定义地址可接收此密钥。');return;}
    const payload={...config};if(apiKey)payload.apiKey=apiKey;if(config.provider==='custom')payload.endpointConfirmed=!!$('endpoint-confirmed').checked;
    $('api-key').value='';$('settings-save').disabled=true;
    try{const result=await api('/api/settings',payload);state.draftDirty=revision!==state.draftRevision;updateSettings(result.settings||result);if(state.current?.rankingRequested){await pollSelected();schedulePoll();}if(revision===state.draftRevision)$('settings-message').textContent=state.settings.persisted?'此配置已加密保存。仅配置匹配的等待任务可接续；其他任务请查看状态并继续。文字测试和评分会产生 API 用量。':'设置已更新，但服务未确认永久保存。';}
    catch(error){if(revision===state.draftRevision)showError(error);}finally{$('settings-save').disabled=!state.runtimeCompatible;updateDraftControls();}
  });
  $('clear-api').addEventListener('click',async()=>{const c=draftConfig(),revision=state.draftRevision;if(!matchingProfile(c))return;clearError();$('api-key').value='';try{const result=await api('/api/settings',{clear:true,provider:c.provider,baseURL:c.baseURL});state.draftDirty=revision!==state.draftRevision;updateSettings(result.settings||result);if(revision===state.draftRevision){$('settings-message').textContent='已清除此厂商及地址的本机密钥，其他配置保留。';$('api-notice').hidden=true;}}catch(error){if(revision===state.draftRevision)showError(error);}});
  $('test-api').addEventListener('click',async()=>{
    if(!state.settings.configured||draftDiffers()||!state.runtimeCompatible)return;
    if(!confirm('文字连接测试会向 '+providerInfo(state.settings.provider).label+' 发起 API 请求，可能产生费用。继续？'))return;
    const revision=state.draftRevision;$('test-api').disabled=true;clearError();
    try{const result=await api('/api/settings/test',{});if(revision!==state.draftRevision)return;$('settings-message').textContent=result.message||(result.ok?'文字连接成功':'文字连接未通过');if(result.ok){$('settings-panel').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');$('api-notice').textContent=providerInfo(state.settings.provider).label+' 文字连接测试成功（未验证图像能力），设置已收起；可点击 API 设置修改。';$('api-notice').hidden=false;}}
    catch(error){if(revision===state.draftRevision)showError(error);}finally{updateDraftControls();}
  });
  $('open-browser').addEventListener('click',async()=>{if(state.browserOpening)return;state.browserOpening=true;state.browserRevision++;renderBrowserStatus({browser:'opening',login:'unknown',message:'正在打开采集浏览器，请稍候…'});clearError();try{const result=await api('/api/browser/open',{});renderBrowserStatus(result.status||{browser:'unknown',login:'unknown',message:'打开请求已完成，正在确认页面状态。'});}catch(error){showError(error);renderBrowserStatus({browser:'unknown',login:'unknown',message:'打开未完成，请重试。'});}finally{state.browserOpening=false;renderBrowserStatus(state.browserStatus);await refreshBrowserStatus();}});
  $('refresh-browser-status').addEventListener('click',refreshBrowserStatus);
  $('task-api-settings').addEventListener('click',()=>{$('settings-panel').hidden=false;$('settings-toggle').setAttribute('aria-expanded','true');$('settings-panel').scrollIntoView?.({behavior:'smooth',block:'start'});});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){if(state.browserTimer)clearTimeout(state.browserTimer);state.browserTimer=null;}else refreshBrowserStatus();});
  $('task-form').addEventListener('submit',async event=>{event.preventDefault();if(state.launching)return;const keyword=$('keyword').value.trim();if(!keyword)return;let collectionScope;try{collectionScope=readCollectionScope();}catch(error){showError(error);return;}const payload={keyword,mode:$('mode').value,options:readResearchOptions(),collectionScope};state.launchScope={...collectionScope};$('start-task').disabled=true;state.launching=true;state.launchStartedAt=Date.now();state.stopAfterRequest=false;renderRun(state.current);$('run-console').scrollIntoView?.({behavior:'smooth',block:'start'});clearError();try{const result=await api('/api/tasks',payload);const task=result.task||result;if(state.stopAfterRequest)await api(`/api/tasks/${encodeURIComponent(task.id)}/action`,{action:'cancel'});state.launching=false;state.stopAfterRequest=false;await loadBootstrap();await selectTask(task.id);}catch(error){showError(error);}finally{state.launching=false;state.stopAfterRequest=false;$('start-task').disabled=!state.runtimeCompatible;renderTask(state.current);}});
  for(const id of ['search-limit','profile-limit'])$(id).addEventListener('input',updateScopeEstimate);
  updateScopeEstimate();
  $('refresh-tasks').addEventListener('click',async()=>{try{await loadBootstrap();if(state.selectedId)await pollSelected();}catch(error){showError(error);}});
  for(const [id,action] of [['pause-task','pause'],['resume-task','resume'],['cancel-task','cancel'],['expand-task','expand'],['score-task','score'],['analyze-task','analyze']])$(id).addEventListener('click',()=>taskAction(action));
  $('recompute-task').addEventListener('click',()=>taskAction('recompute',{mode:$('task-mode').value}));
  $('show-all').addEventListener('click',()=>{state.authorId=null;renderTask(state.current);});
}
async function initialize(){bindEvents();applyRuntimeVersion(undefined);renderTask(null);renderBrowserStatus(null);void refreshBrowserStatus();try{await loadBootstrap();if(state.tasks.length)await selectTask(state.tasks[0].id);}catch(error){showError(error);$('task-list').replaceChildren(el('p','无法读取本机任务，请确认服务连接后点击刷新。','muted'));}}
document.addEventListener('DOMContentLoaded',initialize);
