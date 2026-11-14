import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {BrowserCollector,readVisibleSnapshot} from '../src/browser.js';
const icon='<svg width="60" height="40"><path d="M0 0 L30 30"/><text x="0" y="20" class="active">视频</text></svg>';
test('filter confirmation skips SVG icons, accepts selected HTML and refuses SVG-only selection evidence',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const page=await b.newPage(),c=new BrowserCollector({profileDir:'unused',timings:{stability:0}});
 await page.setContent(icon+'<button aria-pressed="true">视频</button>');await (c as any).confirmSearchFilter(page,['视频']);
 await page.setContent(icon+'<button aria-pressed="false">视频</button>');await assert.rejects((c as any).confirmSearchFilter(page,['视频']),/自动筛选未完成.*无法确认搜索筛选/);
 }finally{await b.close();}
});
test('snapshot ignores SVG metric and profile markers without inventing text or likes',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const page=await b.newPage();await page.setContent('<main>正常页面</main><svg aria-label="点赞" data-e2e="user-title" width="50" height="40"><text y="20">9999</text></svg>');const s=await page.evaluate(readVisibleSnapshot);assert.equal(s.metrics.likes,null);assert.equal(s.profile?.name,'');assert.match(s.text,/正常页面/);
 }finally{await b.close();}
});
