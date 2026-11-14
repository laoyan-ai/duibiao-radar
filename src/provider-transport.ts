import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {createOpenAI} from '@ai-sdk/openai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import type {LanguageModelV4Prompt} from '@ai-sdk/provider';
import type {ResponseCreateParamsNonStreaming} from 'openai/resources/responses/responses';
import type {ProviderId} from './providers.js';

export function isPublicAddress(address:string):boolean {
 if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b!>=16&&b!<=31||a===192&&(b===168||b===0)||a===100&&b!>=64&&b!<=127||a!>=224||a===198&&(b===18||b===19));}
 if(isIP(address)===6){const a=address.toLowerCase();return /^[23]/.test(a)&&!a.startsWith('2001:db8:')&&!a.startsWith('2002:')&&!a.startsWith('2001:0:');}return false;
}
type Lookup=(hostname:string)=>Promise<{address:string;family:number}[]>;
export function guardedFetch(baseURL:string,options:{lookup?:Lookup;maxBytes?:number;timeoutMs?:number;request?:typeof httpsRequest}={}):typeof fetch {
 const base=new URL(baseURL),prefix=base.pathname.replace(/\/$/,'');
 return async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.protocol!=='https:'||url.origin!==base.origin||url.username||url.password||url.hash||url.search||!(url.pathname===prefix||url.pathname.startsWith(`${prefix}/`)))throw new Error('请求地址或路径超出已确认接口');
  const requestSignal=init?.signal??(input instanceof Request?input.signal:undefined);
  const signal=AbortSignal.any([...(requestSignal?[requestSignal]:[]),AbortSignal.timeout(options.timeoutMs??60000)]);signal.throwIfAborted();
  const hostname=url.hostname.replace(/^\[|\]$/g,''),addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await new Promise<{address:string;family:number}[]>((resolve,reject)=>{const abort=()=>reject(new Error('接口解析已取消或超时'));signal.addEventListener('abort',abort,{once:true});(options.lookup??(host=>lookup(host,{all:true})))(hostname).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
  if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('接口解析为私网或非公开地址，已拒绝请求');
  const requestInput=input instanceof Request?input:undefined,headers=new Headers(init?.headers??requestInput?.headers),headerObject=Object.fromEntries(headers);
  const body=init?.body??(requestInput?Buffer.from(await requestInput.arrayBuffer()):undefined);
  if(body!==undefined&&body!==null&&typeof body!=='string'&&!(body instanceof Uint8Array))throw new Error('不支持的请求内容');
  signal.throwIfAborted();
  return await new Promise<Response>((resolve,reject)=>{
   const req=(options.request??httpsRequest)(url,{method:init?.method??requestInput?.method??'GET',headers:headerObject,signal,lookup:((_host:unknown,opts:{all?:boolean},callback:Function)=>opts.all?callback(null,addresses.map(a=>({...a}))):callback(null,addresses[0]!.address,addresses[0]!.family)) as never},res=>{
    if((res.statusCode??500)>=300&&(res.statusCode??500)<400){res.destroy();reject(new Error('接口重定向已拒绝'));return;}
    const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>(options.maxBytes??4*1024*1024)){res.destroy();reject(new Error('接口响应超过大小上限'));return;}chunks.push(chunk);});res.on('error',()=>reject(new Error('接口响应中断')));res.on('end',()=>{const responseHeaders=new Headers();for(const [name,value] of Object.entries(res.headers))if(value!==undefined)responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);try{const status=res.statusCode??500;resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers:responseHeaders}));}catch{reject(new Error('接口响应格式无效'));}});
   });req.on('error',()=>reject(new Error('HTTPS接口请求失败')));if(body)req.write(body);req.end();
  });
 };
}
export async function sdkTransport(request:ResponseCreateParamsNonStreaming,options:{apiKey:string;baseURL:string;provider?:ProviderId;signal?:AbortSignal;fetch?:typeof fetch}){
 const provider=options.provider??'openai',network=options.fetch??guardedFetch(options.baseURL);
 // The compatible API gets explicit JSON mode; thinking is disabled for bounded text scoring.
 const fetcher:typeof fetch=provider==='openai'?network:async(input,init)=>{const body=JSON.parse(String(init?.body??'{}'));if(request.text?.format){body.response_format={type:'json_object'};}if(provider==='deepseek')body.thinking={type:'disabled'};return network(input,{...init,body:JSON.stringify(body)});};
 const model=provider==='openai'?createOpenAI({apiKey:options.apiKey,baseURL:options.baseURL,fetch:fetcher}).responses(request.model??''):createOpenAICompatible({name:provider,apiKey:options.apiKey,baseURL:options.baseURL,fetch:fetcher,supportsStructuredOutputs:false}).chatModel(request.model??'');
 const schema=request.text?.format?.type==='json_schema'?request.text.format.schema:undefined;
 const prompt:LanguageModelV4Prompt=[];if(request.instructions)prompt.push({role:'system',content:request.instructions+(provider!=='openai'&&schema?`\n必须返回JSON对象，严格遵守以下JSON Schema：${JSON.stringify(schema)}`:'')});
 if(Array.isArray(request.input))for(const item of request.input){if(item.type&&item.type!=='message'||!('role' in item)||item.role!=='user')throw new Error('不支持的模型输入格式');if(typeof item.content==='string'){prompt.push({role:'user',content:[{type:'text',text:item.content}]});continue;}const content=[];for(const part of item.content){if(part.type==='input_text')content.push({type:'text' as const,text:part.text});else if(part.type==='input_image'&&part.image_url?.startsWith('data:image/')){const match=/^data:(image\/[a-z]+);base64,(.+)$/.exec(part.image_url);if(!match)throw new Error('图像输入格式无效');content.push({type:'file' as const,data:{type:'data' as const,data:new Uint8Array(Buffer.from(match[2]!,'base64'))},mediaType:match[1]!});}else throw new Error('不支持的模型输入格式');}prompt.push({role:'user',content});}
 const result=await model.doGenerate({prompt,maxOutputTokens:request.max_output_tokens??undefined,abortSignal:options.signal,responseFormat:schema?{type:'json',schema}:undefined,providerOptions:provider==='openai'?{openai:{store:false,...(request.reasoning?.effort?{reasoningEffort:request.reasoning.effort}:{})}}:undefined});
 return {output_text:result.content.filter(c=>c.type==='text').map(c=>c.text).join(''),status:result.finishReason.unified==='stop'?'completed':'incomplete',usage:{...(typeof result.usage.inputTokens.total==='number'?{input_tokens:result.usage.inputTokens.total}:{}),...(typeof result.usage.outputTokens.total==='number'?{output_tokens:result.usage.outputTokens.total}:{}),...(typeof result.usage.inputTokens.total==='number'&&typeof result.usage.outputTokens.total==='number'?{total_tokens:result.usage.inputTokens.total+result.usage.outputTokens.total}:{})}};
}




