import {collectionScope} from './collection-scope.js';
import {chromium, type BrowserContext, type Page} from 'playwright';
import sharp from 'sharp';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {organizeSearchAuthors} from './search-authors.js';
import {parseMetric, parsePublishDate, samplingTimes} from './domain.js';
import type {Collector, Video, Author, Limits, OperationOptions, SearchResult, ProfileResult, Frame, SearchCheckpoint, BrowserStatus} from './types.js';

// Serialized into the owned page: only visible UI evidence, never session storage or cookies.
function readLoginIndicator():BrowserStatus['login'] {
 if(location.hostname!=='douyin.com'&&!location.hostname.endsWith('.douyin.com'))return 'unknown';
 const visible=(element:Element)=>{if(!(element instanceof HTMLElement||element instanceof SVGElement))return false;const rect=element.getBoundingClientRect();return element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight;};
 const text=(element:Element)=>(element.textContent??'').trim();
 if(Array.from(document.querySelectorAll('iframe')).some(e=>visible(e)&&/captcha|verify|验证码|安全验证/i.test(`${e.getAttribute('src')??''} ${e.getAttribute('title')??''}`))||Array.from(document.querySelectorAll('[role="dialog"], [class*="captcha"], [id*="captcha"]')).some(e=>visible(e)&&/验证|captcha|verify/i.test(text(e)))||/安全验证|验证码/.test(document.title))return 'verification';
 const headers=Array.from(document.querySelectorAll('header,[role="banner"],[data-e2e="douyin-header"],[data-e2e="navigation-header"]'));
 if(headers.some(root=>Array.from(root.querySelectorAll('button,[role="button"],a')).some(e=>visible(e)&&/^(登录|登录抖音|立即登录|登录\/注册)$/.test(text(e))))||Array.from(document.querySelectorAll('[role="dialog"]')).some(e=>visible(e)&&/扫码登录|手机号登录|登录抖音/.test(text(e))))return 'logged_out';
 // A generic author avatar is not evidence of the viewer's login.
 if(headers.some(root=>Array.from(root.querySelectorAll('a[href]')).some(link=>{
  let self=false;try{const url=new URL(link.getAttribute('href')??'',location.href);self=url.origin===location.origin&&/^\/user\/self\/?$/.test(url.pathname);}catch{}
  return self&&visible(link)&&Array.from(link.querySelectorAll('img,[role="img"],[data-e2e="user-avatar"]')).some(visible);
 })))return 'logged_in';
 return 'unknown';
}

type Card = {href:string; text:string; title:string; authorHref:string; authorText:string; dateText:string; pinned:boolean; image:boolean; profilePost:boolean; durationText?:string; likeText?:string};
export type VisibleSnapshot = {text:string; cards:Card[]; metrics:{likes:string|null;favorites:string|null;shares:string|null}; dateText:string; title:string; authorHref:string; authorText:string;creatorVerified?:boolean;profilePostsPresent?:boolean;pageTitle:string;captchaFrame:boolean;mediaPresent?:boolean;profile?:{name:string;bio:string}};

/** Only rendered DOM text, links and labels. No page state, cookies or response bodies. */
function readDOMSnapshot():VisibleSnapshot {
 const visible = (el:Element):el is HTMLElement => { if(!(el instanceof HTMLElement))return false;const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
 const links=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(visible).filter(a=>!a.closest('nav,footer,[role=navigation]')&&!/[?&]source=Baiduspider/.test(a.href));
 const excludedProfileRegion='aside,nav,footer,[role="navigation"],[data-e2e*="recommend"],[data-e2e*="comment"],[data-e2e*="carousel"],[aria-roledescription="carousel"]';
 const postRegion='[data-e2e*="user-post-item"],[data-e2e="user-post-list"],[data-e2e="user-post"]';
 const hasPostRegion=Array.from(document.querySelectorAll(postRegion)).some(el=>visible(el)&&!el.closest(excludedProfileRegion));
 const cards=links.filter(a=>/\/video\/\d+/.test(a.getAttribute('href')||'')).map(a=>{
  let node:Element=a.closest('li,[data-e2e*="search-result"],[data-e2e*="user-post-item"],[data-e2e*="video-card"]')||a;
  if(node===a) {let p=a.parentElement; for(let i=0;p&&i<4;i++,p=p.parentElement) {if(p.querySelector('a[href*="/user/"]')) {node=p;break;} if(p.querySelectorAll('a[href*="/video/"]').length>1)break;}}
  const author=Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href*="/user/"]')).find(visible);
  // Current search cards wrap the whole item in the video link. The author is
  // two sibling spans (@ + full nickname), not an additional /user/ anchor.
  const nickname=Array.from(node.querySelectorAll<HTMLElement>('span')).filter(visible).find(el=>{
   const children=Array.from(el.children).filter(visible);
   return children.length===2&&children[0].innerText.trim()==='@'&&children[1].innerText.trim()!=='';
  });
  const nicknameText=nickname?(nickname.children[1] as HTMLElement).innerText.trim():'';
  const text=(node as HTMLElement).innerText||'';
  const heading=Array.from(node.querySelectorAll<HTMLElement>('h1,h2,h3,[data-e2e*="title"],[data-e2e*="desc"],a[href*="/video/"] p')).find(visible);
  const spans=Array.from(node.querySelectorAll<HTMLElement>('span')).filter(visible);
  const datePattern=/^(?:发布时间[：:]?\s*)?(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}月\d{1,2}日|\d{1,2}-\d{1,2}|\d+\s*(?:分钟|小时|天|周|个?月|年)前|昨天|今天)$/;
  const explicitDates=Array.from(node.querySelectorAll<HTMLElement>('time,[data-e2e*="publish"],[data-e2e*="date"]')).filter(visible);
  const date=explicitDates.concat(spans.filter(el=>!el.closest('a[href*="/video/"],h1,h2,h3,[data-e2e*="title"],[data-e2e*="desc"]'))).map(el=>el.innerText.trim()).find(t=>datePattern.test(t))?.replace(/^发布时间[：:]?\s*/,'')||'';
  const durationText=spans.find(el=>/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(el.innerText.trim()))?.innerText.trim();
  const likeText=spans.filter(el=>!el.closest('h1,h2,h3,[data-e2e*="title"],[data-e2e*="desc"]')).find(el=>/^\d+(?:\.\d+)?\s*[万亿wWkK]?$/.test(el.innerText.trim()))?.innerText.trim();
  // Profile attribution is allowed only in its posts, never incidental page links.
  const profilePost=!a.closest(excludedProfileRegion)&&Boolean(hasPostRegion?a.closest(postRegion):a.closest('main,ul'));
  return {durationText,likeText,href:a.href,text,title:heading?.innerText||a.getAttribute('title')||'',authorHref:author?.href||'',authorText:author?.innerText||nicknameText,dateText:date,pinned:/置顶/.test(text),image:/图文|图片作品/.test(text),profilePost};
 });
 const metrics:{likes:string|null;favorites:string|null;shares:string|null}={likes:null,favorites:null,shares:null};
 for(const el of Array.from(document.querySelectorAll<HTMLElement>('[data-e2e],[aria-label],button'))) {
  if(!visible(el))continue;
  const label=[el.getAttribute('data-e2e'),el.getAttribute('aria-label')].join(' ');
  const text=el.innerText.trim();
  const raw=text.match(/(?:\d+(?:\.\d+)?\s*[万亿wWkK]?)/)?.[0]||null;
  if(raw&&/digg|(?:^|[-_])like|点赞/i.test(label))metrics.likes=raw;
  if(raw&&/collect|favorite|收藏/i.test(label))metrics.favorites=raw;
  if(raw&&/share|分享/i.test(label))metrics.shares=raw;
 }
 // Verified public detail layout: like, comment, favorite, share siblings anchored by its labeled share node.
 for(const share of Array.from(document.querySelectorAll<HTMLElement>('[data-e2e=detail-video-info] [data-e2e=video-share-icon-container]')).filter(visible)){
  const siblings=Array.from(share.parentElement?.children||[]).filter(visible);
  const values=siblings.map(el=>(el as HTMLElement).innerText.trim());
  if(siblings.length===4&&siblings[3]===share&&values.every(x=>/^\d+(?:\.\d+)?\s*[万亿wWkK]?[+]?$/.test(x))){metrics.likes=values[0];metrics.favorites=values[2];metrics.shares=values[3];}
 }
 const text=document.body.innerText||'';
 const dateText=text.match(/发布时间[：:]?\s*(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?)/)?.[1]||'';
 const currentId=location.pathname.match(/^\/video\/(\d+)/)?.[1];
 const detail=Array.from(document.querySelectorAll<HTMLElement>('[data-e2e=detail-video-info]')).find(el=>visible(el)&&(!currentId||el.getAttribute('data-e2e-aweme-id')===currentId));
 const media=Array.from(document.querySelectorAll<HTMLVideoElement>('video')).find(visible);
 let scope:Element|null=detail||media?.parentElement||null;
 let author:HTMLAnchorElement|undefined;
 for(let i=0;scope&&scope!==document.body&&i<5;i++,scope=scope.parentElement){
  const local=Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href*="/user/"]')).filter(visible).filter(a=>a.innerText.trim()&&!/\/user\/(?:self|me)(?:[?/#]|$)/.test(a.href)&&!a.closest('nav,footer,[data-e2e*="comment"],[data-e2e*="recommend"]'));
  author=local.find(a=>a.querySelector('[data-click-from=title]'))||local[0];
  if(author)break;
 }
 const creators=Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-e2e="related-video"] [data-e2e="user-info"] a[href*="/user/"]')).filter(visible).filter(a=>a.innerText.trim()&&!/\/user\/(self|me)(?:[?#/]|$)/.test(a.href));
 const creatorIds=new Set(creators.map(a=>new URL(a.href,location.href).pathname));const creatorVerified=Boolean(currentId&&creatorIds.size===1);if(creatorVerified)author=creators[0];
 const h=Array.from(document.querySelectorAll<HTMLElement>('h1,[data-e2e="video-desc"]')).find(visible);
 // Read only the rendered iframe marker, never its challenge contents or full tokenized URL.
 const captchaFrame=Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).filter(visible).some(frame=>{
  try {const url=new URL(frame.getAttribute('src')||'',location.href);return url.hostname==='rmc.bytedance.com'&&url.pathname.startsWith('/verifycenter/captcha/');}catch{return false;}
 });
 const profileTitle=Array.from(document.querySelectorAll<HTMLElement>('[data-e2e="user-title"],[data-e2e="user-name"],[data-e2e="user-info"] h1,header h1')).find(el=>visible(el)&&!el.closest('nav,footer,[data-e2e*="recommend"],li'));
 const profileScope=profileTitle?.closest('[data-e2e="user-info"],[data-e2e="user-profile"],[data-e2e="user-header"],header')||profileTitle?.parentElement;
 const profileBio=profileScope&&Array.from(profileScope.querySelectorAll<HTMLElement>('[data-e2e="user-signature"],[data-e2e="user-bio"],[data-e2e="user-desc"]')).find(visible);
 const bioContainer=profileScope&&Array.from(profileScope.querySelectorAll<HTMLElement>('div')).filter(visible).find(el=>Array.from(el.children).some(c=>c instanceof HTMLElement&&c.tagName==='SPAN'&&c.innerText.trim())&&Array.from(el.children).some(c=>c instanceof HTMLElement&&c.tagName==='DIV'&&/^(更多|收起)$/.test(c.innerText.trim())));
 const expanded=bioContainer&&Array.from(bioContainer.querySelectorAll<HTMLElement>('p')).find(visible);
 const shortBio=profileScope&&Array.from(profileScope.children).filter(visible).find(el=>el.tagName==='DIV'&&el.children.length===1&&el.firstElementChild?.tagName==='SPAN'&&!el.getAttribute('data-e2e')?.startsWith('user-info-'));
 const fallbackBio=expanded?.innerText.trim()||Array.from(bioContainer?.children||[]).filter(c=>c instanceof HTMLElement&&c.tagName==='SPAN'&&visible(c)).map(c=>(c as HTMLElement).innerText.trim()).join('');
 const profile={name:profileTitle?.innerText.trim()||'',bio:profileBio?.innerText.trim()||fallbackBio||(shortBio as HTMLElement|undefined)?.innerText.trim()||''};
 return {text,cards,metrics,dateText,title:h?.innerText||'',authorHref:author?.href||'',authorText:author?.innerText||'',creatorVerified,profilePostsPresent:hasPostRegion,pageTitle:document.title,captchaFrame,mediaPresent:Boolean(media),profile};
}
// tsx preserves function names using a helper; supply it inside serialized browser functions.
function inPage<F extends Function>(fn:F):F {return new Function('const __name=(fn)=>fn;return ('+fn.toString()+')(...arguments);') as unknown as F;}
export const readVisibleSnapshot=inPage(readDOMSnapshot);
function stableAuthor(href:string):{id:string;url:string}|null {
 try {const u=new URL(href,'https://www.douyin.com');if(!/(^|\.)douyin\.com$/.test(u.hostname))return null;const id=u.pathname.match(/^\/user\/([^/]+)/)?.[1];return id&&!['self','me'].includes(id)?{id,url:`https://www.douyin.com/user/${id}`} :null;}catch{return null;}
}
function videoURL(href:string):{id:string;url:string}|null {
 try {const u=new URL(href,'https://www.douyin.com');if(!/(^|\.)douyin\.com$/.test(u.hostname))return null;const id=u.pathname.match(/^\/video\/(\d+)/)?.[1];return id?{id,url:`https://www.douyin.com/video/${id}`}:null;}catch{return null;}
}
function positiveBudget(value:number,fallback:number):number {return Number.isFinite(value)&&value>=1?Math.floor(value):fallback;}
function relatedText(text:string,keyword:string):boolean {return text.replace(/\s+/g,'').toLowerCase().includes(keyword.replace(/\s+/g,'').toLowerCase());}
export function parseCards(snapshot:VisibleSnapshot,keyword:string,now=new Date(),author?:Author):Video[] {
 const videos=new Map<string,Video>();
 for(const c of snapshot.cards) {
  if(author&&!c.profilePost)continue;
  const address=videoURL(c.href);if(!address||videos.has(address.id))continue;
  const identity=stableAuthor(c.authorHref)||(author?{id:author.id,url:author.url}:null);
  const durationText=c.durationText||c.text.match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/)?.[0]||'';
  const duration=durationText?durationText.split(':').reduce((s,n)=>s*60+Number(n),0):null;
  const parts=c.text.split(/\n/).map(x=>x.trim()).filter(Boolean);
  const afterDuration=durationText?c.text.slice(c.text.indexOf(durationText)+durationText.length).trim():'';
  const like=c.likeText||afterDuration.match(/^(\d+(?:\.\d+)?\s*[万亿wWkK]?)(?=\s|$|[^\d.万亿wWkK])/i)?.[1]||null;
  const title=c.title.trim()||parts.filter(p=>p!==durationText&&p!==like&&p!==c.authorText&&p!==c.dateText&&p!=='置顶').join(' ').replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/,'').slice(0,2000);
  videos.set(address.id,{...address,authorId:identity?.id||'',authorName:c.authorText||author?.name||'',authorUrl:identity?.url||'',title,description:c.text,dateText:c.dateText,publishedAt:parsePublishDate(c.dateText,now),duration,likes:parseMetric(like),favorites:parseMetric(null),shares:parseMetric(null),kind:c.image?'image':'unknown',related:relatedText(title+' '+c.text,keyword),collectedAt:now.toISOString(),frames:[]});
 }
 return [...videos.values()];
}
export function detectUserBlock(text:string,markers?:{pageTitle?:string;captchaFrame?:boolean}):string|null {
 if(markers?.captchaFrame||/验证码中间页|安全验证|验证码/.test(markers?.pageTitle||''))return '等待本人操作：抖音验证码或安全验证页面，请在采集浏览器完成后继续';
 if(/安全验证|请完成验证|拖动滑块|请输入验证码后继续|验证后继续|访问过于频繁|操作过于频繁|访问受限|异常访问|环境异常/.test(text))return '等待本人操作：抖音要求验证或限制访问，请在采集浏览器完成后继续';
 if(/登录后(?:查看|观看|继续|可见|免费畅享)|请先登录(?!后发表|后评论|后发布)|扫码登录后|登录即可(?:查看|观看)/.test(text))return '等待本人登录：请在采集浏览器登录后继续';
 if(/网络异常|网络错误|页面加载失败|服务器开小差|无法访问此网站|无法连接到互联网|网页无法打开|ERR_(?:CONNECTION|INTERNET|NETWORK|NAME|TIMED|PROXY)|This site can[’']t be reached/.test(text))return '页面加载失败：请检查网络后重试';
 return null;
}
export function coverageFromPage(text:string,count:number,limit:number):Pick<ProfileResult,'coverage'|'reason'> {
 if(count>=limit)return {coverage:'partial',reason:`达到本次账号读取预算（${limit}条），未证实窗口完整`};
 if(/(?:暂时)?没有更多(?:了|作品|内容)?|已展示全部作品|全部作品已加载|暂无作品|还没有发布作品/.test(text))return {coverage:'complete',reason:'页面明确显示无更多作品'};
 return {coverage:'partial',reason:'页面未明确显示结束，不能证实所选时间完整覆盖（置顶或旧作品不作为结束依据）'};
}
export function isFreshFrame(target:number,state:{time:number;readyState:number;decodedTime:number;seeking:boolean}):boolean {
 return !state.seeking&&state.readyState>=2&&Math.abs(state.time-target)<=0.35&&Number.isFinite(state.decodedTime)&&Math.abs(state.decodedTime-target)<=0.35;
}
export function normalizeTargets(targets:number[],duration:number,existing:number):number[] {
 if(!Number.isFinite(duration)||duration<=0)return [];
 const out:number[]=[];for(const t of targets) {if(!Number.isFinite(t))continue;const n=Math.round(Math.max(0,Math.min(duration-0.2,t))*1000)/1000;if(!out.some(x=>Math.abs(x-n)<0.12))out.push(n);if(out.length>=Math.max(0,10-existing))break;}
 return existing>=10?[]:out;
}
export function sameFramePixels(a:Uint8Array,b:Uint8Array):boolean {
 if(a.length!==b.length||!a.length)return false;let error=0;let changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);error+=d;if(d>15)changed++;}return error/a.length<3&&changed/a.length<0.02;
}
function abort(options?:OperationOptions):void {options?.signal?.throwIfAborted();}
async function wait(ms:number,options?:OperationOptions):Promise<void> {
 abort(options);await new Promise<void>((resolve,reject)=>{const finish=()=>{options?.signal?.removeEventListener('abort',stop);resolve();};const timer=setTimeout(finish,ms);const stop=()=>{clearTimeout(timer);reject(options?.signal?.reason||new DOMException('已取消','AbortError'));};options?.signal?.addEventListener('abort',stop,{once:true});});abort(options);
}
function readableError(error:unknown):Error {
 const message=error instanceof Error?error.message:String(error);
 if(/Target page, context or browser has been closed|Browser has been closed|disconnected|Target closed/i.test(message))return new Error('等待本人操作：采集浏览器已关闭或断开，请点击打开浏览器后继续');
 return error instanceof Error?error:new Error(message);
}

export class BrowserCollector implements Collector {
 private context?:BrowserContext;
 private page?:Page;
 private launching?:Promise<Page>;
 private generation=0;
 private recoveryEpoch=0;
 private timings:{navigation:number;click:number;scroll:number;stability:number};
 constructor(private config:{profileDir:string;headless?:boolean;timings?:Partial<{navigation:number;click:number;scroll:number;stability:number}>}) {
  this.timings={navigation:2000,click:1000,scroll:1500,stability:1000,...config.timings};
 }
 private async operation<T>(run:()=>Promise<T>,options?:OperationOptions):Promise<T> {
  abort(options);let stop:(()=>void)|undefined;
  try{return await Promise.race([run(),new Promise<never>((_resolve,reject)=>{stop=()=>reject(options?.signal?.reason||new DOMException('已取消','AbortError'));options?.signal?.addEventListener('abort',stop,{once:true});if(options?.signal?.aborted)stop();})]);}
  finally{if(stop)options?.signal?.removeEventListener('abort',stop);abort(options);}
 }
 private async stableRead<T>(page:Page,read:()=>Promise<T>,options?:OperationOptions):Promise<T> {
  for(let attempt=0;attempt<3;attempt++) {
   abort(options);if(page.isClosed?.())throw readableError(new Error('Target page, context or browser has been closed'));
   try{return await this.operation(read,options);}catch(error){abort(options);const e=readableError(error);if(attempt===2||!/Execution context was destroyed|Cannot find context with specified id|most likely because of a navigation|interrupted by another navigation/i.test(e.message))throw e;
    options?.onProgress?.('页面正在跳转，等待 DOM 稳定后重新读取');
    try{await this.operation(()=>page.waitForLoadState('domcontentloaded',{timeout:5000}),options);}catch(error){abort(options);if(!/Timeout/i.test(String(error)))throw readableError(error);}
    await wait(this.timings.stability,options);
   }
  }throw new Error('页面加载失败：页面持续跳转，请稍后继续');
 }
 private async ensure():Promise<Page> {
  if(this.context) {if(!this.page||this.page.isClosed())throw new Error('等待本人操作：采集浏览器已关闭，请点击打开浏览器后继续');return this.page;}
  if(this.launching)return this.launching;
  const generation=this.generation;
  this.launching=(async()=>{await mkdir(this.config.profileDir,{recursive:true});const context=await chromium.launchPersistentContext(path.resolve(this.config.profileDir),{channel:'chrome',headless:this.config.headless??false,chromiumSandbox:true,viewport:{width:1440,height:1000}});if(generation!==this.generation){await context.close();throw new DOMException('采集启动已取消','AbortError');}this.context=context;this.page=context.pages()[0]||await context.newPage();return this.page;})();
  try{return await this.launching;}catch(error){if(generation!==this.generation)throw new DOMException('采集启动已取消','AbortError');throw new Error(`无法启动独立Chrome采集浏览器：${error instanceof Error?error.message:String(error)}`);}finally{this.launching=undefined;}
 }
 async openLogin():Promise<void> {
  if(this.context&&(!this.page||this.page.isClosed())){await this.context.close().catch(()=>{});this.context=undefined;this.page=undefined;}
  const page=await this.ensure();await page.bringToFront();if(!/douyin\.com/.test(page.url()))await this.goto('https://www.douyin.com/',{});
 }
 async getBrowserStatus():Promise<BrowserStatus> {
  const result=(browser:BrowserStatus['browser'],login:BrowserStatus['login'],message:string):BrowserStatus=>({browser,login,message,checkedAt:new Date().toISOString()});
  if(this.launching)return result('opening','unknown','采集浏览器正在打开');
  const page=this.page;
  if(!this.context||!page||page.isClosed())return result('closed','unknown','采集浏览器未打开');
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
   const url=new URL(page.url());if(url.hostname!=='douyin.com'&&!url.hostname.endsWith('.douyin.com'))return result('open','unknown','浏览器已打开，当前页面无法确认抖音登录状态');
   const login=await Promise.race([page.evaluate(inPage(readLoginIndicator)),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('status timeout')),1800);})]);
   if(this.page!==page||page.isClosed()||page.url()!==url.href)return result(this.page&&!this.page.isClosed()?'open':'closed','unknown','浏览器状态已变化，请刷新');
   const messages={logged_in:'已通过当前页面确认抖音已登录',logged_out:'请在采集浏览器完成抖音登录',verification:'请在采集浏览器完成安全验证',unknown:'浏览器已打开，暂未确认抖音登录状态'};
   return result('open',login,messages[login]);
  }catch{return result(page.isClosed()?'closed':'open','unknown','页面加载或切换中，暂未确认登录状态');}
  finally{clearTimeout(timeout);}
 }
 private async goto(url:string,options?:OperationOptions):Promise<Page> {
  abort(options);const page=await this.ensure();
  if(/^\/video\/\d+$/.test(new URL(url).pathname)){const current=new URL(page.url());const target=new URL(url);if(current.origin===target.origin&&current.pathname===target.pathname){await this.snapshot(page,options);return page;}}
  const target=new URL(url);const atTarget=()=>{try{const current=new URL(page.url());return current.origin===target.origin&&current.pathname===target.pathname;}catch{return false;}};
  for(let attempt=0;attempt<3;attempt++) {
   let failed=false;
   try{await this.operation(()=>page.goto(url,{waitUntil:'domcontentloaded',timeout:30000}),options);}
   catch(error){abort(options);const e=readableError(error);if(/等待本人/.test(e.message)||!/net::|Timeout|navigation/i.test(e.message))throw e;failed=true;}
   await wait(this.timings.navigation,options);
   if(failed&&!atTarget()) {
    // A failed navigation may leave the preceding author's DOM intact. Never attribute it to the target.
    const previous=await this.stableRead(page,()=>page.evaluate(readVisibleSnapshot),options);const block=detectUserBlock(previous.text,previous);if(block?.startsWith('等待本人'))throw new Error(block);
    if(attempt===2)throw new Error('等待本人操作：页面加载失败，目标页面未打开；已停止读取，避免将上一页内容归属到当前作者');
    options?.onProgress?.(`目标页面未打开，等待后重新打开目标链接（${attempt+1}/2）`);await wait(this.timings.stability,options);continue;
   }
   await this.snapshot(page,options);
   if(!atTarget())throw new Error('等待本人操作：页面地址已变化，无法确认当前作品或作者，请检查采集浏览器后继续');
   return page;
  }throw new Error('等待本人操作：页面加载失败');
 }
 private async snapshot(page:Page,options?:OperationOptions):Promise<VisibleSnapshot> {
  for(let reloads=0;reloads<=2;reloads++) {
   let snapshot=await this.stableRead(page,()=>page.evaluate(readVisibleSnapshot),options);
   const check=(value:VisibleSnapshot)=>{const block=detectUserBlock(value.text,value);if(block?.startsWith('等待本人'))throw new Error(block);return Boolean(block)||(!value.text.trim()&&!value.cards.length&&!value.title&&!value.profile?.name&&!value.mediaPresent);};
   if(!check(snapshot)){if(reloads)options?.onProgress?.(`页面已恢复（重新加载${reloads}次），继续原进度`);return snapshot;}
   await wait(this.timings.stability,options);
   snapshot=await this.stableRead(page,()=>page.evaluate(readVisibleSnapshot),options);
   if(!check(snapshot))return snapshot;
   if(reloads===2)throw new Error('等待本人操作：页面加载失败：等待及两次重新加载后仍为空白或网络异常，请检查采集浏览器后继续');
   options?.onProgress?.(`页面空白或网络加载失败，正在有限重新加载（${reloads+1}/2）`);
   abort(options);this.recoveryEpoch++;
   try{await this.operation(()=>page.reload({waitUntil:'domcontentloaded',timeout:30000}),options);}catch(error){abort(options);const e=readableError(error);if(/等待本人/.test(e.message)||!/net::|Timeout|navigation/i.test(e.message))throw e;}
   await wait(this.timings.navigation,options);
  }throw new Error('页面加载失败');
 }
 private async scroll(page:Page,options?:OperationOptions):Promise<void> {
  abort(options);try {await this.stableRead(page,()=>page.evaluate(inPage(()=>{const candidates=Array.from(document.querySelectorAll<HTMLElement>('main,section,div')).filter(el=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return r.width>250&&r.height>200&&el.scrollHeight>el.clientHeight+100&&/auto|scroll/.test(s.overflowY);});const largest=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0];if(largest)largest.scrollBy(0,Math.max(600,largest.clientHeight*0.85));else window.scrollBy(0,Math.max(600,innerHeight*0.85));})),options);await wait(this.timings.scroll,options);}catch(e){throw readableError(e);}
 }
 async search(keyword:string,limits:Limits,options?:OperationOptions):Promise<SearchResult> {
  if(!keyword.trim())throw new Error('请输入搜索关键词');
  if(limits.policy==='raw50')return this.searchRaw50(keyword,collectionScope({searchLimit:limits.maxSearchVideos}).searchLimit,options);
  if(limits.policy==='dual50'||limits.policy==='combined50')return this.searchDual50(keyword,options,limits.policy==='combined50');
  limits={searchPerSort:positiveBudget(limits.searchPerSort,100),maxSearchVideos:positiveBudget(limits.maxSearchVideos,200),maxAuthors:positiveBudget(limits.maxAuthors,20),profileMax:positiveBudget(limits.profileMax,300)};
  const page=await this.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword.trim())}?type=video`,options);
  const videos=new Map<string,Video>(),pending=new Map<string,Video>(),authors=new Map<string,Author>();
  const sortNames=['综合','最多点赞','最新发布'];const usedSorts:string[]=[];let reason='';
  for(const sort of sortNames) {
   abort(options);if(videos.size+pending.size>=limits.maxSearchVideos)break;
   if(sort!=='综合') {
    let control=page.getByText(sort,{exact:true});
    if(!await control.count()||!await control.first().isVisible()) {const filter=page.getByText('筛选',{exact:true});if(await filter.count()&&await filter.first().isVisible()){await this.operation(()=>filter.first().click({timeout:3000}),options);await wait(this.timings.click,options);}control=page.getByText(sort,{exact:true});}
    if(!await control.count()||!await control.first().isVisible())continue;
    await this.operation(()=>control.first().click({timeout:5000}),options);await wait(this.timings.click,options);
   }
   usedSorts.push(sort);let stagnant=0;const seen=new Set<string>();
   for(let round=0;round<40&&seen.size<limits.searchPerSort&&videos.size+pending.size<limits.maxSearchVideos;round++) {
    const snapshot=await this.snapshot(page,options);const cards=parseCards(snapshot,keyword);const before=seen.size;
    for(const video of cards) {
     if(seen.size>=limits.searchPerSort||videos.size+pending.size>=limits.maxSearchVideos)break;
     seen.add(video.id);
     if(!video.authorId){if(!videos.has(video.id))pending.set(video.id,video);continue;}
     pending.delete(video.id);
     if(!authors.has(video.authorId)&&authors.size>=limits.maxAuthors)continue;
     if(!authors.has(video.authorId))authors.set(video.authorId,{id:video.authorId,name:video.authorName,url:video.authorUrl,coverage:'partial',reason:'仅搜索候选，尚未读取账号作品',fetchedCount:0});
     if(!videos.has(video.id))videos.set(video.id,video);
    }
    options?.onProgress?.(`搜索${sort}：已找到${videos.size}条作品、${authors.size}位作者`,{completed:videos.size,unit:'条候选作品'});
    stagnant=seen.size===before?stagnant+1:0;
    if(stagnant>=3||coverageFromPage(snapshot.text,seen.size,limits.searchPerSort).coverage==='complete')break;
    await this.scroll(page,options);
   }
  }
  const unattributed=pending.size; // Never open video details to recover missing authors.
  if(!videos.size)throw new Error('未读到可归属作者的公开视频列表；可能需要登录、页面尚未加载或页面结构已变化，请检查采集浏览器后重试');
  reason=`已采集样本内：可用排序${usedSorts.join('、')}；${videos.size}条作品、${authors.size}位作者。搜索排序和预算不代表全站覆盖；${unattributed}条缺少作者链接已跳过，不打开详情补取`;
  return {videos:[...videos.values()],authors:[...authors.values()],reason};
 }
 private filterSpec(labels:string[]){
  if(labels.includes('半年内'))return {index:'1',heading:'发布时间',values:['不限','一天内','一周内','半年内']};
  if(labels.includes('视频'))return {index:'4',heading:'内容形式',values:['不限','视频','图文']};
  return {index:'0',heading:'排序依据',values:['综合排序','最新发布','最多点赞']};
 }
 private async chooseSearchFilter(page:Page,labels:string[],options?:OperationOptions):Promise<void> {
  const spec=this.filterSpec(labels);
  const find=async()=>{
   for(const selector of [`[data-index1="${spec.index}"][data-index2]`,'button,[role=option],[role=radio],[role=menuitemradio]'])for(const label of labels){
    if(label==='综合')continue; // The header tab is not the comprehensive-sort option.
    const candidate=page.locator(selector).filter({hasText:new RegExp('^'+label+'$'),visible:true});if(await candidate.count())return candidate.first();
   }return null;
  };
  for(let attempt=0;attempt<3;attempt++){
   abort(options);if(attempt)options?.onProgress?.(`自动重试筛选“${labels[0]}”（${attempt+1}/3），重新检查菜单`);
   try{
    await this.snapshot(page,options);
    if(await this.searchFilterSelected(page,labels,options))return;
    let control=await find();
    if(!control||attempt){
     const trigger=page.getByText('筛选',{exact:true}).filter({visible:true});
     if(await trigger.count()){
      await this.operation(()=>trigger.first().hover({timeout:3000}),options);await wait(this.timings.click,options);
      if(!await find()){await this.operation(()=>trigger.first().click({timeout:3000}),options);await wait(this.timings.click,options);}
     }
     control=await find();
    }
    if(await this.searchFilterSelected(page,labels,options))return;
    if(!control)continue;
    await this.operation(()=>control!.click({timeout:5000}),options);await wait(this.timings.click,options);
    const epoch=this.recoveryEpoch;await this.snapshot(page,options);if(epoch!==this.recoveryEpoch)return;
    await this.confirmSearchFilter(page,labels,options);return;
   }catch(error){abort(options);const e=readableError(error);if(/等待本人|浏览器.*关闭|断开|验证码|captcha|访问受限/i.test(e.message))throw e;if(attempt===2)break;}
   await wait(this.timings.stability,options);
  }
  throw new Error(`自动筛选未完成：“${labels[0]}”已自动尝试3次；已保留进度，可点击继续重试`);
 }
 private async searchFilterSelected(page:Page,labels:string[],options?:OperationOptions):Promise<boolean>{
  const spec=this.filterSpec(labels);
  return this.stableRead(page,()=>page.evaluate(inPage((input:{names:string[];index:string;heading:string;values:string[]})=>{
   const visible=(el:Element):el is HTMLElement=>{if(!(el instanceof HTMLElement))return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
   const marked=(el:HTMLElement)=>['aria-selected','aria-pressed','aria-checked'].some(a=>el.getAttribute(a)==='true')||['checked','active'].includes(el.getAttribute('data-state')||'')||/(?:^|[\s_-])(?:active|selected|checked)(?:$|[\s_-])/i.test(el.getAttribute('class')||'');
   const indexed=Array.from(document.querySelectorAll(`[data-index1="${input.index}"][data-index2]`)).filter(visible);
   if(indexed.length){
    const redSelected=(el:HTMLElement)=>{const style=getComputedStyle(el),fg=(style.color.match(/[\d.]+/g)||[]).map(Number),bg=(style.backgroundColor.match(/[\d.]+/g)||[]).map(Number);return fg.length>=3&&bg.length===4&&fg[0]>180&&fg[1]<110&&fg[2]<170&&bg[3]>0&&fg.slice(0,3).every((v,i)=>Math.abs(v-bg[i])<6)&&Number(style.fontWeight)>=500;};
    return indexed.some(el=>{
     if(!input.names.includes(el.innerText.trim()))return false;
     const parent=el.parentElement;if(!parent||!Array.from(parent.children).some(n=>visible(n)&&n.innerText.trim()===input.heading))return false;
     const peers=indexed.filter(n=>n.parentElement===parent);if(!input.values.every(value=>peers.some(n=>n.innerText.trim()===value)))return false;
     if(marked(el))return true;
     const uniqueClass=Array.from(el.classList).some(token=>peers.every(n=>n===el||!n.classList.contains(token)));
     const commonClass=Array.from(el.classList).some(token=>peers.every(n=>n.classList.contains(token)));
     const highlighted=peers.filter(redSelected);return uniqueClass&&commonClass&&highlighted.length===1&&highlighted[0]===el;
    });
   }
   // Generic page tabs cannot prove a filter's selected state.
   return Array.from(document.querySelectorAll('button,[role=option],[role=radio],[role=menuitemradio]')).filter(visible).some(el=>!el.closest('[role=tab],[role=tablist],nav,header')&&input.names.includes(el.innerText.trim())&&marked(el));
  }),{names:labels,...spec}),options);
 }
 private async confirmSearchFilter(page:Page,labels:string[],options?:OperationOptions):Promise<void>{
  if(!await this.searchFilterSelected(page,labels,options))throw new Error(`自动筛选未完成：无法确认搜索筛选“${labels[0]}”的选中状态`);
 }
 private async applySearchLane(page:Page,labels:string[],options?:OperationOptions):Promise<void> {
  for(let attempt=0;attempt<3;attempt++) {
   const epoch=this.recoveryEpoch;const groups=[labels,['半年内'],['视频']];
   for(const group of groups){await this.chooseSearchFilter(page,group,options);if(this.recoveryEpoch!==epoch)break;}
   if(this.recoveryEpoch!==epoch)continue;
   try{for(const group of groups)await this.confirmSearchFilter(page,group,options);return;}
   catch(error){abort(options);if(!/自动筛选未完成/.test(String(error)))throw error;options?.onProgress?.(`筛选组合发生变化，自动重新核对（${attempt+1}/3）`);}
  }
  throw new Error('自动筛选未完成：筛选组合在3次核对后仍不稳定；已保留进度，可点击继续重试');
 }
 private async searchRaw50(keyword:string,searchLimit:number,options?:OperationOptions):Promise<SearchResult> {
  keyword=keyword.trim();const saved=options?.searchCheckpoint;
  if(saved?.policy==='raw50'&&(saved.searchLimit??50)!==searchLimit)throw new Error('搜索断点上限与本任务采集范围不一致，不能按其他预算续跑');
  const valid=saved?.version===1&&saved.policy==='raw50'&&saved.keyword===keyword&&Array.isArray(saved.videos)&&saved.videos.length<=searchLimit&&new Set(saved.videos.map(v=>v.id)).size===saved.videos.length&&typeof saved.lanes?.combined?.done==='boolean';
  const recovered=organizeSearchAuthors(valid?saved.videos:[]);const videos=new Map<string,Video>(recovered.videos.map(v=>[v.id,structuredClone(v)]));
  const authors=new Map<string,Author>();
  const addAuthor=(v:Video)=>{const a=organizeSearchAuthors([v]).authors[0];if(a&&!authors.has(a.id))authors.set(a.id,a);};
  for(const v of videos.values())addAuthor(v);
  let done=valid&&saved.lanes.combined.done,reason='';
  const save=async()=>{abort(options);await options?.onSearchCheckpoint?.({version:1,policy:'raw50',searchLimit,keyword,videos:[...videos.values()],authors:[...authors.values()],lanes:{likes:{seenIds:[],done:true},combined:{seenIds:[...videos.keys()],done}},reason:`已保存搜索视频${videos.size}/${searchLimit}条、去重博主${authors.size}位`});abort(options);};
  if(!done&&videos.size<searchLimit){
   const page=await this.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`,options);let stagnant=0;const traversed=new Set<string>();let epoch=this.recoveryEpoch;
   for(let round=0;round<60&&videos.size<searchLimit;round++){
    const snapshot=await this.snapshot(page,options);if(epoch!==this.recoveryEpoch){traversed.clear();stagnant=0;epoch=this.recoveryEpoch;}
    const before=traversed.size;
    for(const v of organizeSearchAuthors(parseCards(snapshot,keyword)).videos){traversed.add(v.id);if(v.kind==='image'||videos.has(v.id))continue;if(videos.size>=searchLimit)break;videos.set(v.id,v);addAuthor(v);}
    await save();options?.onProgress?.(`读取搜索视频${videos.size}/${searchLimit}条，去重博主${authors.size}位`,{completed:videos.size,total:searchLimit,unit:'条视频卡片'});
    stagnant=before===traversed.size?stagnant+1:0;
    if(videos.size>=searchLimit){done=true;reason=`已读取前${searchLimit}条`;break;}
    if(coverageFromPage(snapshot.text,videos.size,searchLimit).coverage==='complete'){done=true;reason='页面显示已到底';break;}
    if(stagnant>=3){reason='连续滚动未出现新视频，不能证明已经到底；可继续重试';break;}
    if(round===59){reason='达到本次滚动上限，可继续重试';break;}
    await this.scroll(page,options);
   }
  }else if(videos.size>=searchLimit){done=true;reason=`已读取前${searchLimit}条`;}
  if(!videos.size)throw new Error('未读到搜索视频卡片，请检查登录、页面加载或页面结构后重试');
  await save();
  return {videos:[...videos.values()],authors:[...authors.values()],reason:`${reason||'已恢复已完成搜索'}；实际${videos.size}/${searchLimit}条视频、${authors.size}位去重博主；${[...videos.values()].filter(v=>!v.authorId).length}条作者未识别；${[...authors.values()].filter(a=>a.identity!=='account').length}个昵称候选未核实主页。按搜索页面出现顺序，不操作排序或时间筛选、不访问主页；搜索卡片类型未明确时保留未核实标记。`,complete:done};
 }
 private async searchDual50(keyword:string,options?:OperationOptions,combinedOnly=false):Promise<SearchResult> {
  keyword=keyword.trim();const saved=options?.searchCheckpoint;
  const policy=combinedOnly?'combined50':'dual50';
  const valid=saved?.version===1&&(saved.policy??'dual50')===policy&&saved.keyword===keyword&&Array.isArray(saved.videos)&&Array.isArray(saved.authors)&&['likes','combined'].every(id=>{const lane=saved.lanes?.[id as 'likes'|'combined'];return lane&&typeof lane.done==='boolean'&&Array.isArray(lane.seenIds)&&lane.seenIds.length<=50&&lane.seenIds.every(x=>typeof x==='string');})&&saved.videos.length<=(combinedOnly?50:100)&&(!combinedOnly||saved.lanes.likes.seenIds.length===0);
  const videos=new Map<string,Video>((valid?saved.videos:[]).map(v=>[v.id,structuredClone(v)])),authors=new Map<string,Author>((valid?saved.authors:[]).map(a=>[a.id,structuredClone(a)]));
  const lanes:SearchCheckpoint['lanes']=valid?structuredClone(saved.lanes):{likes:{seenIds:[],done:combinedOnly},combined:{seenIds:[],done:false}};
  const unattributed=new Set<string>();
  for(const state of Object.values(lanes))for(const id of state.seenIds)if(!videos.has(id))unattributed.add(id);
  const checkpoint=async()=>{abort(options);await options?.onSearchCheckpoint?.({version:1,policy,keyword,videos:[...videos.values()],authors:[...authors.values()],lanes:structuredClone(lanes),reason:'搜索已保存本路进度；仅补未完成部分'});abort(options);};
  const page=lanes.likes.done&&lanes.combined.done?null:await this.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`,options);
  const routes:{id:'likes'|'combined';labels:string[]}[]=combinedOnly?[{id:'combined',labels:['综合排序','综合']}]:[{id:'likes',labels:['最多点赞']},{id:'combined',labels:['综合排序','综合']}];
  for(const lane of routes) {
   if(lanes[lane.id].done)continue;
   await this.applySearchLane(page!,lane.labels,options);let epoch=this.recoveryEpoch;
   const seen=new Set(lanes[lane.id].seenIds),traversed=new Set<string>();let stagnant=0;
   for(let round=0;round<40&&seen.size<50;round++) {
    let snapshot=await this.snapshot(page!,options);
    if(epoch!==this.recoveryEpoch){traversed.clear();stagnant=0;await this.applySearchLane(page!,lane.labels,options);epoch=this.recoveryEpoch;snapshot=await this.snapshot(page!,options);if(epoch!==this.recoveryEpoch)throw new Error('等待本人操作：页面加载失败：恢复筛选后再次重新加载，请继续重试');}
    const before=traversed.size;
    for(const video of parseCards(snapshot,keyword)) {
     traversed.add(video.id);
     if(seen.size>=50)break;if(seen.has(video.id))continue;seen.add(video.id);
     if(!video.authorId){unattributed.add(video.id);continue;}
     let author=authors.get(video.authorId);
     if(!author){author={id:video.authorId,name:video.authorName,url:video.authorUrl,coverage:'partial',reason:'仅搜索候选，尚未读取账号作品',fetchedCount:0,sourceSorts:[]};authors.set(author.id,author);}
     author.sourceSorts??=[];if(!author.sourceSorts.includes(lane.id))author.sourceSorts.push(lane.id);
     if(!videos.has(video.id))videos.set(video.id,video);
    }
    lanes[lane.id].seenIds=[...seen];await checkpoint();
    options?.onProgress?.(`搜索${lane.labels[0]}：本路${seen.size}/50，去重后${videos.size}条作品、${authors.size}位作者`,{completed:seen.size,total:50,unit:'条本路作品'});
    stagnant=before===traversed.size?stagnant+1:0;
    if(seen.size>=50||stagnant>=3||coverageFromPage(snapshot.text,seen.size,50).coverage==='complete')break;
    await this.scroll(page!,options);
   }
   lanes[lane.id].done=true;await checkpoint();
  }
  if(!videos.size)throw new Error('未读到可归属作者的公开视频列表，请检查采集浏览器后重试');
  return {videos:[...videos.values()],authors:[...authors.values()],reason:`已确认半年内、视频筛选；${combinedOnly?'':`最多点赞${lanes.likes.seenIds.length}/50、`}综合排序${lanes.combined.seenIds.length}/50；去重后${videos.size}条作品、${authors.size}位作者。${unattributed.size}条缺少作者链接已跳过，不打开详情补取；搜索样本不代表全站覆盖`};
 }
 async resolveAuthor(video:Video,options?:OperationOptions):Promise<Author>{
  const address=videoURL(video.url);if(!address||address.id!==video.id)throw new Error('来源视频地址与ID不一致，不能确认作者');
  const page=await this.goto(address.url,options);
  for(let attempt=0;attempt<6;attempt++){
   const snapshot=await this.snapshot(page,options),identity=stableAuthor(snapshot.authorHref);
   if(snapshot.creatorVerified&&identity)return {id:identity.id,url:identity.url,name:snapshot.authorText.trim()||video.authorName,identity:'account',coverage:'partial',reason:'已从来源视频的作者面板核实主页链接',fetchedCount:0};
   if(attempt<5)await wait(this.timings.stability,options);
  }
  throw new Error('来源视频未显示可核实的作者面板；不使用评论者、推荐账号或同昵称搜索结果代替');
 }
 async collectAuthor(author:Author,cutoff:string,limit:number,options?:OperationOptions):Promise<ProfileResult> {
  const identity=stableAuthor(author.url);if(!identity||identity.id!==author.id)throw new Error('作者主页缺少稳定公开链接，无法采集');
  const cap=positiveBudget(limit,300);const page=await this.goto(identity.url,options);
  let bioExpanded=false;
  const videos=new Map<string,Video>();let stagnant=0;let coverage:Pick<ProfileResult,'coverage'|'reason'>={coverage:'partial',reason:'尚未读取作品'};
  for(let round=0;round<100&&videos.size<cap;round++) {
   if(!bioExpanded){const more=page.locator('[data-e2e="user-info"]').getByText('更多',{exact:true});if(await more.count()&&await more.first().isVisible()){await this.operation(()=>more.first().click({timeout:3000}),options);await wait(this.timings.click,options);bioExpanded=true;}}
   const snapshot=await this.snapshot(page,options);const before=videos.size;
   if(options?.requireOwnPosts&&!snapshot.profilePostsPresent){if(round>=3)throw Error('未能确认主页作品分区，未读取喜欢、收藏或推荐作品');await wait(this.timings.stability,options);continue;}
   for(const video of parseCards(snapshot,'',new Date(),author)) {if(videos.size>=cap)break;if((options?.requireOwnPosts||cap===12)&&video.kind==='image')continue;if(video.authorId===author.id&&!videos.has(video.id))videos.set(video.id,video);}
   coverage=coverageFromPage(snapshot.text,videos.size,cap);
   options?.onProgress?.(`读取${author.name}：${videos.size}/${cap}条，只读卡片，日期缺失标记未核实；窗口起点${cutoff}`,{completed:videos.size,total:cap,unit:'条账号作品'});
   if(coverage.coverage==='complete'||videos.size>=cap)break;
   stagnant=videos.size===before?stagnant+1:0;if(stagnant>=4){coverage.reason='连续滚动未出现新作品；无法证实所选时间完整覆盖';break;}
   await this.scroll(page,options);
  }
  if(!videos.size&&coverage.coverage!=='complete')throw new Error('未能读取作者公开作品，可能需要登录或页面结构变化；不能将读取失败记为0作品');
  return {videos:[...videos.values()],...coverage,profile:(await this.snapshot(page,options)).profile};
 }
 private async media(page:Page,options?:OperationOptions) {
  const element=page.locator('video').filter({visible:true}).first();
  for(let i=0;i<30;i++) {
   abort(options);await this.snapshot(page,options);
   if(await element.count()) {
    const metadata=await this.stableRead(page,()=>element.evaluate(v=>({duration:(v as HTMLVideoElement).duration,width:(v as HTMLVideoElement).videoWidth,height:(v as HTMLVideoElement).videoHeight})),options);
    if(Number.isFinite(metadata.duration)&&metadata.duration>0&&metadata.width>0&&metadata.height>0)return {element,metadata};
   }
   await wait(500,options);
  }
  throw new Error('视频实际媒体时长或原始画幅不可用；请检查采集浏览器的加载、登录或播放限制后重试');
 }
 async inspectVideo(video:Video,options?:OperationOptions):Promise<Video> {
  const address=videoURL(video.url);if(!address||address.id!==video.id)throw new Error('作品链接不是对应的抖音公开视频');
  const page=await this.goto(address.url,options);let snapshot=await this.snapshot(page,options);
  // Wait for actual public media, rather than accepting an empty player shell.
  const media=/图文作品|图片作品/.test(snapshot.text)?null:await this.media(page,options);
  snapshot=await this.snapshot(page,options);
  const identity=stableAuthor(snapshot.authorHref);const metadata=media?.metadata||null;
  const dateText=snapshot.dateText||video.dateText;
  return {...video,authorId:identity?.id||video.authorId,authorUrl:identity?.url||video.authorUrl,authorName:snapshot.authorText||video.authorName,title:snapshot.title||video.title,dateText,publishedAt:parsePublishDate(dateText,new Date()),duration:metadata&&Number.isFinite(metadata.duration)&&metadata.duration>0?metadata.duration:video.duration,width:metadata?.width||video.width,height:metadata?.height||video.height,kind:metadata&&metadata.width>0?'video':/图文|图片作品/.test(snapshot.text)?'image':video.kind,likes:snapshot.metrics.likes?parseMetric(snapshot.metrics.likes):video.likes,favorites:snapshot.metrics.favorites?parseMetric(snapshot.metrics.favorites):video.favorites,shares:snapshot.metrics.shares?parseMetric(snapshot.metrics.shares):video.shares,collectedAt:new Date().toISOString()};
 }
 async sample(video:Video,outDir:string,targets?:number[],options?:OperationOptions):Promise<Frame[]> {
  if(video.frames.length>=10)return [];
  const address=videoURL(video.url);if(!address||address.id!==video.id)throw new Error('作品链接与采样ID不符');
  const page=await this.goto(address.url,options);const {element,metadata}=await this.media(page,options);
  const times=normalizeTargets(targets||samplingTimes(metadata.duration),metadata.duration,video.frames.length).filter(t=>!video.frames.some(f=>Math.abs(f.actualTime-t)<0.12));
  await mkdir(outDir,{recursive:true});const frames:Frame[]=[];const pixels:{id:string;data:Buffer}[]=[];
  for(const old of video.frames) {try {const file=path.resolve(outDir,path.basename(old.file));const data=await sharp(await readFile(file)).resize(32,32,{fit:'fill'}).greyscale().raw().toBuffer();pixels.push({id:old.id,data});}catch{/* Missing old evidence cannot establish a duplicate. */}}
  for(const target of times) {
   abort(options);await this.snapshot(page,options);let state:{time:number;readyState:number;decodedTime:number;seeking:boolean}|null=null;let last:unknown;
   for(let attempt=0;attempt<2;attempt++) {
    abort(options);
    try {
     state=await element.evaluate(inPage(async (node:Element,target:number)=>{
      const v=node as HTMLVideoElement;v.pause();v.muted=true;
      return await new Promise<{time:number;readyState:number;decodedTime:number;seeking:boolean}>((resolve,reject)=>{
       let callbackId=0;let finished=false;let started=false;
       const cleanup=()=>{clearTimeout(timer);v.removeEventListener('seeked',request);v.removeEventListener('error',failed);if(callbackId)v.cancelVideoFrameCallback(callbackId);};
       const failed=()=>{if(finished)return;finished=true;cleanup();reject(new Error('媒体解码失败'));};
       const timer=setTimeout(()=>{if(finished)return;finished=true;cleanup();v.pause();reject(new Error('等待目标解码帧超时（15秒）'));},15000);
       const request=()=>{
        if(started||v.seeking)return;started=true;
        if(typeof v.requestVideoFrameCallback!=='function'){failed();return;}
        callbackId=v.requestVideoFrameCallback((_now,meta)=>{if(finished)return;finished=true;v.pause();const result={time:v.currentTime,readyState:v.readyState,decodedTime:meta.mediaTime,seeking:v.seeking};cleanup();resolve(result);});
        // A paused seek may have already presented a frame before the seeked event.
        // Brief playback requests a new decoded frame; no full-video playback or downloads.
        void v.play().catch(()=>failed());
       };
       v.addEventListener('seeked',request,{once:true});v.addEventListener('error',failed,{once:true});
       if(Math.abs(v.currentTime-target)<0.01)request();else v.currentTime=target;
      });
     }),target);
     if(!isFreshFrame(target,state))throw new Error(`目标${target.toFixed(2)}秒尚未解码，实际${state.time.toFixed(2)}秒/帧${state.decodedTime.toFixed(2)}秒`);
     break;
    }catch(e){abort(options);last=e;state=null;if(attempt===0)await wait(300,options);}
   }
   if(!state)throw readableError(last||new Error('未获取目标新帧'));
   // Object-fit can letterbox the HTML element; crop to the actual source aspect ratio.
   const clip=await element.evaluate(node=>{const v=node as HTMLVideoElement;const r=v.getBoundingClientRect();const style=getComputedStyle(v);let width=r.width,height=r.height;if(style.objectFit==='contain'||style.objectFit==='scale-down'){const scale=Math.min(r.width/v.videoWidth,r.height/v.videoHeight);width=v.videoWidth*scale;height=v.videoHeight*scale;}return {x:r.x+(r.width-width)/2,y:r.y+(r.height-height)/2,width,height};});
   const viewport=page.viewportSize();if(clip.x<0||clip.y<0||(viewport&&(clip.x+clip.width>viewport.width||clip.y+clip.height>viewport.height)))throw new Error('播放器内容区域超出窗口，请在采集浏览器使视频完整可见后重试');
   abort(options);const raw=await page.screenshot({clip,type:'png',timeout:10000});const jpeg=await sharp(raw).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
   const thumbnail=await sharp(jpeg).resize(32,32,{fit:'fill'}).greyscale().raw().toBuffer();const duplicate=pixels.find(p=>sameFramePixels(p.data,thumbnail));
   if(duplicate){options?.onProgress?.(`${video.id} ${target.toFixed(2)}秒与${duplicate.id}画面重复，已去重`);continue;}
   const id=`${video.id}_${Math.round(state.time*1000)}_${Date.now()}`;const file=`${id}.jpg`;const dimensions=await sharp(jpeg).metadata();
   await writeFile(path.join(outDir,file),jpeg,{flag:'wx'});const frame:Frame={id,file,targetTime:target,actualTime:state.time,width:dimensions.width!,height:dimensions.height!};frames.push(frame);pixels.push({id,data:thumbnail});
   options?.onProgress?.(`作品${video.id}已保存${state.time.toFixed(2)}秒证据（${frames.length}张）`);
  }
  if(!frames.length&&times.length)throw new Error('所有采样画面与已有证据重复，未新增画面');
  return frames;
 }
 async close():Promise<void> {const context=this.context,launching=this.launching;this.generation++;this.context=undefined;this.page=undefined;if(context)await context.close();if(launching)await launching.catch(()=>{});}
}
