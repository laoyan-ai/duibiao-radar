import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {WindowsCredentialStore} from '../src/credentials.js';

test('Windows credential store persists DPAPI ciphertext, restores on new instance, and clears only its file',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-dpapi-'));try{const file=join(dir,'settings.dpapi'),vault=new WindowsCredentialStore(file),value={apiKey:'fake-offline-key-not-a-real-credential',model:'gpt-6.1-sol'};
 assert.equal(await vault.load(),undefined);await vault.save(value);const stored=await readFile(file,'utf8');assert.ok(!stored.includes(value.apiKey));assert.ok(!stored.includes(value.model));assert.deepEqual(await new WindowsCredentialStore(file).load(),value);
 await vault.save({...value,model:'gpt-5.4'});assert.equal((await vault.load())!.model,'gpt-5.4');await vault.clear();assert.equal(await vault.load(),undefined);
 await writeFile(file,'invalid ciphertext fake-sensitive');await assert.rejects(vault.load(),e=>e instanceof Error&&!e.message.includes('fake-sensitive'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('DPAPI multi-profile roundtrip retains isolated keys and selected empty state',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-dpapi-profiles-'));try{
 const vault=new WindowsCredentialStore(join(dir,'settings.dpapi'));const value={apiKey:'',model:'gpt-6.1-sol',provider:'openai' as const,baseURL:'https://api.openai.com/v1',profiles:[{apiKey:'fake-deepseek-only',model:'deepseek-chat',provider:'deepseek' as const,baseURL:'https://api.deepseek.com/v1'}]};
 await vault.save(value);assert.deepEqual(await vault.load(),value);assert.ok(!(await readFile(join(dir,'settings.dpapi'),'utf8')).includes('fake-deepseek-only'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
