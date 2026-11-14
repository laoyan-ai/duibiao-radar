import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const modulePath = '../src/browser.js';
const browserModule = await import(modulePath).catch(()=>null);
test('already-open selected video is reused instead of navigated again',async()=>{
 assert.ok(browserModule);const c=new browserModule.BrowserCollector({profileDir:'unused'});let navigations=0;const page={url:()=> 'https://www.douyin.com/video/111?previous_page=search',goto:async()=>{navigations++;}};
 (c as any).ensure=async()=>page;(c as any).snapshot=async()=>({});
 await (c as any).goto('https://www.douyin.com/video/111',{});assert.equal(navigations,0);
});
test('profile card title dates are not mistaken for publication dates or numeric title spans for likes',async()=>{
 assert.ok(browserModule);const c=new browserModule.BrowserCollector({profileDir:process.env.TEMP+'/dy-card-date-'+crypto.randomUUID(),headless:true});
 try{const page=await (c as any).ensure();await page.setContent('<ul><li><a href="/video/111"><h2><span>2025</span> 2025-01-01年度报告</h2><span>999</span></a></li></ul>');const snapshot=await page.evaluate(browserModule.readVisibleSnapshot);assert.equal(snapshot.cards[0].dateText,'');assert.equal(snapshot.cards[0].likeText,'999');}
 finally{const profile=(c as any).config.profileDir;await c.close();const {rm}=await import('node:fs/promises');await rm(profile,{recursive:true,force:true});}
});
test('close during a pending Chrome launch closes its late context before returning',async()=>{
 assert.ok(browserModule);const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'dy-launch-stop-'));const original=chromium.launchPersistentContext;let release:()=>void=()=>{},entered:()=>void=()=>{};const reached=new Promise<void>(r=>{entered=r;});let closes=0;
 const context={pages:()=>[{}],close:async()=>{closes++;}};
 (chromium as any).launchPersistentContext=async()=>{entered();await new Promise<void>(r=>{release=r;});return context;};
 const collector=new browserModule.BrowserCollector({profileDir:dir});
 try{const opening=(collector as any).ensure().catch(()=>undefined);await reached;const closing=collector.close();release();await Promise.all([opening,closing]);assert.equal(closes,1);assert.equal((collector as any).context,undefined);}
 finally{release();(chromium as any).launchPersistentContext=original;await collector.close();await rm(dir,{recursive:true,force:true});}
});
test('browser module exposes production collector and visible DOM parser',()=>{
 assert.ok(browserModule, 'Browser collection implementation is missing');
 assert.equal(typeof browserModule.BrowserCollector,'function');
});
test('public fixture retains stable author IDs and omits hidden nodes and missing metrics',async()=>{
 assert.ok(browserModule, 'Browser collection implementation is missing');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent(await readFile(new URL('./fixtures/browser-cards.html',import.meta.url),'utf8'));
  const snapshot=await page.evaluate(browserModule.readVisibleSnapshot);
  const videos=browserModule.parseCards(snapshot,'FDE',new Date('2026-11-13T00:00:00Z'));
  assert.deepEqual(videos.map((v:any)=>v.id),['111','222','333']);
  assert.equal(videos[0].authorId,'author-A'); assert.equal(videos[2].authorId,'author-B');
  assert.equal(videos[0].title,'FDE从零入门实战');
  assert.equal(videos[0].likes.value,849); assert.equal(videos[0].favorites.value,null);
  assert.equal(videos[0].duration,4943); assert.equal(videos[2].likes.value,12000);
  assert.equal(videos[2].publishedAt,null); assert.equal(videos[1].related,false);
  assert.equal(browserModule.detectUserBlock(snapshot.text),null);
  assert.equal(snapshot.authorHref,'');
  assert.equal(snapshot.metrics.favorites,'778'); assert.equal(snapshot.metrics.shares,'246');
 } finally {await browser.close();}
});
test('blocking markers require explicit intervention while a normal login button does not',()=>{
 assert.ok(browserModule);
 assert.match(browserModule.detectUserBlock('请完成安全验证'),/验证/);
 assert.match(browserModule.detectUserBlock('登录后查看完整作品'),/登录/);
 assert.equal(browserModule.detectUserBlock('首页 关注 登录 搜索 FDE'),null);
});
test('coverage never declares old pinned or stalled unordered cards complete',()=>{
 assert.ok(browserModule);
 assert.equal(browserModule.coverageFromPage('置顶 2024-01-01',300,300).coverage,'partial');
 assert.equal(browserModule.coverageFromPage('最新作品 2026-01-01',8,300).coverage,'partial');
 assert.equal(browserModule.coverageFromPage('暂时没有更多了',8,300).coverage,'complete');
});
test('fresh decoded frame rejects stale media time and undecoded seeks',()=>{
 assert.ok(browserModule);
 assert.equal(browserModule.isFreshFrame(50,{time:50,readyState:4,decodedTime:12,seeking:false}),false);
 assert.equal(browserModule.isFreshFrame(50,{time:50,readyState:1,decodedTime:50,seeking:false}),false);
 assert.equal(browserModule.isFreshFrame(50,{time:50.03,readyState:4,decodedTime:50.02,seeking:false}),true);
 assert.equal(browserModule.isFreshFrame(50,{time:50,readyState:4,decodedTime:50,seeking:true}),false);
});
test('sampling clamps and merges short targets and caps supplement to ten total',()=>{
 assert.ok(browserModule);
 assert.deepEqual(browserModule.normalizeTargets([0,0.02,1,99],1,0),[0,0.8]);
 assert.deepEqual(browserModule.normalizeTargets([1,2,3],10,9),[1]);
 assert.deepEqual(browserModule.normalizeTargets([1,2],10,10),[]);
});
test('perceptual duplicate compares actual pixel content, not compressed file bytes',()=>{
 assert.ok(browserModule);
 const a=Buffer.alloc(64,80), b=Buffer.alloc(64,81), c=Buffer.alloc(64,180);
 assert.equal(browserModule.sameFramePixels(a,b),true);
 assert.equal(browserModule.sameFramePixels(a,c),false);
});

test('rendered detail statistics read verified sibling labels and ignore comment-only login requirements',async()=>{
 assert.ok(browserModule);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {const p=await browser.newPage();await p.setContent(await readFile(new URL('./fixtures/browser-detail.html',import.meta.url),'utf8'));
 const s=await p.evaluate(browserModule.readVisibleSnapshot);
 assert.ok(s.authorHref.endsWith('/user/author-A'));assert.equal(s.authorText,'九天Hector');
 assert.deepEqual(s.metrics,{likes:'849',favorites:'778',shares:'246'});
 assert.equal(s.dateText,'2026-10-05 10:00');assert.equal(browserModule.detectUserBlock(s.text),null);
 assert.match(browserModule.detectUserBlock('登录后免费畅享高清视频\n扫码登录\n验证码登录'),/登录/);
 }finally{await browser.close();}
});
test('collector waits actual local media metadata, seeks fresh frames and writes bounded timestamped JPEG evidence',async()=>{
 assert.ok(browserModule);
 const {mkdtemp,rm,readdir}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const dir=await mkdtemp(path.join(os.tmpdir(),'douyin-browser-test-'));
 const collector=new browserModule.BrowserCollector({profileDir:path.join(dir,'profile'),headless:true});
 try {
  const p=await (collector as any).ensure();const html=await readFile(new URL('./fixtures/browser-media.html',import.meta.url),'utf8');
  await p.route('https://www.douyin.com/**',(route:any)=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  const empty={raw:null,value:null,approximate:false};
  const video={id:'111',url:'https://www.douyin.com/video/111',authorId:'a',authorName:'a',authorUrl:'https://www.douyin.com/user/a',title:'test',description:'',dateText:'',publishedAt:null,duration:null,likes:empty,favorites:empty,shares:empty,kind:'video',related:true,collectedAt:new Date().toISOString(),frames:[]};
  const frames=await collector.sample(video,path.join(dir,'frames'),[0.15,1.3]);
  assert.equal(frames.length,2);assert.ok(Math.abs(frames[0].actualTime-0.15)<0.35);assert.ok(Math.abs(frames[1].actualTime-1.3)<0.35);
  assert.equal(frames[0].width,640);assert.equal(frames[0].height,360);
  assert.ok(frames.every((f:any)=>f.file.startsWith('111_')&&f.file.endsWith('.jpg')&&!f.file.includes('/')));
  assert.equal((await readdir(path.join(dir,'frames'))).length,2);
 }finally{await collector.close();await rm(dir,{recursive:true,force:true});}
});
test('search skips unattributed cards without opening any video detail',async()=>{
 assert.ok(browserModule);const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const dir=await mkdtemp(path.join(os.tmpdir(),'douyin-search-test-'));
 const c=new browserModule.BrowserCollector({profileDir:path.join(dir,'profile'),headless:true});
 try {const p=await (c as any).ensure();
 const media=await readFile(new URL('./fixtures/browser-media.html',import.meta.url),'utf8');let detailVisits=0;
 await p.route('https://www.douyin.com/**',async(route:any)=>{
  const url=route.request().url();if(url.includes('/video/'))detailVisits++;const body=url.includes('/search/')?'<ul><li><a href="/video/111"><h2>FDE一</h2></a><a href="/user/author-A">同名</a></li><li><a href="/video/222"><h2>FDE二</h2></a><span>@同名</span></li></ul>':media.replace('<main>','<main><a href="/user/author-B">同名</a><h1>FDE二</h1>');
  await route.fulfill({contentType:'text/html; charset=utf-8',body});
 });
 const result=await c.search('FDE',{searchPerSort:2,maxSearchVideos:2,maxAuthors:2,profileMax:300});
 assert.equal(result.videos.length,1);assert.deepEqual(result.authors.map((a:any)=>a.id),['author-A']);assert.equal(detailVisits,0);assert.match(result.reason,/跳过/);
 }finally{await c.close();await rm(dir,{recursive:true,force:true});}
});
test('budgeted subset stays partial even when entire page contains an end marker',()=>{
 assert.ok(browserModule);assert.equal(browserModule.coverageFromPage('没有更多了',300,300).coverage,'partial');
});
test('profile collection retains old pinned cards without importing another authors recommendations',async()=>{
 assert.ok(browserModule);const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const dir=await mkdtemp(path.join(os.tmpdir(),'douyin-profile-test-'));
 const c=new browserModule.BrowserCollector({profileDir:path.join(dir,'profile'),headless:true});
 try {const p=await (c as any).ensure();const html=await readFile(new URL('./fixtures/browser-cards.html',import.meta.url),'utf8');await p.route('https://www.douyin.com/**',(route:any)=>route.fulfill({contentType:'text/html; charset=utf-8',body:html+'<p>没有更多了</p>'}));
 const result=await c.collectAuthor({id:'author-A',name:'九天Hector',url:'https://www.douyin.com/user/author-A',coverage:'partial',reason:'',fetchedCount:0},'2026-08-15T00:00:00Z',300);
 assert.deepEqual(result.videos.map((v:any)=>v.id),['111','222']);assert.equal(result.coverage,'complete');
 }finally{await c.close();await rm(dir,{recursive:true,force:true});}
});

test('expanded collection budgets reach beyond initial search and profile defaults',async()=>{
 assert.ok(browserModule);const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const dir=await mkdtemp(path.join(os.tmpdir(),'douyin-expand-test-'));
 const c=new browserModule.BrowserCollector({profileDir:path.join(dir,'profile'),headless:true});
 try {const p=await (c as any).ensure();await p.route('https://www.douyin.com/**',(route:any)=>{const search=route.request().url().includes('/search/');const count=search?201:301;let body='<ul>';for(let i=0;i<count;i++)body+='<li><a href="/video/'+(1000+i)+'"><h2>FDE样本'+i+'</h2></a>'+(search?'<a href="/user/author-'+i%21+'">同名</a>':'')+'</li>';body+='</ul><p>没有更多了</p>';return route.fulfill({contentType:'text/html; charset=utf-8',body});});
 const search=await c.search('FDE',{searchPerSort:201,maxSearchVideos:201,maxAuthors:21,profileMax:302});assert.equal(search.videos.length,201);assert.equal(search.authors.length,21);
 const profile=await c.collectAuthor({id:'author-A',name:'A',url:'https://www.douyin.com/user/author-A',coverage:'partial',reason:'',fetchedCount:0},'2026-08-15T00:00:00Z',302);assert.equal(profile.videos.length,301);assert.equal(profile.coverage,'complete');
 }finally{await c.close();await rm(dir,{recursive:true,force:true});}
});
test('captcha interstitial with empty parent text pauses on public title or visible iframe without retaining its URL',async()=>{
 assert.ok(browserModule);const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const dir=await mkdtemp(path.join(os.tmpdir(),'douyin-captcha-test-'));
 const c=new browserModule.BrowserCollector({profileDir:path.join(dir,'profile'),headless:true});
 try {const p=await (c as any).ensure();const html=await readFile(new URL('./fixtures/browser-captcha.html',import.meta.url),'utf8');await p.route('https://rmc.bytedance.com/**',(r:any)=>r.abort());
 await p.setContent(html);const s=await p.evaluate(browserModule.readVisibleSnapshot);assert.equal(s.text,'');assert.equal(s.pageTitle,'验证码中间页');assert.equal(s.captchaFrame,true);assert.equal(JSON.stringify(s).includes('rmc.bytedance.com'),false);
 await assert.rejects((c as any).snapshot(p),/等待本人操作.*验证码/);
 await p.setContent('<title>抖音</title><iframe src="https://rmc.bytedance.com/verifycenter/captcha/v2" style="width:600px;height:400px"></iframe>');await assert.rejects((c as any).snapshot(p),/等待本人操作.*验证码/);
 await p.setContent('<title>抖音</title><p>正常页面</p><iframe src="https://rmc.bytedance.com/verifycenter/captcha/v2" style="display:none"></iframe>');assert.equal((await (c as any).snapshot(p)).captchaFrame,false);
 await p.setContent('<title>验证码中间页</title>');await assert.rejects((c as any).snapshot(p),/等待本人操作.*验证码/);
 }finally{await c.close();await rm(dir,{recursive:true,force:true});}
});
test('collector Chrome keeps the Chromium sandbox enabled',async()=>{
 assert.ok(browserModule);const {mkdtemp,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');const dir=await mkdtemp(path.join(os.tmpdir(),'douyin-sandbox-test-'));const c=new browserModule.BrowserCollector({profileDir:path.join(dir,'profile'),headless:true});
 try {
  await (c as any).ensure();
  const {execFileSync}=await import('node:child_process');
  const ownProfile=path.join(dir,'profile').replaceAll("'","''");
  const script="$ProgressPreference='SilentlyContinue';Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*"+ownProfile+"*' } | Select-Object -ExpandProperty CommandLine";
  const result=execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
  assert.ok(result.includes(ownProfile));assert.equal(result.includes('--no-sandbox'),false);
 }finally{await c.close();await rm(dir,{recursive:true,force:true});}
});

test('dual50 confirms visible filters, reads both independent lanes and retains all authors and provenance',async()=>{
 assert.ok(browserModule);const browser=await chromium.launch({channel:'chrome',headless:true});
 const c=new browserModule.BrowserCollector({profileDir:'unused'});
 try {const page=await browser.newPage();let details=0;const html=await readFile(new URL('./fixtures/browser-dual50.html',import.meta.url),'utf8');await page.route('https://www.douyin.com/**',(r:any)=>{if(r.request().url().includes('/video/'))details++;return r.fulfill({contentType:'text/html; charset=utf-8',body:html});});(c as any).ensure=async()=>page;
 const result=await c.search('FDE',{policy:'dual50',searchPerSort:50,maxSearchVideos:100,maxAuthors:20,profileMax:12});
 assert.equal(result.videos.length,89);assert.equal(result.authors.length,89);assert.match(result.reason,/1条缺少作者链接/);assert.ok(result.videos.some((v:any)=>v.id==='1089'));assert.ok(!result.videos.some((v:any)=>v.id==='1090'));
 assert.deepEqual(result.authors.find((a:any)=>a.id==='author-1040').sourceSorts,['likes','combined']);assert.equal(details,0);
 assert.deepEqual(await page.evaluate(()=> (window as any).actions),['最多点赞','半年内','视频','综合排序']);
 }finally{await browser.close();}
});

test('dual50 missing or unconfirmed visible filter stops after bounded automatic attempts',async()=>{
 assert.ok(browserModule);const browser=await chromium.launch({channel:'chrome',headless:true});
 try {for(const body of ['<button>筛选</button><button>最多点赞</button>','<button>筛选</button><button>最多点赞</button><button>半年内</button><button>视频</button>']){const page=await browser.newPage();await page.route('https://www.douyin.com/**',(r:any)=>r.fulfill({contentType:'text/html; charset=utf-8',body}));const c=new browserModule.BrowserCollector({profileDir:'unused'});(c as any).ensure=async()=>page;await assert.rejects(c.search('FDE',{policy:'dual50',searchPerSort:50,maxSearchVideos:100,maxAuthors:100,profileMax:12}),/自动筛选未完成/);await page.close();}}
 finally{await browser.close();}
});

test('profile returns scoped visible name and bio with first12 displayed video cards including pinned',async()=>{
 assert.ok(browserModule);const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage();const c=new browserModule.BrowserCollector({profileDir:'unused'});(c as any).ensure=async()=>page;
 let body='<nav><h1>导航昵称</h1></nav><header data-e2e="user-info"><h1 data-e2e="user-title">真实昵称</h1><div data-e2e="user-signature">AI与企业服务<br>长期实践</div><div hidden data-e2e="user-signature">隐藏简介</div></header><ul><li><a href="/video/1999"><h2>图片作品</h2></a></li>';
 for(let i=0;i<15;i++)body+='<li>'+(i===0?'置顶':'')+'<a href="/video/'+(2000+i)+'"><h2>作品'+i+'</h2><span>'+(i+1)+'</span></a></li>';body+='</ul><aside data-e2e="recommend"><h2>推荐昵称</h2><div data-e2e="user-signature">推荐简介</div></aside>';
 await page.route('https://www.douyin.com/**',(r:any)=>r.fulfill({contentType:'text/html; charset=utf-8',body}));const a={id:'author-A',name:'旧昵称',url:'https://www.douyin.com/user/author-A',coverage:'partial',reason:'',fetchedCount:0};
 const result=await c.collectAuthor(a,'2026-08-15T00:00:00Z',12);assert.equal(result.videos.length,12);assert.deepEqual(result.videos.map((v:any)=>v.id),['2000','2001','2002','2003','2004','2005','2006','2007','2008','2009','2010','2011']);assert.deepEqual(result.profile,{name:'真实昵称',bio:'AI与企业服务\n长期实践'});
 body='<header data-e2e="user-info"><h1 data-e2e="user-title">无简介昵称</h1></header><p>暂无作品</p>';const empty=await c.collectAuthor(a,'',12);assert.deepEqual(empty.profile,{name:'无简介昵称',bio:''});
 }finally{await browser.close();}
});

test('dual50 restores a cleared earlier filter before sampling',async()=>{
 assert.ok(browserModule);const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage();let html=await readFile(new URL('./fixtures/browser-dual50.html',import.meta.url),'utf8');html=html.replace("type=button.textContent;render();","type=button.textContent;if(group==='type')document.querySelector('[aria-label=排序] button').setAttribute('aria-pressed','false');render();");await page.route('https://www.douyin.com/**',(r:any)=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));const c=new browserModule.BrowserCollector({profileDir:'unused'});(c as any).ensure=async()=>page;
 const result=await c.search('FDE',{policy:'dual50',searchPerSort:50,maxSearchVideos:100,maxAuthors:100,profileMax:12});assert.equal(result.videos.length,89);for(const group of ['排序','发布时间','类型'])assert.equal(await page.locator('[aria-label="'+group+'"] [aria-pressed=true]').count(),1);
 }finally{await browser.close();}
});

test('profile first12 excludes authorless recommendation navigation comment and carousel cards before fallback attribution',async()=>{
 assert.ok(browserModule);const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage();const c=new browserModule.BrowserCollector({profileDir:'unused'});(c as any).ensure=async()=>page;let body=await readFile(new URL('./fixtures/browser-profile-scope.html',import.meta.url),'utf8');await page.route('https://www.douyin.com/**',(r:any)=>r.fulfill({contentType:'text/html; charset=utf-8',body}));
 const author={id:'author-A',name:'A',url:'https://www.douyin.com/user/author-A',coverage:'partial',reason:'',fetchedCount:0};
 for(const explicitRegion of [true,false]){if(!explicitRegion)body=body.replaceAll(' data-e2e="user-post-item"','').replaceAll(' data-e2e="user-post-list"','');const result=await c.collectAuthor(author,'',12);assert.deepEqual(result.videos.map((v:any)=>v.id),['3000','3001','3002','3003','3004','3005','3006','3007','3008','3009','3010','3011']);assert.ok(result.videos.every((v:any)=>v.authorId==='author-A'));}
 }finally{await browser.close();}
});
