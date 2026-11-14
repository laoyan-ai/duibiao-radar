import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProviderConfig,cacheModelIdentity,profileId,listProviderModels,PROVIDERS} from '../src/providers.js';
test('normalization isolates endpoint profiles and retains legacy OpenAI cache names',()=>{
 assert.equal(cacheModelIdentity(normalizeProviderConfig({model:'gpt-x'})),'gpt-x');
 const a=normalizeProviderConfig({provider:'deepseek'});assert.equal(a.baseURL,'https://api.deepseek.com/v1');assert.equal(a.model,'deepseek-flash');
 assert.notEqual(cacheModelIdentity({...a,model:'same'}),cacheModelIdentity(normalizeProviderConfig({model:'same'})));
 assert.notEqual(profileId(normalizeProviderConfig({provider:'custom',baseURL:'https://example.com/a',model:'m'})),profileId(normalizeProviderConfig({provider:'custom',baseURL:'https://example.com/b',model:'m'})));
 assert.ok(PROVIDERS.some(p=>p.id==='doubao'));
});
test('rejects nonofficial builtins and unsafe endpoints',()=>{
 for(const baseURL of ['http://example.com/v1','https://user:pass@example.com','https://example.com/?key=x','https://localhost/v1','https://127.1/v1','https://[::1]/v1','https://192.168.1.1/v1','https://169.254.169.254/v1'])assert.throws(()=>normalizeProviderConfig({provider:'custom',baseURL,model:'m'}));
 assert.throws(()=>normalizeProviderConfig({provider:'deepseek',baseURL:'https://example.com',model:'m'}));
 assert.equal(normalizeProviderConfig({provider:'qwen',baseURL:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'}).provider,'qwen');
});
test('model list is explicit remote data or clearly unverified presets and never leaks keys',async()=>{
 const config=normalizeProviderConfig({provider:'deepseek'});let called=0;
 const result=await listProviderModels(config,'fake-secret',undefined,async(input,init)=>{called++;assert.equal(String(input),'https://api.deepseek.com/v1/models');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fake-secret');return new Response(JSON.stringify({data:[{id:'available-model'}]}));});
 assert.equal(called,1);assert.equal(result.source,'remote');assert.equal(result.models[0]?.id,'available-model');
 const fallback=await listProviderModels(config,'fake-secret',undefined,async()=>{throw new Error('fake-secret');});assert.equal(fallback.source,'preset');assert.match(fallback.message,/未验证/);assert.ok(!fallback.message.includes('fake-secret'));
});

