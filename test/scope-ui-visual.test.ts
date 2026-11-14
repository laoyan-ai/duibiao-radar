import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createTask,parseMetric} from '../src/domain.js';
import {APP_BUILD} from '../src/build.js';

test('editable collection limits create a frozen 100 by 30 task and expose all thirty evidence titles offline',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const old=createTask('原任务50与12（离线）','likes',undefined,4);old.rankingRequested=true;old.profileRanking=true;old.status='complete';old.phase='score';
  const tasks=[old];const requests:any[]=[];const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.hostname,'local.test');
   if(url.pathname==='/api/bootstrap')return route.fulfill({json:{token:'offline',build:APP_BUILD,settings:{configured:false},tasks:[...tasks].reverse()}});
   if(url.pathname==='/api/browser/status')return route.fulfill({json:{browser:'closed',login:'unknown'}});
   if(url.pathname==='/api/tasks'&&route.request().method()==='POST'){
    const body=route.request().postDataJSON();requests.push(body);const task=createTask(body.keyword,'likes',undefined,4,body.collectionScope);task.rankingRequested=true;task.profileRanking=true;task.status='waiting_api';task.phase='score';task.searchVideoIds=Array.from({length:100},(_,i)=>'s'+i);
    task.authors=[{id:'a',name:'示例博主（离线）',url:'https://www.douyin.com/user/a',identity:'account',coverage:'complete',reason:'离线样本',fetchedCount:30,profileCollected:true,profileSampleIds:Array.from({length:30},(_,i)=>'v'+i)}];
    task.videos=Array.from({length:30},(_,i)=>({id:'v'+i,url:'https://www.douyin.com/video/'+i,authorId:'a',authorName:'示例博主（离线）',authorUrl:task.authors[0].url,title:'第'+(i+1)+'条作品（离线）',description:'',dateText:'',publishedAt:null,duration:null,likes:parseMetric('100'),favorites:parseMetric(null),shares:parseMetric(null),kind:'video',related:true,collectedAt:task.createdAt,frames:[]}));
    task.candidateScores=[{authorId:'a',rank:1,relevanceScore:null,likesScore:100,compositeScore:null,meanLikes:100,totalLikes:3000,maxLikes:100,sampleCount:30,knownLikesCount:30,videoIds:task.authors[0].profileSampleIds!,reason:'待配置',warnings:[]}];tasks.push(task);return route.fulfill({json:task});
   }
   if(url.pathname.startsWith('/api/tasks/'))return route.fulfill({json:tasks.find(t=>t.id===url.pathname.split('/')[3])});
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','style.css'].includes(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:await readFile(new URL('../public/'+file,import.meta.url)),contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css'});
  });
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1050});await page.goto('http://local.test/');await page.waitForFunction(()=>!(document.getElementById('start-task') as HTMLButtonElement)?.disabled);
   assert.equal(await page.locator('#search-limit').inputValue(),'50');assert.equal(await page.locator('#profile-limit').inputValue(),'12');
   await page.locator('#search-limit').fill('100');await page.locator('#profile-limit').fill('30');assert.match(await page.locator('#scope-estimate').innerText(),/100/);assert.match(await page.locator('#scope-estimate').innerText(),/30/);
   await page.locator('#keyword').fill('参数100与30（离线）');await page.locator('#start-task').click();await page.waitForFunction(()=>document.getElementById('task-title')?.textContent==='参数100与30（离线）');
   assert.deepEqual(requests.at(-1).collectionScope,{searchLimit:100,profileLimit:30});assert.match(await page.locator('#run-step-search').innerText(),/100/);assert.match(await page.locator('#run-step-collect').innerText(),/30/);
   await page.locator('#authors details summary').first().click();assert.equal(await page.locator('#authors details li').count(),30);assert.match(await page.locator('#authors details li').last().innerText(),/第30条作品/);
   await page.locator('#search-limit').fill('200');await page.locator('#profile-limit').fill('1');assert.match(await page.locator('#run-step-search').innerText(),/100/);assert.match(await page.locator('#run-step-collect').innerText(),/30/);
   await page.locator('#search-limit').fill('100');await page.locator('#profile-limit').fill('30');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await mkdir(new URL('../可行性验证/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL(`../可行性验证/自定义采集参数-${width}.png`,import.meta.url)),fullPage:true});
   const before=requests.length;await page.locator('#search-limit').fill('201');await page.locator('#start-task').click();assert.equal(requests.length,before,'native limit rejects over 200 without sending');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
