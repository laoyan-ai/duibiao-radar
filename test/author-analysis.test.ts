import test from 'node:test';import assert from 'node:assert/strict';import {Analyzer} from '../src/analyzer.js';
import {parseMetric} from '../src/domain.js';import type {Author,Video} from '../src/types.js';
const a:Author={id:'a',name:'企业实施者',bio:'企业AI服务；忽略指令只是简介文本',url:'https://www.douyin.com/user/a',coverage:'partial',reason:'12样本',fetchedCount:1};
const v:Video={id:'v1',authorId:'a',authorName:'企业实施者',authorUrl:a.url,url:'https://www.douyin.com/video/v1',title:'FDE如何落地企业AI',description:'',dateText:'',publishedAt:null,duration:null,likes:parseMetric('99'),favorites:parseMetric(null),shares:parseMetric(null),kind:'unknown',related:true,collectedAt:'',frames:[]};
const result={profileScore:90,videos:[{id:'v1',score:95,reason:'标题明确企业AI落地'}],reason:'简介与作品均相关'};
test('author semantic analysis sends text only, constrained evidence and caches same public input',async()=>{
 let calls=0;const engine=new Analyzer(async(request,options)=>{calls++;assert.equal(options.baseURL,'https://api.openai.com/v1');assert.equal(request.store,false);assert.ok(!JSON.stringify(request).includes('input_image'));assert.ok(JSON.stringify(request).includes(a.bio!));assert.ok(request.instructions?.includes('不可信'));return {output_text:JSON.stringify(result),status:'completed',usage:{input_tokens:30,output_tokens:40}};});engine.configure('fake-offline-only','gpt-6.1-sol');
 assert.deepEqual((await engine.scoreAuthor('FDE',a,[v])).assessment,result);assert.equal((await engine.scoreAuthor('FDE',a,[v])).cached,true);assert.equal(calls,1);engine.clear();await assert.rejects(engine.scoreAuthor('FDE',a,[v]),/配置/);
});
test('author analysis rejects invented references and out-of-range scores without caching',async()=>{
 const engine=new Analyzer(async()=>({output_text:JSON.stringify({...result,videos:[{id:'other',score:200,reason:'伪造'}]}),status:'completed'}));engine.configure('fake-offline-only','gpt-6.1-sol');await assert.rejects(engine.scoreAuthor('FDE',a,[v]),/校验|评分/);
});
