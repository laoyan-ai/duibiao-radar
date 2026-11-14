import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {APP_BUILD} from '../src/build.js';
import {PROVIDERS} from '../src/providers.js';

test('multi-provider settings complete DeepSeek flow without external traffic at desktop and mobile sizes',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [1440,390]){
   let settings:any={configured:true,persisted:true,provider:'openai',baseURL:'https://api.openai.com/v1',model:'gpt-6.1-sol',profiles:[{provider:'openai',baseURL:'https://api.openai.com/v1',model:'gpt-6.1-sol',persisted:true}],providers:PROVIDERS};
   const calls:{path:string;data:any}[]=[];const page=await browser.newPage({viewport:{width,height:1050}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.hostname,'local.test','all browser traffic stays local');
    const data=route.request().postDataJSON();if(route.request().method()==='POST')calls.push({path:url.pathname,data});
    if(url.pathname==='/api/bootstrap')return route.fulfill({json:{token:'offline',build:APP_BUILD,settings,tasks:[]}});
    if(url.pathname==='/api/browser/status')return route.fulfill({json:{browser:'closed',login:'unknown',message:'离线界面验证',checkedAt:new Date().toISOString()}});
    if(url.pathname==='/api/settings/models')return route.fulfill({json:{models:[{id:'deepseek-flash',label:'DeepSeek Flash（离线列表）'},{id:'deepseek-v4-pro',label:'DeepSeek V4 Pro（离线列表）'}],source:'remote',message:'离线模拟：接口返回模型，调用权限需测试'}});
    if(url.pathname==='/api/settings'){
     assert.equal(data.provider,'deepseek');assert.equal(data.apiKey,'fake-ui-deepseek-key');
     settings={...settings,...data,persisted:true,profiles:[...settings.profiles,{provider:data.provider,baseURL:data.baseURL,model:data.model,persisted:true}]};delete settings.apiKey;
     return route.fulfill({json:settings});
    }
    if(url.pathname==='/api/settings/test')return route.fulfill({json:{ok:true,message:'文字与JSON连接测试通过（离线模拟），未测试图片'}});
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','app.js','style.css'].includes(file))return route.fulfill({status:404,body:''});
    return route.fulfill({body:await readFile(new URL('../public/'+file,import.meta.url)),contentType:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':'text/css'});
   });
   await page.goto('http://local.test/');await page.getByRole('button',{name:'API 设置',exact:true}).click();await page.locator('#provider').selectOption('deepseek');
   assert.equal(await page.locator('#api-key').inputValue(),'');assert.equal(await page.locator('#test-api').isDisabled(),true);assert.equal(await page.locator('#model').inputValue(),'deepseek-flash');
   await page.locator('#api-key').fill('fake-ui-deepseek-key');await page.locator('#fetch-models').click();await page.waitForFunction(()=>document.querySelector('#model')?.textContent?.includes('离线列表'));
   assert.equal(calls.filter(c=>c.path==='/api/settings').length,0,'model list does not save or start generation');
   await page.locator('#settings-save').click();await page.waitForFunction(()=>!(document.getElementById('test-api') as HTMLButtonElement)?.disabled);
   assert.equal(await page.locator('#api-key').inputValue(),'');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await mkdir(new URL('../可行性验证/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL(`../可行性验证/多厂商设置-DeepSeek-${width}.png`,import.meta.url)),fullPage:true});
   await page.locator('#test-api').click();await page.waitForFunction(()=>document.getElementById('settings-panel')?.hidden===true);
   assert.equal(calls.filter(c=>c.path==='/api/settings/test').length,1);assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
