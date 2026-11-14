import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {BrowserCollector} from '../src/browser.js';

test('status never launches a collector and distinguishes opening from closed',async()=>{
 const collector=new BrowserCollector({profileDir:'unused-status-test'});
 (collector as any).ensure=()=>{throw Error('must not launch');};
 assert.equal((await collector.getBrowserStatus()).browser,'closed');
 (collector as any).launching=new Promise(()=>{});
 assert.equal((await collector.getBrowserStatus()).browser,'opening');
});

test('status reads only visible self-login evidence; author avatars and blank pages remain unknown',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();let requests=0;
  await page.route('**/*',route=>{requests++;return route.fulfill({body:'<html><body></body></html>',contentType:'text/html'});});
  await page.goto('https://www.douyin.com/');
  const collector=new BrowserCollector({profileDir:'unused-status-test'});
  (collector as any).page=page;(collector as any).context=page.context();
  const cases:[string,string][]=[
   ['<header><button>登录</button></header>','logged_out'],
   ['<header><a href="/user/self"><img alt="我的头像" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:32px;height:32px"></a></header>','logged_in'],
   ['<main><a href="/user/some-author"><img style="width:32px;height:32px"></a><svg><path></path></svg></main>','unknown'],
   ['<div role="dialog">请完成安全验证</div><header><a href="/user/self"><img style="width:32px;height:32px"></a></header>','verification'],
   ['<header><button style="display:none">登录</button></header>','unknown'],
   ['<div style="opacity:0"><header><a href="/user/self"><img style="width:32px;height:32px"></a></header></div>','unknown'],
   ['<div style="opacity:0"><header><button>登录</button></header></div>','unknown'],
   ['<div style="opacity:0"><div role="dialog">请完成安全验证</div></div>','unknown'],
   ['<header style="position:absolute;left:-10000px"><a href="/user/self"><img style="width:32px;height:32px"></a></header>','unknown'],
   ['<header><a href="https://example.com/user/self"><img style="width:32px;height:32px"></a></header>','unknown'],
  ];
  for(const [html,expected] of cases){await page.setContent(html);assert.equal((await collector.getBrowserStatus()).login,expected,html);}
  assert.equal(requests,1,'status must not navigate or request account data');
  await page.goto('https://example.com/');await page.setContent('<header><a href="/user/self"><img style="width:32px;height:32px"></a></header>');
  assert.equal((await collector.getBrowserStatus()).login,'unknown','other sites cannot confirm Douyin login');
  await page.close();assert.equal((await collector.getBrowserStatus()).browser,'closed');
 }finally{await browser.close();}
});

test('page origin changes while reading cannot confirm login',async()=>{
 const collector=new BrowserCollector({profileDir:'unused-status-test'});
 (collector as any).context={};let url='https://www.douyin.com/';
 (collector as any).page={isClosed:()=>false,url:()=>url,evaluate:async()=>{url='https://example.com/';return 'logged_in';}};
 assert.equal((await collector.getBrowserStatus()).login,'unknown');
});

test('navigation failures and stalled DOM reads return bounded unknown status',async()=>{
 const collector=new BrowserCollector({profileDir:'unused-status-test'});
 (collector as any).context={};
 (collector as any).page={isClosed:()=>false,url:()=> 'https://www.douyin.com/',evaluate:async()=>{throw Error('Execution context was destroyed');}};
 assert.equal((await collector.getBrowserStatus()).login,'unknown');
 (collector as any).page.evaluate=()=>new Promise(()=>{});
 const start=Date.now();assert.equal((await collector.getBrowserStatus()).login,'unknown');assert.ok(Date.now()-start<3000);
});
