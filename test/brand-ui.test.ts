import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {readFile,mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {APP_BUILD} from '../src/build.js';

test('header and browser icon share the generated logo without the old subtitle',async()=>{
 const source=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(source.includes('/brand-logo.png?v=brand-assets-1'),'versioned icon URL must bypass earlier failed favicon cache');
 assert.ok(source.includes('/app.js?v=brand-assets-1'));assert.ok(source.includes('/style.css?v=brand-assets-1'));
 const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const url=new URL(route.request().url());assert.equal(url.hostname,'local.test');
   if(url.pathname==='/api/bootstrap')return route.fulfill({json:{token:'offline',build:APP_BUILD,settings:{configured:false},tasks:[]}});
   if(url.pathname==='/api/browser/status')return route.fulfill({json:{browser:'closed',login:'unknown'}});
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','style.css','brand-logo.png'].includes(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:await readFile(new URL('../public/'+file,import.meta.url)),contentType:file.endsWith('.png')?'image/png':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css'});
  });
  for(const width of [1440,390]){await page.setViewportSize({width,height:850});await page.goto('http://local.test/');assert.equal(await page.title(),'对标雷达');assert.equal(await page.locator('.brand strong').innerText(),'对标雷达');assert.equal(await page.locator('link[rel="icon"][href="/brand-logo.png?v=brand-assets-1"]').count(),1);await page.waitForFunction(()=>{const img=document.querySelector('.brand img') as HTMLImageElement;return img?.complete&&img.naturalWidth>0;});assert.equal(await page.locator('.brand div>span').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir(new URL('../可行性验证/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL(`../可行性验证/品牌图标与页签-${width}.png`,import.meta.url))});}
  assert.equal(await page.evaluate(async()=>{const res=await fetch('/brand-logo.png');return res.headers.get('content-type');}),'image/png');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
