import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createTask} from '../src/domain.js';
import {APP_BUILD} from '../src/build.js';

test('login status and unified task controls render at desktop and mobile sizes offline',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const task=createTask('FDE（离线界面验证）','likes',undefined,4);task.profileRanking=true;task.rankingRequested=true;task.status='analyzing';task.phase='score';task.message='语义评分 21/44：示例博主（离线数据）';task.progress={completed:21,total:44,unit:'位候选'};
  task.events=Array.from({length:25},(_,i)=>({at:new Date().toISOString(),message:`语义评分 ${i+1}/44：示例博主，简介和标题评分（离线数据）`}));
  let login='logged_out';
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.hostname,'local.test');
   if(url.pathname==='/api/bootstrap')return route.fulfill({json:{token:'offline',build:APP_BUILD,settings:{configured:true,model:'gpt-6.1-sol'},tasks:[task]}});
   if(url.pathname==='/api/browser/status')return route.fulfill({json:{browser:'open',login,message:'离线状态示例',checkedAt:new Date().toISOString()}});
   if(url.pathname==='/api/tasks/'+task.id)return route.fulfill({json:task});
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','style.css'].includes(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:await readFile(new URL('../public/'+file,import.meta.url)),contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css'});
  });
  await mkdir(new URL('../可行性验证/',import.meta.url),{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1100});await page.goto('http://local.test/');await page.locator('#run-events li').first().waitFor();
   await page.waitForFunction(()=>document.body.textContent?.includes('未登录'));
   assert.equal(await page.locator('#open-browser').isVisible(),true);
   assert.equal(await page.locator('#pause-task').isVisible(),true);assert.equal(await page.locator('#stop-current').isVisible(),true);
   assert.equal(await page.locator('#resume-task').isVisible(),false);assert.equal(await page.locator('#cancel-task').isVisible(),false);
   const log=await page.locator('#run-events').boundingBox();assert.ok(log&&log.height>=(width===390?150:190));
   assert.ok(await page.locator('#run-events').evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<30),'latest log visible initially');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   await page.screenshot({path:fileURLToPath(new URL(`../可行性验证/登录状态与任务操作-${width}.png`,import.meta.url)),fullPage:true});
  }
  login='logged_in';task.status='complete';task.message='本次任务完成（离线数据）';
  await page.goto('http://local.test/');await page.waitForFunction(()=>document.body.textContent?.includes('已登录'));
  for(const id of ['stop-current','pause-task','resume-task','cancel-task','score-task'])assert.equal(await page.locator('#'+id).isVisible(),false,id);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
