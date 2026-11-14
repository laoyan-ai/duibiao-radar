import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createTask} from '../src/domain.js';
import {APP_BUILD} from '../src/build.js';

test('full execution history can scroll from first to last and preserve history position during live polling',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const task=createTask('完整执行记录（离线验证）','likes',undefined,4);task.rankingRequested=true;task.status='collecting';task.phase='authors';task.events=Array.from({length:650},(_,i)=>({at:new Date().toISOString(),message:`第${i+1}条执行记录（离线样本）`}));
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.hostname,'local.test');
   if(url.pathname==='/api/bootstrap')return route.fulfill({json:{token:'offline',build:APP_BUILD,settings:{configured:false},tasks:[task]}});
   if(url.pathname==='/api/browser/status')return route.fulfill({json:{browser:'closed',login:'unknown'}});
   if(url.pathname==='/api/tasks/'+task.id)return route.fulfill({json:task});
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','style.css'].includes(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:await readFile(new URL('../public/'+file,import.meta.url)),contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css'});
  });
  await mkdir(new URL('../可行性验证/',import.meta.url),{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1050});await page.goto('http://local.test/');await page.waitForFunction(()=>document.querySelectorAll('#run-events li').length>=650);
   const count=task.events.length;assert.equal(await page.locator('#run-events li').count(),count);assert.match(await page.locator('#run-events li').first().innerText(),/第1条执行记录/);assert.match(await page.locator('#run-events li').last().innerText(),new RegExp('第'+count+'条执行记录'));
   await page.locator('#run-events').evaluate(e=>e.scrollTop=0);task.events.push({at:new Date().toISOString(),message:`第${count+1}条执行记录（离线样本）`});await page.waitForFunction(n=>document.querySelectorAll('#run-events li').length===n,count+1);assert.equal(await page.locator('#run-events').evaluate(e=>e.scrollTop),0);
   await page.screenshot({path:fileURLToPath(new URL(`../可行性验证/完整执行记录-${width}.png`,import.meta.url)),fullPage:true});
   await page.locator('#run-events').evaluate(e=>e.scrollTop=e.scrollHeight);task.events.push({at:new Date().toISOString(),message:`第${count+2}条执行记录（离线样本）`});await page.waitForFunction(n=>document.querySelectorAll('#run-events li').length===n,count+2);assert.ok(await page.locator('#run-events').evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<24));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  task.events=Array.from({length:5000},(_,i)=>({at:task.createdAt,message:'规模验证执行记录-'+i}));
  const started=Date.now();await page.goto('http://local.test/');await page.waitForFunction(()=>document.querySelectorAll('#run-events li').length===5000);
  assert.equal(await page.locator('#task-log p').count(),5000);assert.match(await page.locator('#run-events li').first().innerText(),/规模验证执行记录-0/);assert.match(await page.locator('#run-events li').last().innerText(),/规模验证执行记录-4999/);t.diagnostic(`Offline 5000-record reload rendered both full lists in ${Date.now()-started}ms (local fixture only)`);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
