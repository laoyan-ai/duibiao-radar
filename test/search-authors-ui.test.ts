import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {createTask} from '../src/domain.js';
import {fileURLToPath} from 'node:url';
import {APP_BUILD} from '../src/build.js';

test('real browser renders simple search and author sources at desktop and mobile widths without network or API',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const task=createTask('FDE','likes',undefined,4);task.status='complete';task.phase='authors';task.searchDone=true;task.message='已读取50条视频，去重后7位博主（离线测试数据）';
  task.authors=Array.from({length:7},(_,i)=>({id:'a'+i,name:'测试博主'+i,url:'https://www.douyin.com/user/a'+i,coverage:'partial' as const,reason:'搜索卡片',fetchedCount:0}));
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='local.test')throw Error('意外外部请求');
   if(url.pathname==='/api/bootstrap')return route.fulfill({json:{token:'offline',build:APP_BUILD,settings:{configured:false},tasks:[task]}});
   if(url.pathname==='/api/tasks/'+task.id)return route.fulfill({json:task});
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','style.css'].includes(file))return route.fulfill({status:404,body:''});
   await route.fulfill({body:await readFile(new URL('../public/'+file,import.meta.url)),contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css'});
  });
  await mkdir(new URL('../可行性验证/',import.meta.url),{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto('http://local.test/');await page.getByRole('heading',{name:'去重后的博主',exact:true}).waitFor();
   assert.equal(await page.locator('#authors .author-card').count(),7);assert.equal(await page.locator('#score-task').isVisible(),false);
   assert.equal(await page.locator('#mode').isVisible(),false);assert.match(await page.locator('#run-stage').innerText(),/2\/2.*博主去重/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const keyword=await page.locator('.keyword-field').boundingBox();assert.ok(keyword&&keyword.height<150,'关键词输入区不应被拉成大块空白');
   await page.screenshot({path:fileURLToPath(new URL('../可行性验证/搜索前50去重-离线-'+width+'.png',import.meta.url)),fullPage:true});
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
