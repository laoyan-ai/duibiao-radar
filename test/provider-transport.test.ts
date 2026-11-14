import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedFetch,sdkTransport} from '../src/provider-transport.js';
test('guarded fetch refuses changed origin, sibling paths and private DNS before transmission',async()=>{
 const f=guardedFetch('https://example.com/v1');
 for(const url of ['https://evil.example/v1/models','https://example.com/v11/models','https://example.com/v1/../secret'])await assert.rejects(f(url),/地址|路径/);
 const local=guardedFetch('https://example.com/v1',{lookup:async()=>[{address:'127.0.0.1',family:4}]});await assert.rejects(local('https://example.com/v1/models'),/私网|地址/);
});
test('DeepSeek SDK sends text JSON mode with schema, disabled thinking and direct endpoint',async()=>{
 let called=0;const response=await sdkTransport({model:'deepseek-flash',instructions:'return JSON',input:[{role:'user',content:[{type:'input_text',text:'hello'}]}],max_output_tokens:128,text:{format:{type:'json_schema',name:'test',strict:true,schema:{type:'object',properties:{ok:{type:'boolean'}}}}}},{apiKey:'fake-only',baseURL:'https://api.deepseek.com/v1',provider:'deepseek',fetch:async(input,init)=>{called++;assert.equal(String(input),'https://api.deepseek.com/v1/chat/completions');const body=JSON.parse(String(init?.body));assert.equal(body.response_format.type,'json_object');assert.equal(body.thinking.type,'disabled');assert.ok(JSON.stringify(body.messages).includes('properties'));return new Response(JSON.stringify({id:'offline',object:'chat.completion',created:1,model:'deepseek-flash',choices:[{index:0,message:{role:'assistant',content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7}}),{headers:{'content-type':'application/json'}});}});
 assert.equal(called,1);assert.equal(response.output_text,'{"ok":true}');
});

test('DNS lookup and model response stalls have bounded cancellation',async()=>{
 const start=Date.now();const stalled=guardedFetch('https://example.com/v1',{timeoutMs:20,lookup:async()=>new Promise(()=>{})});await assert.rejects(stalled('https://example.com/v1/models'));assert.ok(Date.now()-start<1000);
});
test('HTTPS pinned lookup accepts both Node lookup callback shapes and blocks redirects and large bodies',async()=>{
 const {EventEmitter}=await import('node:events');const ip='93.184.216.34';
 const makeRequest=(status:number,payload:string)=>((_url:unknown,opts:any,callback:any)=>{
  for(const all of [true,false])opts.lookup('example.com',{all},(error:any,value:any,family:any)=>{assert.equal(error,null);if(all)assert.deepEqual(value,[{address:ip,family:4}]);else{assert.equal(value,ip);assert.equal(family,4);}});
  const req=new EventEmitter() as any;req.write=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter() as any;res.statusCode=status;res.headers={'content-type':'application/json'};res.destroy=(error?:Error)=>{if(error)queueMicrotask(()=>res.emit('error',error));};callback(res);if(status<300||status>=400){res.emit('data',Buffer.from(payload));res.emit('end');}});return req;
 }) as any;
 const f=(status:number,payload:string,maxBytes=100)=>guardedFetch('https://example.com/v1',{lookup:async()=>[{address:ip,family:4}],request:makeRequest(status,payload),maxBytes});
 assert.equal(await (await f(200,'{"ok":true}')('https://example.com/v1/models')).text(),'{"ok":true}');
 assert.equal((await f(204,'')('https://example.com/v1/models')).status,204);
 await assert.rejects(f(600,'')('https://example.com/v1/models'),/响应/);
 await assert.rejects(f(302,'')('https://example.com/v1/models'),/重定向/);
 await assert.rejects(f(200,'x'.repeat(50),10)('https://example.com/v1/models'),/响应/);
});
test('OpenAI SDK uses direct Responses with schema and actual JPEG data',async()=>{
 let called=false;const result=await sdkTransport({model:'gpt-6.1-sol',store:false,reasoning:{effort:'low'},input:[{role:'user',content:[{type:'input_text',text:'test'},{type:'input_image',image_url:'data:image/jpeg;base64,/9j/2Q==',detail:'auto'}]}],text:{format:{type:'json_schema',name:'check',strict:true,schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}}},{apiKey:'fake-only',baseURL:'https://api.openai.com/v1',provider:'openai',fetch:async(input,init)=>{called=true;assert.equal(String(input),'https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.reasoning.effort,'low');assert.equal(body.text.format.type,'json_schema');assert.ok(JSON.stringify(body).includes('data:image/jpeg;base64,/9j/2Q=='));return new Response(JSON.stringify({id:'offline',object:'response',created_at:1,status:'completed',model:'gpt-6.1-sol',output:[{type:'message',role:'assistant',id:'msg_offline',content:[{type:'output_text',text:'{"ok":true}',annotations:[]}]}],usage:{input_tokens:1,output_tokens:2,total_tokens:3}}),{headers:{'content-type':'application/json'}});}});
 assert.equal(called,true);assert.equal(result.output_text,'{"ok":true}');assert.equal(result.status,'completed');
});
