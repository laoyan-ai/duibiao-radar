import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// A small DOM boundary double keeps these offline tests independent of Chrome/login.
class Element {
  tagName:string; children:Element[]=[]; attributes:Record<string,string>={}; listeners:Record<string,Function>={};
  scrollTop=0;clientHeight=200;get scrollHeight(){return this.children.length*30;}
  value=''; disabled=false; hidden=false; className=''; id=''; text=''; type=''; href='';
  constructor(tag='div'){this.tagName=tag;}
  set textContent(value:string){this.text=String(value ?? '');this.children=[];}
  get textContent():string{return this.text+this.children.map(c=>c.textContent).join('');}
  append(...children:Element[]){this.children.push(...children);}
  replaceChildren(...children:Element[]){this.text='';this.children=children;}
  setAttribute(k:string,v:string){this.attributes[k]=String(v);}
  removeAttribute(k:string){delete this.attributes[k];}
  addEventListener(k:string,fn:Function){this.listeners[k]=fn;}
  reset(){this.value='';}
}
async function page(){
  const ids=new Map<string,Element>();
  const document={getElementById(id:string){if(!ids.has(id))ids.set(id,new Element());return ids.get(id)!;},createElement:(tag:string)=>new Element(tag),addEventListener(){}};
  const calls:{url:string;options:any}[]=[];
  const context=vm.createContext({document,URL,Date,Intl,console,encodeURIComponent,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,fetch:async(url:string,options:any)=>{calls.push({url,options});return {ok:true,json:async()=>({configured:true,model:'vision-model'})};}});
  const code=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  document.getElementById('search-limit').value='50';document.getElementById('profile-limit').value='12';
  vm.runInContext(code,context);
  vm.runInContext("applyRuntimeVersion('2026-11-14-brand-assets-1')",context);
  return {context,ids,document,calls,run:(source:string)=>vm.runInContext(source,context)};
}
const metric={raw:null,value:null,approximate:false};
test('search ranking shows third scoring step and sorts available likes before API is configured',async()=>{
 const p=await page();const fixture={...task,collectionVersion:4,rankingRequested:true,rankingOnly:true,status:'waiting_api',phase:'score',authors:[{...task.authors[0],id:'a1',name:'少赞',identity:'nickname'},{...task.authors[0],id:'a2',name:'多赞',identity:'nickname'}],candidateScores:[{authorId:'a1',relevanceScore:null,compositeScore:null,likesScore:30,meanLikes:10,warnings:[]},{authorId:'a2',relevanceScore:null,compositeScore:null,likesScore:100,meanLikes:100,warnings:[]}],selectedVideoIds:[]};
 p.context.fixture=fixture;p.run('renderTask(fixture)');assert.match(p.document.getElementById('run-stage').textContent,/3\/3.*评分/);assert.equal(p.document.getElementById('score-task').hidden,true);assert.equal(p.document.getElementById('task-api-settings').hidden,false);assert.equal(p.document.getElementById('score-task').disabled,true);
 const rows=walk(p.document.getElementById('authors')).filter(e=>e.attributes['data-author-id']);assert.equal(rows[0].attributes['data-author-id'],'a2');assert.match(p.document.getElementById('authors').textContent,/先按平均点赞/);assert.match(p.document.getElementById('authors').textContent,/昵称暂归组/);
});
test('raw50 UI shows authors and source videos, two steps, no model actions or ranking',async()=>{
 const p=await page();const fixture={...task,collectionVersion:4,rankingOnly:true,phase:'authors',status:'complete',candidateScores:[],ranking:[],selectedVideoIds:[]};
 p.context.fixture=fixture;p.run('renderTask(fixture)');
 assert.match(p.document.getElementById('authors').textContent,/出现顺序 1/);assert.match(p.document.getElementById('authors').textContent,/查看来源视频/);
 assert.match(p.document.getElementById('run-stage').textContent,/2\/2.*博主去重/);
 for(const id of ['score-task','analyze-task','expand-task','recompute-task','task-mode','report'])assert.equal(p.document.getElementById(id).hidden,true,id);
 assert.equal(p.document.getElementById('resume-task').disabled,false);assert.equal(p.document.getElementById('run-step-rank').hidden,true);
 assert.doesNotMatch(p.document.getElementById('coverage-stats').textContent,/综合分|证据截图/);
});
test('model picker defaults to Sol and fixed collection scope estimates selected work',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.match(html,/<select[^>]*id="model"/);assert.match(html,/value="gpt-6.1-sol" selected/);for(const id of ['days','custom-days','scope-estimate'])assert.ok(html.includes(`id="${id}"`));for(const id of ['author-count','videos-per-author'])assert.ok(!html.includes(`id="${id}"`));
 const p=await page();p.run('updateSettings({configured:false,model:""})');assert.equal(p.document.getElementById('model').value,'gpt-6.1-sol');
 p.document.getElementById('author-count').value='3';p.document.getElementById('videos-per-author').value='2';p.document.getElementById('days').value='30';p.run('updateScopeEstimate()');assert.match(p.document.getElementById('scope-estimate').textContent,/搜索前50条/);assert.match(p.document.getElementById('scope-estimate').textContent,/每位主页12条/);
 p.document.getElementById('days').value='custom';p.document.getElementById('custom-days').value='45';p.run('updateScopeEstimate()');assert.equal(p.document.getElementById('custom-days-field').hidden,true);assert.equal(p.run('Object.keys(readResearchOptions()).length'),0);
});
test('new task submits search defaults without date constraint and preserves custom model',async()=>{
 const p=await page();p.run('bindEvents()');p.document.getElementById('keyword').value='FDE';p.document.getElementById('author-count').value='3';p.document.getElementById('videos-per-author').value='2';p.document.getElementById('days').value='custom';p.document.getElementById('custom-days').value='45';
 await p.document.getElementById('task-form').listeners.submit({preventDefault(){}});const request=p.calls.find(c=>c.url==='/api/tasks');assert.ok(request);assert.deepEqual(JSON.parse(request.options.body).options,{});assert.deepEqual(JSON.parse(request.options.body).collectionScope,{searchLimit:50,profileLimit:12});
 p.run('updateSettings({configured:true,model:"old-image-model"})');assert.equal(p.document.getElementById('model').value,'custom');assert.equal(p.document.getElementById('custom-model').value,'old-image-model');assert.equal(p.document.getElementById('custom-model-field').hidden,false);
});
const task={id:'task-1',keyword:'FDE',createdAt:'2026-11-13T01:00:00Z',cutoff:'2026-08-15T01:00:00Z',status:'partial',phase:'collecting',message:'需要本人登录',mode:'engagement',limits:{searchPerSort:100,maxSearchVideos:200,maxAuthors:20,profileMax:300},videos:[{id:'v1',authorId:'a1',authorName:'作者',authorUrl:'https://www.douyin.com/user/a1',url:'javascript:alert(1)',title:'<img src=x onerror=alert(1)>',description:'公开描述',dateText:'3月前',publishedAt:null,duration:10,likes:metric,favorites:metric,shares:metric,kind:'video',related:false,collectedAt:'2026-11-13T01:00:00Z',frames:[{id:'f1',file:'f1.jpg',targetTime:3,actualTime:3.2,width:720,height:1280}]}],authors:[{id:'a1',name:'作者',url:'https://www.douyin.com/user/a1',coverage:'partial',reason:'达到采集上限',fetchedCount:1}],ranking:[{authorId:'a1',score:0,likes:0,favorites:0,shares:0,videoIds:['v1'],eligible:false,reasons:['缺少分享数'],rank:1}],selectedVideoIds:['v1'],excludedAuthorIds:[],errors:[],events:[],searchDone:true,totalFrames:1,updatedAt:'2026-11-13T01:00:00Z'};

test('empty dashboard has no fabricated author or report',async()=>{
 const p=await page();p.run('renderTask(null)');
 assert.match(p.document.getElementById('report').textContent,/尚无调研任务/);
 assert.equal(p.document.getElementById('authors').children.length,0);
});
test('partial report preserves uncertainty and literal hostile text without unsafe links',async()=>{
 const p=await page();p.context.fixture=task;p.run('renderTask(fixture)');
 const text=p.document.getElementById('report').textContent;
 assert.match(text,/日期待核实/);assert.match(text,/未获取/);assert.match(text,/已采集作品内/);
 assert.match(text,/<img src=x onerror=alert\(1\)>/);assert.match(text,/实际 3s/);
 assert.match(p.document.getElementById('authors').textContent,/暂定/);
 const walk=(e:Element):Element[]=>[e,...e.children.flatMap(walk)];
 const nodes=walk(p.document.getElementById('report'));
 assert.ok(!nodes.some(e=>e.href.startsWith('javascript:')));
 assert.ok(!nodes.some(e=>e.tagName==='img'&&e.attributes.src==='x'));
});
test('mutations send session token and clear key input even on server error',async()=>{
 const p=await page();p.run("state.token='csrf-test'; state.settings={configured:false,model:''}");
 p.document.getElementById('api-key').value='secret-local';p.document.getElementById('model').value='vision-model';
 p.run('bindEvents()');await p.document.getElementById('settings-form').listeners.submit({preventDefault(){}});
 assert.equal(p.document.getElementById('api-key').value,'');
 assert.equal(p.calls[0].options.headers['x-session-token'],'csrf-test');
 assert.deepEqual(JSON.parse(p.calls[0].options.body),{provider:'openai',baseURL:'https://api.openai.com/v1',apiKey:'secret-local',model:'vision-model'});
 p.context.fetch=async()=>({ok:false,status:500,json:async()=>({error:'失败'})});
 p.document.getElementById('api-key').value='another-secret';
 await p.document.getElementById('settings-form').listeners.submit({preventDefault(){}});
 assert.equal(p.document.getElementById('api-key').value,'');
});
test('candidate missing interactions never displays fabricated zero totals',async()=>{
 const p=await page();p.context.fixture=task;p.run('renderTask(fixture)');
 assert.match(p.document.getElementById('authors').textContent,/点赞 未获取/);
 assert.match(p.document.getElementById('authors').textContent,/收藏 未获取/);
 const empty=structuredClone(task);empty.ranking[0].videoIds=[];p.context.fixture=empty;p.run('renderTask(fixture)');
 assert.match(p.document.getElementById('authors').textContent,/尚无可比较分/);
});
test('progress polling never overlaps and terminal status stops scheduling',async()=>{
 const p=await page();const fixture=structuredClone(task);fixture.status='collecting';p.context.fixture=fixture;
 p.run("state.current=fixture;state.selectedId='task-1'");let resolve:(value:any)=>void=()=>{};let count=0;
 p.context.fetch=()=>{count++;return new Promise(done=>{resolve=done;});};
 const first=p.run('pollSelected()');await p.run('pollSelected()');assert.equal(count,1);
 fixture.status='complete';resolve({ok:true,json:async()=>fixture});await first;
 assert.equal(p.run('state.pollTimer'),null);
});
test('model claims retain explanations confidence and evidence across all dimensions',async()=>{
 const p=await page();const fixture:any=structuredClone(task);const claim={value:'画面观察',confidence:'low',explanation:'仅观察到代表截图',evidence:['f1','title']};
 fixture.videos[0].analysis=Object.fromEntries(['theme','audience','hook','structure','orientation','person','mainVisual','layout','source','takeaways'].map(k=>[k,claim]));
 fixture.videos[0].analysis.limitations=['没有全文字幕'];fixture.videos[0].analysis.needsMoreFrames=true;p.context.fixture=fixture;p.run('renderTask(fixture)');
 const text=p.document.getElementById('report').textContent;
 for(const term of ['面向受众','问题切入点','可见内容结构','画幅','人物','主画面','合成布局','动态来源','可借鉴方式','低置信度','仅观察到代表截图','f1 · 3s','没有全文字幕','建议补采'])assert.ok(text.includes(term),term);
});

test('account list completeness does not imply certainty of top five',async()=>{
 const p=await page();const fixture:any=structuredClone(task);fixture.authors[0].coverage='complete';fixture.authors[0].selectionComplete=false;fixture.authors[0].selectionReasons=['仍有未核实作品'];p.context.fixture=fixture;p.run('renderTask(fixture)');
 assert.match(p.document.getElementById('report').textContent,/已采集作品内点赞前五/);
});
test('running console shows actual phase counters and expanded events; stop remains usable during another pending request',async()=>{
 const p=await page();const fixture:any=structuredClone(task);fixture.status='collecting';fixture.phase='authors';fixture.progress={completed:1,total:4,unit:'位博主'};fixture.runStartedAt=new Date().toISOString();fixture.events=[{at:fixture.runStartedAt,message:'读取第2位博主'}];p.context.fixture=fixture;
 p.run('state.pending=true;state.selectedId=fixture.id;renderTask(fixture)');
 assert.equal(p.document.getElementById('run-console').hidden,false);assert.match(p.document.getElementById('run-stage').textContent,/采集作品/);assert.match(p.document.getElementById('run-count').textContent,/1.*4/);assert.match(p.document.getElementById('run-events').textContent,/读取第2位博主/);assert.equal(p.document.getElementById('stop-current').disabled,false);
 await p.run("taskAction('cancel')");assert.ok(p.calls.some(c=>c.url.includes('/action')&&JSON.parse(c.options.body).action==='cancel'));
 fixture.status='waiting_user';fixture.message='等待本人操作：抖音验证码';p.run('state.pending=false');p.run('renderTask(fixture)');assert.match(p.document.getElementById('run-state').textContent,/等待/);assert.match(p.document.getElementById('run-detail').textContent,/验证码/);
});
test('stop during launch queues cancellation of the newly created task before any bootstrap refresh',async()=>{
 const p=await page();p.run('bindEvents()');p.document.getElementById('keyword').value='FDE';let reply:(value:any)=>void=()=>{};
 p.context.fetch=(url:string,options:any)=>{p.calls.push({url,options});if(url==='/api/tasks')return new Promise(resolve=>{reply=resolve;});return Promise.resolve({ok:true,json:async()=>url.endsWith('/action')?{...task,status:'cancelled'}:{token:'t',settings:{configured:false},tasks:[]}});};
 const starting=p.document.getElementById('task-form').listeners.submit({preventDefault(){}});assert.equal(p.document.getElementById('run-console').hidden,false);await p.document.getElementById('stop-current').listeners.click();reply({ok:true,json:async()=>task});await starting;
 const cancel=p.calls.findIndex(c=>c.url.endsWith('/action')&&JSON.parse(c.options.body).action==='cancel');const boot=p.calls.findIndex(c=>c.url==='/api/bootstrap');assert.ok(cancel>=0&&cancel<boot);
});
test('saved settings permit blank key model changes and successful explicit connection test folds panel',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,model:"gpt-6.1-sol"})');assert.equal(p.document.getElementById('api-key').required,false);p.document.getElementById('settings-panel').hidden=false;
 p.context.fetch=(url:string,options:any)=>{p.calls.push({url,options});return Promise.resolve({ok:true,json:async()=>({ok:true,message:'连接测试成功'})});};
 await p.document.getElementById('test-api').listeners.click();assert.equal(p.document.getElementById('settings-panel').hidden,true);assert.equal(p.document.getElementById('settings-toggle').attributes['aria-expanded'],'false');assert.match(p.document.getElementById('api-notice').textContent,/连接/);
 await p.document.getElementById('settings-toggle').listeners.click();assert.equal(p.document.getElementById('settings-panel').hidden,false);
});
test('known task stop sends cancellation immediately while resume response is held, then reconciles startup',async()=>{
 const p=await page();p.context.fixture=structuredClone(task);p.run('bindEvents();state.current=fixture;state.selectedId=fixture.id;');let release:(value:any)=>void=()=>{};
 p.context.fetch=(url:string,options:any)=>{p.calls.push({url,options});const action=options?.body?JSON.parse(options.body).action:undefined;if(action==='resume')return new Promise(resolve=>{release=resolve;});return Promise.resolve({ok:true,json:async()=>({...task,status:'cancelled'})});};
 const resuming=p.run("taskAction('resume')");try{await p.document.getElementById('stop-current').listeners.click();assert.ok(p.calls.some(c=>c.options?.body&&JSON.parse(c.options.body).action==='cancel'));}finally{release({ok:true,json:async()=>({...task,status:'collecting'})});await resuming;}
 assert.equal(p.calls.filter(c=>c.options?.body&&JSON.parse(c.options.body).action==='cancel').length,2);
});
test('homepage form requires profile samples without date filtering; legacy task keeps analysis labels',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(html.includes('进入作者主页'));assert.ok(html.includes('不使用搜索样本替代')||html.includes('不用搜索样本代替'));assert.ok(html.includes('不操作排序或日期筛选'));assert.ok(!html.includes('<option value="engagement">'));
 const p=await page();const fixture:any=structuredClone(task);fixture.status='ready_analysis';fixture.mode='likes';p.context.fixture=fixture;p.run('renderTask(fixture)');assert.match(p.document.getElementById('analyze-task').textContent,/分析入选/);assert.match(p.document.getElementById('run-state').textContent,/排名/);assert.match(p.document.getElementById('report').textContent,/日期未核实/);
});
const walk=(e:Element):Element[]=>[e,...e.children.flatMap(walk)];
test('progress belongs to the selected task card instead of the global page header',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const card=html.indexOf('id="task-progress"'),run=html.indexOf('id="run-console"'),end=html.indexOf('id="author-section"');
 assert.ok(card<run&&run<end,'live progress must be inside the task card');
 assert.equal((html.match(/aria-label="调研阶段"/g)||[]).length,0,'avoid a second duplicate step list');
});
test('the single candidate table lists every unscored account as results arrive without a separate directory',async()=>{
 const p=await page(),fixture=candidateTask();fixture.candidateScores=[];fixture.status='collecting';fixture.phase='authors';fixture.authors.forEach((a:any)=>delete a.relevance);p.context.fixture=fixture;
 p.run('bindEvents();renderTask(fixture)');assert.equal(tableRows(p).length,55);assert.match(p.document.getElementById('authors').textContent,/待评分/);
 const links=walk(p.document.getElementById('authors')).filter(e=>e.tagName==='a');assert.ok(links.some(e=>e.href===fixture.authors[54].url));
 fixture.authors.push({...fixture.authors[0],id:'new',name:'新候选',url:'https://www.douyin.com/user/new'});p.run('renderTask(fixture)');assert.equal(tableRows(p).length,56);assert.equal(p.calls.length,0);
 const next={...fixture,id:'other',authors:[],candidateScores:[]};p.context.next=next;p.run('renderTask(next)');assert.equal(tableRows(p).length,0);assert.doesNotMatch(p.document.getElementById('authors').textContent,/新候选/);
});
test('launch progress remains visible in the task area without showing the previous task logs',async()=>{
 const p=await page();p.context.fixture={...task,events:[{at:task.createdAt,message:'旧任务日志'}]};p.run('renderTask(fixture)');p.document.getElementById('keyword').value='新话题';p.run('state.launching=true;state.launchStartedAt=Date.now();renderRun(state.current)');
 assert.equal(p.document.getElementById('task-progress').hidden,false);assert.match(p.document.getElementById('task-title').textContent,/新话题/);assert.doesNotMatch(p.document.getElementById('run-events').textContent,/旧任务日志/);
});
test('failed new task submission restores the previous task card instead of retaining its launch preview',async()=>{
 const p=await page();p.context.fixture={...task,keyword:'旧话题'};p.run('bindEvents();renderTask(fixture)');p.document.getElementById('keyword').value='新话题';p.context.fetch=async()=>{throw Error('offline');};
 await p.document.getElementById('task-form').listeners.submit({preventDefault(){}});assert.equal(p.document.getElementById('task-title').textContent,'旧话题');assert.equal(p.document.getElementById('task-progress').hidden,false);assert.doesNotMatch(p.document.getElementById('task-progress').className,/is-launching/);
});
function candidateTask(){
 const t:any=structuredClone(task);t.collectionVersion=3;t.options={authorCount:1,videosPerAuthor:5,days:180};
 t.authors=Array.from({length:55},(_,i)=>({id:'a'+i,name:'作者'+i,url:'https://www.douyin.com/user/a'+i,bio:i===0?'<img src=x onerror=alert(1)>':'简介',profileSampleIds:i===0?['v1']:[],sourceSorts:['likes','combined']}));
 t.videos[0].authorId='a0';t.authors[0].relevance={profileScore:50,reason:'方向解释',videos:[{id:'v1',score:90,reason:'标题依据<script>bad</script>'}]};
 t.candidateScores=[{authorId:'a0',rank:1,selected:true,relevanceScore:90,likesScore:50,compositeScore:78,meanLikes:25,totalLikes:50,maxLikes:40,sampleCount:3,knownLikesCount:2,videoIds:['v1'],reason:'候选依据',warnings:['样本有限']},{authorId:'a1',rank:2,relevanceScore:20,likesScore:90,compositeScore:41,meanLikes:50,totalLikes:50,maxLikes:50,sampleCount:1,knownLikesCount:1,videoIds:[],reason:'',warnings:[]},{authorId:'a2',rank:3,relevanceScore:20,likesScore:null,compositeScore:null,meanLikes:null,totalLikes:null,maxLikes:null,sampleCount:1,knownLikesCount:0,videoIds:[],reason:'',warnings:[]}];return t;
}
function tableRows(p:Awaited<ReturnType<typeof page>>){return walk(p.document.getElementById('authors')).filter(e=>e.tagName==='tr'&&e.attributes['data-author-id']);}
test('v3 table keeps every candidate including unscored and literal hostile evidence',async()=>{
 const p=await page();p.context.fixture=candidateTask();p.run('renderTask(fixture)');assert.equal(tableRows(p).length,55);assert.equal(tableRows(p)[0].attributes['data-author-id'],'a0');
 const root=p.document.getElementById('authors');for(const text of ['全局综合名次','已评分','点赞、综合','2 / 3'])assert.ok(root.textContent.includes(text),text);
 const details=walk(root).find(e=>e.tagName==='details');assert.ok(details);assert.ok(details.textContent.includes('<img src=x onerror=alert(1)>'));assert.ok(details.textContent.includes('标题依据<script>bad</script>'));assert.equal(walk(root).filter(e=>e.tagName==='img'||e.tagName==='script').length,0);
});
test('v3 score headers toggle independently, nulls stay last and ties stable without changing final selection',async()=>{
 const p=await page();p.context.fixture=candidateTask();p.run('renderTask(fixture)');
 for(const key of ['relevanceScore','likesScore','compositeScore']){
  const find=()=>walk(p.document.getElementById('authors')).find(e=>e.tagName==='button'&&e.attributes['data-sort-key']===key)!;assert.ok(find());await find().listeners.click();
  const ascending=tableRows(p);assert.equal(ascending.at(-1)!.attributes['data-author-id'],'a54');assert.equal(walk(p.document.getElementById('authors')).find(e=>e.tagName==='th'&&e.attributes['data-sort-key']===key)!.attributes['aria-sort'],'ascending');
  const known=key==='relevanceScore'?3:2;assert.deepEqual(ascending.slice(0,known).map(e=>e.attributes['data-author-id']),key==='relevanceScore'?['a1','a2','a0']:key==='likesScore'?['a0','a1']:['a1','a0']);
  await find().listeners.click();assert.deepEqual(tableRows(p).slice(0,known).map(e=>e.attributes['data-author-id']),key==='relevanceScore'?['a0','a1','a2']:key==='likesScore'?['a1','a0']:['a0','a1']);assert.equal(tableRows(p).at(-1)!.attributes['data-author-id'],'a54');assert.equal(walk(p.document.getElementById('authors')).find(e=>e.tagName==='th'&&e.attributes['data-sort-key']===key)!.attributes['aria-sort'],'descending');assert.match(tableRows(p).find(e=>e.attributes['data-author-id']==='a0')!.textContent,/已评分/);assert.equal(p.run('state.authorId'),null);assert.equal(p.calls.length,0);
 }
});
test('v3 scoring is API gated and score phase shows actual counters',async()=>{
 const p=await page();const fixture=candidateTask();fixture.status='waiting_api';fixture.phase='score';fixture.progress={completed:3,total:55,unit:'位博主'};p.context.fixture=fixture;p.run('bindEvents();state.selectedId=fixture.id;renderTask(fixture)');assert.equal(p.document.getElementById('score-task').disabled,true);assert.match(p.document.getElementById('run-stage').textContent,/评分/);assert.match(p.document.getElementById('run-count').textContent,/3.*55/);
 p.run('state.settings.configured=true;renderTask(fixture)');assert.equal(p.document.getElementById('score-task').disabled,false);await p.document.getElementById('score-task').listeners.click();assert.ok(p.calls.some(c=>c.options?.body&&JSON.parse(c.options.body).action==='score'));fixture.status='collecting';p.run('renderTask(fixture)');assert.equal(p.document.getElementById('score-task').disabled,true);
});
test('v3 ranking displays scored status instead of selecting a top subset and limits details to first twelve samples',async()=>{
 const p=await page();const fixture=candidateTask();fixture.candidateScores[0].selected=false;fixture.candidateScores[1].selected=true;fixture.candidateScores[1].rank=7;
 fixture.authors[0].profileSampleIds=Array.from({length:13},(_,i)=>'sample'+i);fixture.videos=Array.from({length:13},(_,i)=>({...task.videos[0],id:'sample'+i,authorId:'a0',title:'主页样本'+i}));p.context.fixture=fixture;p.run('renderTask(fixture)');
 assert.equal(p.document.getElementById('analyze-task').hidden,true);assert.equal(p.document.getElementById('report').hidden,true);assert.equal(p.document.getElementById('run-step-sample').hidden,true);assert.ok(!tableRows(p)[0].textContent.includes('最终入选'));assert.match(tableRows(p).find(e=>e.attributes['data-author-id']==='a1')!.textContent,/已评分/);const text=p.document.getElementById('authors').textContent;assert.ok(text.includes('主页样本11'));assert.ok(!text.includes('主页样本12'));
});
test('saving API configuration unlocks score button on an idle waiting task without requiring a refresh',async()=>{
 const p=await page();const fixture=candidateTask();fixture.status='waiting_api';p.context.fixture=fixture;p.run('renderTask(fixture)');assert.equal(p.document.getElementById('score-task').disabled,true);p.run('updateSettings({configured:true,persisted:true,model:"gpt-6.1-sol"})');assert.equal(p.document.getElementById('score-task').disabled,false);
});

test('runtime mismatch blocks all writes except stop actions and preserves read-only access',async()=>{
 const p=await page();p.run('applyRuntimeVersion(undefined)');
 assert.equal(p.document.getElementById('runtime-notice').hidden,false);assert.match(p.document.getElementById('runtime-notice').textContent,/旧版|版本不一致/);
 for(const [path,body] of [['/api/tasks',{}],['/api/settings',{}],['/api/settings/test',{}],['/api/browser/open',{}],['/api/tasks/t/action',{action:'analyze'}],['/api/tasks/t/action',{action:'note'}]])await assert.rejects(()=>p.run(`api(${JSON.stringify(path)},${JSON.stringify(body)})`),/后台/);
 assert.equal(p.calls.length,0);
 await p.run("api('/api/tasks/t')");await p.run("api('/api/tasks/t/action',{action:'cancel'})");await p.run("api('/api/tasks/t/action',{action:'pause'})");assert.equal(p.calls.length,3);
 p.run("applyRuntimeVersion('wrong');updateSettings({configured:true});renderTask(null)");assert.equal(p.document.getElementById('start-task').disabled,true);assert.equal(p.document.getElementById('test-api').disabled,true);
 p.run("applyRuntimeVersion('2026-11-14-brand-assets-1')");await p.run("api('/api/tasks',{})");assert.equal(p.document.getElementById('runtime-notice').hidden,true);
});
test('bootstrap verifies actual backend build before allowing writes',async()=>{
 const p=await page();await p.run('loadBootstrap()');await assert.rejects(()=>p.run("api('/api/tasks',{})"),/后台/);
 p.context.fetch=async()=>({ok:true,json:async()=>({build:'2026-11-14-brand-assets-1',tasks:[],settings:{}})});await p.run('loadBootstrap()');assert.equal(p.run('state.runtimeCompatible'),true);
});

test('login UI distinguishes browser from login and controls are grouped with progress',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.match(html,/id="browser-status"/);assert.match(html,/id="login-status"/);assert.match(html,/id="refresh-browser-status"/);assert.match(html,/class="run-controls"/);
 const p=await page();p.context.statusFixture={browser:'open',login:'unknown',message:'待确认',checkedAt:''};p.run('renderBrowserStatus(statusFixture)');assert.match(p.document.getElementById('browser-status').textContent,/已打开/);assert.match(p.document.getElementById('login-status').textContent,/待确认/);assert.doesNotMatch(p.document.getElementById('login-status').textContent,/已登录/);
});
test('browser status reads do not overlap and open without evidence never claims login',async()=>{
 const p=await page();let release:(v:any)=>void=()=>{};let count=0;p.context.fetch=()=>{count++;return new Promise(done=>release=done)};
 const first=p.run('refreshBrowserStatus()');await p.run('refreshBrowserStatus()');assert.equal(count,1);release({ok:true,json:async()=>({browser:'open',login:'logged_out',message:'请登录'})});await first;assert.match(p.document.getElementById('login-status').textContent,/未登录/);
 p.run('bindEvents()');p.context.fetch=async()=>({ok:true,json:async()=>({ok:true})});await p.document.getElementById('open-browser').listeners.click();assert.doesNotMatch(p.document.getElementById('login-status').textContent,/已登录/);
});
test('completed tasks hide all task commands; running tasks show pause and stop in one group',async()=>{
 const p=await page();p.context.fixture={...task,status:'complete'};p.run('renderTask(fixture)');for(const id of ['stop-current','pause-task','resume-task','cancel-task','score-task','expand-task','analyze-task'])assert.equal(p.document.getElementById(id).hidden,true,id);
 p.context.fixture={...task,status:'collecting'};p.run('renderTask(fixture)');assert.equal(p.document.getElementById('pause-task').hidden,false);assert.equal(p.document.getElementById('stop-current').hidden,false);assert.equal(p.document.getElementById('resume-task').hidden,true);assert.equal(p.document.getElementById('cancel-task').hidden,true);
});

test('late status response cannot overwrite an opening request and more than five progress entries are visible',async()=>{
 const p=await page();let release:(v:any)=>void=()=>{};p.context.fetch=()=>new Promise(done=>release=done);const reading=p.run('refreshBrowserStatus()');p.run("state.browserRevision++;state.browserOpening=true;renderBrowserStatus({browser:'opening',login:'unknown'})");release({ok:true,json:async()=>({browser:'open',login:'logged_in'})});await reading;assert.match(p.document.getElementById('browser-status').textContent,/正在打开/);assert.match(p.document.getElementById('login-status').textContent,/待确认/);
 p.context.fixture={...task,status:'collecting',events:Array.from({length:15},(_,i)=>({at:task.createdAt,message:'进度'+i}))};p.run('renderTask(fixture)');assert.equal(p.document.getElementById('run-events').children.length,15);
});

test('legacy v3 full analysis remains available after ranking rather than offering scoring again',async()=>{
 const p=await page();p.context.fixture={...task,collectionVersion:3,rankingOnly:false,status:'ready_analysis',phase:'rank',selectedVideoIds:['v1']};p.run('state.settings.configured=true;renderTask(fixture)');assert.equal(p.document.getElementById('analyze-task').hidden,false);assert.equal(p.document.getElementById('analyze-task').disabled,false);assert.equal(p.document.getElementById('score-task').hidden,true);
});
test('running log follows latest initially and near bottom but preserves a scrolled history view',async()=>{
 const p=await page();p.context.fixture={...task,status:'collecting',events:Array.from({length:15},(_,i)=>({at:task.createdAt,message:'进度'+i}))};p.run('renderTask(fixture)');const log=p.document.getElementById('run-events');assert.equal(log.scrollTop,log.scrollHeight);
 log.scrollTop=log.scrollHeight-log.clientHeight-10;p.run("fixture.events.push({at:fixture.createdAt,message:'最新进度'});renderTask(fixture)");assert.equal(log.scrollTop,log.scrollHeight);
 log.scrollTop=35;p.run("fixture.events.push({at:fixture.createdAt,message:'更新进度'});renderTask(fixture)");assert.equal(log.scrollTop,35);
 p.run("fixture.id='another-task';renderTask(fixture)");assert.equal(log.scrollTop,log.scrollHeight);
});

test('execution history renders every record beyond the old limits and retains the readers position',async()=>{
 const p=await page();p.context.fixture={...task,status:'collecting',events:Array.from({length:650},(_,i)=>({at:task.createdAt,message:'完整执行-'+i}))};p.run('renderTask(fixture)');
 const log=p.document.getElementById('run-events');assert.equal(log.children.length,650);assert.match(log.children[0].textContent,/完整执行-0$/);assert.match(log.children[649].textContent,/完整执行-649$/);
 assert.equal(p.document.getElementById('task-log').children.length,650);log.scrollTop=50;p.run("fixture.events.push({at:fixture.createdAt,message:'最终记录'});renderTask(fixture)");assert.equal(log.children.length,651);assert.equal(log.scrollTop,50);
 p.run('renderTask(fixture)');assert.equal(log.children.length,651,'polling must not duplicate records');
});

test('provider drafts isolate keys and preserve the saved active configuration until save',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,provider:"openai",baseURL:"https://api.openai.com/v1",model:"gpt-6.1-sol",profiles:[{provider:"openai",baseURL:"https://api.openai.com/v1",model:"gpt-6.1-sol",persisted:true}]})');
 p.document.getElementById('api-key').value='fake-openai';p.document.getElementById('provider').value='deepseek';await p.document.getElementById('provider').listeners.change();
 assert.equal(p.document.getElementById('api-key').value,'');assert.equal(p.document.getElementById('api-key').required,true);assert.equal(p.document.getElementById('model').value,'deepseek-chat');assert.equal(p.run('state.settings.provider'),'openai');assert.equal(p.document.getElementById('test-api').disabled,true);assert.equal(p.document.getElementById('clear-api').disabled,true);assert.equal(p.calls.length,0);
 p.document.getElementById('provider').value='openai';await p.document.getElementById('provider').listeners.change();assert.equal(p.document.getElementById('api-key').required,false);assert.equal(p.document.getElementById('test-api').disabled,false);
});

test('remote model lists are explicit local requests and fallback lists remain unverified',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:false})');p.document.getElementById('provider').value='deepseek';await p.document.getElementById('provider').listeners.change();assert.equal(p.calls.length,0);
 p.document.getElementById('api-key').value='fake-deepseek';p.context.fetch=async(url:string,options:any)=>{p.calls.push({url,options});return {ok:true,json:async()=>({models:[{id:'available-model',label:'Available'}],source:'remote',message:'模型列表不代表调用权限'})};};
 await p.document.getElementById('fetch-models').listeners.click();assert.equal(p.calls.length,1);assert.equal(p.calls[0].url,'/api/settings/models');assert.deepEqual(JSON.parse(p.calls[0].options.body),{provider:'deepseek',baseURL:'https://api.deepseek.com/v1',apiKey:'fake-deepseek'});assert.match(p.document.getElementById('model-source').textContent,/不代表/);assert.ok(walk(p.document.getElementById('model')).some(e=>e.value==='available-model'));
 p.context.fetch=async()=>{throw Error('offline')};await p.document.getElementById('fetch-models').listeners.click();assert.match(p.document.getElementById('model-source').textContent,/预设.*未验证/);assert.equal(p.document.getElementById('api-key').value,'');
});

test('custom destinations require explicit confirmation and clear only the matching saved profile',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,provider:"openai",baseURL:"https://api.openai.com/v1",model:"gpt-6.1-sol",profiles:[{provider:"custom",baseURL:"https://example.org/v1",model:"x",persisted:true}]})');p.document.getElementById('provider').value='custom';await p.document.getElementById('provider').listeners.change();p.document.getElementById('base-url').value='https://example.org/v1';await p.document.getElementById('base-url').listeners.input();assert.equal(p.document.getElementById('api-key').required,false);assert.equal(p.document.getElementById('clear-api').disabled,false);
 await p.document.getElementById('clear-api').listeners.click();assert.deepEqual(JSON.parse(p.calls[0].options.body),{clear:true,provider:'custom',baseURL:'https://example.org/v1'});
 p.document.getElementById('provider').value='custom';await p.document.getElementById('provider').listeners.change();p.document.getElementById('base-url').value='https://other.example/v1';await p.document.getElementById('base-url').listeners.input();p.document.getElementById('api-key').value='fake-custom';await p.document.getElementById('settings-form').listeners.submit({preventDefault(){}});assert.equal(p.calls.length,1);assert.match(p.document.getElementById('error').textContent,/确认/);
 p.document.getElementById('endpoint-confirmed').checked=true;await p.document.getElementById('settings-form').listeners.submit({preventDefault(){}});assert.equal(JSON.parse(p.calls[1].options.body).endpointConfirmed,true);assert.equal(JSON.parse(p.calls[1].options.body).baseURL,'https://other.example/v1');
});

test('saved textual tests cannot silently test drafts and never claim image capability',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,provider:"deepseek",baseURL:"https://api.deepseek.com/v1",model:"deepseek-chat"})');p.document.getElementById('custom-model').value='draft';p.document.getElementById('model').value='custom';await p.document.getElementById('model').listeners.change();await p.document.getElementById('test-api').listeners.click();assert.equal(p.calls.length,0);
 p.document.getElementById('model').value='deepseek-chat';await p.document.getElementById('model').listeners.change();p.context.fetch=async(url:string,options:any)=>{p.calls.push({url,options});return {ok:true,json:async()=>({ok:true,message:'文字连接成功'})};};await p.document.getElementById('test-api').listeners.click();assert.equal(p.calls[0].url,'/api/settings/test');assert.match(p.document.getElementById('api-notice').textContent,/文字/);assert.doesNotMatch(p.document.getElementById('api-notice').textContent,/图像.*成功|OpenAI/);
});

test('a late model list cannot replace a newer provider draft and bootstrap refresh keeps drafts',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,model:"gpt-6.1-sol"})');let release:(value:any)=>void=()=>{};p.context.fetch=(url:string,options:any)=>{p.calls.push({url,options});return new Promise(done=>release=done)};
 const listing=p.document.getElementById('fetch-models').listeners.click();p.document.getElementById('provider').value='deepseek';await p.document.getElementById('provider').listeners.change();p.run('updateSettings({configured:true,persisted:true,model:"gpt-6.1-sol"})');assert.equal(p.document.getElementById('provider').value,'deepseek');release({ok:true,json:async()=>({models:[{id:'old-openai',label:'Old'}],source:'remote',message:'old'})});await listing;assert.equal(p.document.getElementById('model').value,'deepseek-chat');assert.ok(!walk(p.document.getElementById('model')).some(e=>e.value==='old-openai'));
});

test('late model list responses cannot revert a newer model or clear a newer key',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,model:"gpt-6.1-sol"})');
 let release:(value:any)=>void=()=>{};p.context.fetch=()=>new Promise(done=>release=done);
 const listing=p.document.getElementById('fetch-models').listeners.click();
 p.document.getElementById('model').value='custom';await p.document.getElementById('model').listeners.change();
 p.document.getElementById('custom-model').value='new-model-choice';await p.document.getElementById('custom-model').listeners.input();
 release({ok:true,json:async()=>({models:[{id:'gpt-6.1-sol'}],source:'remote'})});await listing;
 assert.equal(p.run('draftConfig().model'),'new-model-choice');
 const failed=p.document.getElementById('fetch-models').listeners.click();
 p.document.getElementById('api-key').value='newer-fake-key';await p.document.getElementById('api-key').listeners.input();
 release({ok:false,status:401,json:async()=>({error:'old-key-rejected'})});await failed;
 assert.equal(p.document.getElementById('api-key').value,'newer-fake-key');
});

test('late save and clear responses preserve a newer provider draft and its newly typed key',async()=>{
 for(const action of ['save','clear']){
  const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,model:"gpt-6.1-sol"})');let release:(value:any)=>void=()=>{};p.context.fetch=()=>new Promise(done=>release=done);
  p.document.getElementById('api-key').value='request-fake-key';
  const pending=action==='save'?p.document.getElementById('settings-form').listeners.submit({preventDefault(){}}):p.document.getElementById('clear-api').listeners.click();
  p.document.getElementById('provider').value='deepseek';await p.document.getElementById('provider').listeners.change();p.document.getElementById('api-key').value='new-deepseek-key';await p.document.getElementById('api-key').listeners.input();
  release({ok:true,json:async()=>({configured:action==='save',persisted:action==='save',provider:'openai',baseURL:'https://api.openai.com/v1',model:'gpt-6.1-sol',profiles:[]})});await pending;
  assert.equal(p.document.getElementById('provider').value,'deepseek',action);assert.equal(p.document.getElementById('api-key').value,'new-deepseek-key',action);assert.equal(p.run('state.settings.provider'),'openai');assert.equal(p.document.getElementById('test-api').disabled,true);
 }
});

test('late textual test completion leaves an edited settings draft open',async()=>{
 const p=await page();p.run('bindEvents();updateSettings({configured:true,persisted:true,model:"gpt-6.1-sol"})');p.document.getElementById('settings-panel').hidden=false;let release:(value:any)=>void=()=>{};p.context.fetch=()=>new Promise(done=>release=done);
 const pending=p.document.getElementById('test-api').listeners.click();p.document.getElementById('custom-model').value='new-model';p.document.getElementById('model').value='custom';await p.document.getElementById('model').listeners.change();p.document.getElementById('settings-message').textContent='new-draft-message';
 release({ok:true,json:async()=>({ok:true,message:'old-test-success'})});await pending;assert.equal(p.document.getElementById('settings-panel').hidden,false);assert.equal(p.document.getElementById('settings-message').textContent,'new-draft-message');assert.equal(p.run('draftConfig().model'),'new-model');
});


test('collection controls provide native integer bounds and maximum workload warning',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 for(const [id,max,value] of [['search-limit','200','50'],['profile-limit','30','12']]){const input=html.match(new RegExp('<input[^>]*id="'+id+'"[^>]*>'))?.[0]||'';for(const attr of ['type="number"','min="1"','max="'+max+'"','step="1"','value="'+value+'"','required'])assert.ok(input.includes(attr),id+' '+attr);}
 const p=await page();p.document.getElementById('search-limit').value='100';p.document.getElementById('profile-limit').value='30';p.run('updateScopeEstimate()');assert.match(p.document.getElementById('scope-estimate').textContent,/100.*30.*3000/);assert.match(p.document.getElementById('scope-estimate').textContent,/时间.*API|API.*时间/);assert.match(p.document.getElementById('scope-estimate').textContent,/不足/);
});

test('manual form submissions reject invalid collection bounds before making a request',async()=>{
 for(const [id,value] of [['search-limit','0'],['search-limit','201'],['search-limit','1.5'],['search-limit',''],['search-limit','Infinity'],['profile-limit','0'],['profile-limit','31'],['profile-limit','2.5']]){
  const p=await page();p.run('bindEvents()');p.document.getElementById('keyword').value='FDE';p.document.getElementById(id).value=value;await p.document.getElementById('task-form').listeners.submit({preventDefault(){}});assert.equal(p.calls.length,0,id+' '+value);assert.equal(p.run('state.launching'),false);assert.match(p.document.getElementById('error').textContent,/整数/);
 }
});

test('new task snapshots scope and later drafts never alter running or resumed task scope',async()=>{
 const p=await page();p.run('bindEvents()');p.document.getElementById('keyword').value='FDE';p.document.getElementById('search-limit').value='100';p.document.getElementById('profile-limit').value='30';let release:(value:any)=>void=()=>{};
 p.context.fetch=(url:string,options:any)=>{p.calls.push({url,options});return new Promise(done=>release=done)};const pending=p.document.getElementById('task-form').listeners.submit({preventDefault(){}});
 assert.deepEqual(JSON.parse(p.calls[0].options.body).collectionScope,{searchLimit:100,profileLimit:30});p.document.getElementById('search-limit').value='1';p.document.getElementById('profile-limit').value='1';p.run('updateScopeEstimate();renderRun(state.current)');assert.match(p.document.getElementById('task-window').textContent,/100.*30/);
 release({ok:false,status:500,json:async()=>({error:'offline fixture'})});await pending;
 const fixture={...task,collectionVersion:4,rankingRequested:true,profileRanking:true,collectionScope:{searchLimit:100,profileLimit:30},status:'paused',phase:'authors'};p.context.fixture=fixture;p.run('state.selectedId=fixture.id;renderTask(fixture)');assert.match(p.document.getElementById('task-window').textContent,/100.*30/);assert.match(p.document.getElementById('coverage-stats').textContent,/上限100/);assert.match(p.document.getElementById('run-stage').textContent,/30条/);
 p.context.fetch=async(url:string,options:any)=>{p.calls.push({url,options});return {ok:true,json:async()=>fixture}};await p.document.getElementById('resume-task').listeners.click();assert.deepEqual(JSON.parse(p.calls.find(c=>c.url.endsWith('/action'))!.options.body),{action:'resume'});assert.deepEqual(fixture.collectionScope,{searchLimit:100,profileLimit:30});assert.match(p.document.getElementById('scoring-details').textContent,/30条/);
 delete (fixture as any).collectionScope;p.run('renderTask(fixture)');assert.match(p.document.getElementById('task-window').textContent,/50.*12/);
});

test('thirty-title scope renders all evidence and labels actual underfilled samples',async()=>{
 const p=await page();const fixture={...candidateTask(),collectionVersion:4,profileRanking:true,rankingRequested:true,collectionScope:{searchLimit:100,profileLimit:30}};fixture.authors[0].profileSampleIds=Array.from({length:30},(_,i)=>'scope-'+i);fixture.videos=Array.from({length:30},(_,i)=>({...task.videos[0],id:'scope-'+i,authorId:'a0',title:'完整主页标题-'+i}));fixture.authors[0].relevance={...fixture.authors[0].relevance,videos:fixture.videos.map((v,i)=>({id:v.id,score:99,reason:'完整标题依据-'+i}))};p.context.fixture=fixture;p.run('renderTask(fixture)');assert.match(p.document.getElementById('authors').textContent,/前30条评分依据/);assert.ok(p.document.getElementById('authors').textContent.includes('完整主页标题-29'));assert.ok(p.document.getElementById('authors').textContent.includes('完整标题依据-29'));assert.match(p.document.getElementById('authors').textContent,/实际30.*上限30/);
 fixture.authors[0].profileSampleIds=fixture.authors[0].profileSampleIds.slice(0,2);p.run('renderTask(fixture)');assert.match(p.document.getElementById('authors').textContent,/实际2.*上限30.*不足/);
});


test('both collection boundaries submit their exact integer values',async()=>{
 for(const [searchLimit,profileLimit] of [[1,1],[200,30]]){const p=await page();p.run('bindEvents()');p.document.getElementById('keyword').value='FDE';p.document.getElementById('search-limit').value=String(searchLimit);p.document.getElementById('profile-limit').value=String(profileLimit);await p.document.getElementById('task-form').listeners.submit({preventDefault(){}});assert.deepEqual(JSON.parse(p.calls.find(c=>c.url==='/api/tasks')!.options.body).collectionScope,{searchLimit,profileLimit});}
});
