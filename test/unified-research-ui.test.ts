import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createTask} from '../src/domain.js';
import {APP_BUILD} from '../src/build.js';

test('one research card shows all candidates immediately then scores and sortable evidence in place',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const task=createTask('FDE（离线界面验证）','likes',undefined,4);task.profileRanking=true;task.rankingRequested=true;task.status='collecting';task.phase='authors';
  task.authors=Array.from({length:6},(_,i)=>({id:'a'+i,name:'示例博主'+(i+1),identity:'account' as const,url:'https://www.douyin.com/user/a'+i,coverage:'partial' as const,reason:'离线样本',fetchedCount:0}));
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.hostname,'local.test');
   if(url.pathname==='/api/bootstrap')return route.fulfill({json:{token:'offline',build:APP_BUILD,settings:{configured:false},tasks:[task]}});
   if(url.pathname==='/api/browser/status')return route.fulfill({json:{browser:'closed',login:'unknown',message:'离线验证'}});
   if(url.pathname==='/api/tasks/'+task.id)return route.fulfill({json:task});
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','style.css'].includes(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:await readFile(new URL('../public/'+file,import.meta.url)),contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css'});
  });
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1050});await page.goto('http://local.test/');await page.locator('#authors tbody tr').first().waitFor();
   assert.equal(await page.locator('#view-candidates,#candidate-directory,#candidate-list').count(),0,'no duplicate directory or toggle');
   assert.equal(await page.locator('#task-progress #author-section #authors tbody tr').count(),6,'one card, including every unscored author');
   assert.match(await page.locator('#authors tbody tr').first().innerText(),/待采集主页/);
   assert.equal(await page.locator('#author-section.panel').count(),0,'no second panel boundary');
   assert.equal(await page.locator('.rank-control').isVisible(),false,'no empty legacy controls separating progress from results');
   assert.equal(await page.locator('#task-progress #export-panel').count(),1,'exports belong to current research');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  task.status='partial';task.phase='score';task.candidateScores=task.authors.map((a,i)=>({authorId:a.id,rank:i+1,relevanceScore:i===5?null:90-i,likesScore:30+i*10,compositeScore:i===5?null:80-i,meanLikes:100+i,totalLikes:1200+i,maxLikes:500,sampleCount:12,knownLikesCount:12,videoIds:[],reason:'离线评分示例',warnings:[]}));
  await mkdir(new URL('../可行性验证/',import.meta.url),{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1050});await page.goto('http://local.test/');await page.locator('#authors tbody tr').first().waitFor();
   assert.equal(await page.locator('#task-progress table').count(),1);
   await page.locator('button[data-sort-key="likesScore"]').click();assert.equal(await page.locator('#authors tbody tr').first().getAttribute('data-author-id'),'a0');
   await page.locator('button[data-sort-key="likesScore"]').click();assert.equal(await page.locator('#authors tbody tr').first().getAttribute('data-author-id'),'a5');
   await page.locator('#authors tbody tr').first().locator('details summary').click();assert.equal(await page.locator('#authors tbody tr').first().locator('details').getAttribute('open'),'');
   await page.screenshot({path:fileURLToPath(new URL(`../可行性验证/当前调研统一表-${width}.png`,import.meta.url)),fullPage:true});
  }
  // Creating a new task must not expose the previous task's integrated result table.
  await page.locator('#keyword').fill('新话题');await page.route('**/api/tasks',()=>new Promise(()=>{}));
  await page.locator('#start-task').click();await page.waitForFunction(()=>document.getElementById('task-progress')?.classList.contains('is-launching'));
  assert.equal(await page.locator('#authors').isVisible(),false);assert.equal(await page.locator('#stop-current').isVisible(),true);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
