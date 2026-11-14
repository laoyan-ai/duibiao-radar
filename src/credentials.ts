import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {normalizeProviderConfig,profileId,type ProviderConfig} from './providers.js';
export type SavedProfile=ProviderConfig&{apiKey:string};
export type SavedCredentials={apiKey:string;model:string;provider?:ProviderConfig['provider'];baseURL?:string;profiles?:SavedProfile[]};
export interface CredentialStore {load():Promise<SavedCredentials|undefined>;save(value:SavedCredentials):Promise<void>;clear():Promise<void>;}
const scripts={
 protect:`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$inputBytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());$entropyBytes=[Text.Encoding]::UTF8.GetBytes('douyin-research/openai/v1');$outputBytes=[Security.Cryptography.ProtectedData]::Protect($inputBytes,$entropyBytes,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($outputBytes))`,
 unprotect:`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$entropyBytes=[Text.Encoding]::UTF8.GetBytes('douyin-research/openai/v1');$outputBytes=[Security.Cryptography.ProtectedData]::Unprotect($inputBytes,$entropyBytes,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($outputBytes))`
};
function crypt(operation:keyof typeof scripts,input:string):Promise<string>{
 if(process.platform!=='win32')return Promise.reject(new Error('加密设置仅支持Windows，请在本机Windows运行'));
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(scripts[operation],'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  const chunks:Buffer[]=[];let size=0,ended=false;
  const finish=(error?:boolean)=>{if(ended)return;ended=true;clearTimeout(timer);if(error)reject(new Error('Windows加密设置操作失败，请在当前Windows用户下重新保存'));else resolve(Buffer.concat(chunks).toString('utf8').trim());};
  const timer=setTimeout(()=>{child.kill();finish(true);},15000);
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>262144){child.kill();finish(true);}else chunks.push(chunk);});
  child.on('error',()=>finish(true));child.on('close',code=>finish(code!==0));child.stdin.on('error',()=>finish(true));child.stdin.end(input);
 });
}
function valid(value:unknown):SavedCredentials {
 const v=value as SavedCredentials;
 const validText=(s:unknown,max:number,empty=false):s is string=>typeof s==='string'&&(empty||!!s.trim())&&s.length<=max&&!/[\r\n\0]/.test(s);
 if(!v||!validText(v.apiKey,512,!!v.provider&&Array.isArray(v.profiles))||!validText(v.model,120))throw new Error('已保存配置无效，请重新填写');
 if(v.provider===undefined&&v.baseURL===undefined&&v.profiles===undefined)return {apiKey:v.apiKey,model:v.model};
 const config=normalizeProviderConfig(v);
 if(v.profiles!==undefined&&(!Array.isArray(v.profiles)||v.profiles.length>30))throw new Error('已保存配置无效，请重新填写');
 const profiles=(v.profiles??[]).map(p=>{if(!validText(p.apiKey,512)||!validText(p.model,120))throw new Error('已保存配置无效，请重新填写');return {...normalizeProviderConfig(p),apiKey:p.apiKey};});
 if(new Set(profiles.map(profileId)).size!==profiles.length)throw new Error('已保存配置无效，请重新填写');
 return {...config,apiKey:v.apiKey,profiles};
}
export class WindowsCredentialStore implements CredentialStore{
 constructor(private file:string){}
 async load():Promise<SavedCredentials|undefined>{
  let encoded:string;try{encoded=await readFile(this.file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw new Error('无法读取加密设置，请重新保存');}
  try{if(encoded.length>262144)throw Error();const saved=JSON.parse(encoded);if(saved.version!==1||typeof saved.ciphertext!=='string'||!/^[A-Za-z0-9+/=]+$/.test(saved.ciphertext))throw Error();return valid(JSON.parse(await crypt('unprotect',saved.ciphertext)));}catch{throw new Error('无法解密已保存设置，请在当前Windows用户下重新填写并保存');}
 }
 async save(value:SavedCredentials):Promise<void>{
  const payload=valid(value),ciphertext=await crypt('protect',JSON.stringify(payload));if(!/^[A-Za-z0-9+/=]+$/.test(ciphertext))throw new Error('加密设置返回无效');
  await mkdir(dirname(this.file),{recursive:true});const temp=this.file+'.'+crypto.randomUUID()+'.tmp';
  try{await writeFile(temp,JSON.stringify({version:1,ciphertext}),'utf8');await rename(temp,this.file);}finally{await rm(temp,{force:true});}
 }
 async clear():Promise<void>{await rm(this.file,{force:true});}
}
