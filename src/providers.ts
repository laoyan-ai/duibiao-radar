import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {guardedFetch,isPublicAddress} from './provider-transport.js';
export type ProviderId='openai'|'deepseek'|'qwen'|'doubao'|'custom';
export type ProviderConfig={provider:ProviderId;baseURL:string;model:string};
type ProviderDefinition={id:ProviderId;label:string;baseURL:string;defaultModel:string;models:{id:string;label:string}[];endpoints?:{label:string;url:string}[]};
const models=(...ids:string[])=>ids.map(id=>({id,label:id}));
export const PROVIDERS:ProviderDefinition[]=[
 {id:'openai',label:'OpenAI',baseURL:'https://api.openai.com/v1',defaultModel:'gpt-6.1-sol',models:models('gpt-6.1-sol')},
 {id:'deepseek',label:'DeepSeek',baseURL:'https://api.deepseek.com/v1',defaultModel:'deepseek-flash',models:models('deepseek-flash','deepseek-v4-pro')},
 {id:'qwen',label:'通义千问',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',defaultModel:'qwen-plus',models:models('qwen-plus','qwen-turbo'),endpoints:[{label:'中国内地（北京）',url:'https://dashscope.aliyuncs.com/compatible-mode/v1'},{label:'国际（新加坡）',url:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'},{label:'美国（弗吉尼亚）',url:'https://dashscope-us.aliyuncs.com/compatible-mode/v1'}]},
 {id:'doubao',label:'豆包 / 火山方舟',baseURL:'https://ark.cn-beijing.volces.com/api/v3',defaultModel:'',models:[]},
 {id:'custom',label:'自定义兼容接口',baseURL:'',defaultModel:'',models:[]},
];
export function normalizeProviderConfig(input:Partial<ProviderConfig>={}):ProviderConfig {
 const definition=PROVIDERS.find(p=>p.id===(input.provider??'openai'));if(!definition)throw new Error('不支持的模型厂商');
 const raw=(input.baseURL??definition.baseURL).trim();let url:URL;try{url=new URL(raw);}catch{throw new Error('请填写有效HTTPS接口地址');}
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.')&&!isIP(host)||isIP(host)&&!isPublicAddress(host))throw new Error('接口地址必须为公开HTTPS地址，不允许私网、账号或查询参数');
 url.pathname=url.pathname.replace(/\/+$/,'');const baseURL=url.toString().replace(/\/$/,'');
 const allowed=definition.id==='custom'||baseURL===definition.baseURL||definition.endpoints?.some(e=>e.url===baseURL)||definition.id==='qwen'&&/^https:\/\/[a-zA-Z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1|us-east-1)\.maas\.aliyuncs\.com\/compatible-mode\/v1$/.test(baseURL);
 if(!allowed)throw new Error('请选择该厂商的官方接口地址；其他地址请使用自定义接口');
 const model=(input.model??definition.defaultModel).trim();if(model.length>200||/[\r\n\0]/.test(model))throw new Error('模型名称无效');
 return {provider:definition.id,baseURL,model};
}
export function profileId(config:ProviderConfig){const c=normalizeProviderConfig(config);return `${c.provider}:${createHash('sha256').update(c.baseURL).digest('hex')}`;}
export function cacheModelIdentity(config:ProviderConfig){const c=normalizeProviderConfig(config);return c.provider==='openai'?c.model:`${profileId(c)}:${c.model}`;}
export async function listProviderModels(config:ProviderConfig,key:string,signal?:AbortSignal,fetcher?:typeof fetch):Promise<{models:{id:string;label:string}[];source:'remote'|'preset';message:string}>{
 const c=normalizeProviderConfig(config);if(!key.trim()||key.length>1000||/[\r\n\0]/.test(key))throw new Error('请填写有效API Key');
 const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
 try{
  const response=await (fetcher??guardedFetch(c.baseURL,{maxBytes:1024*1024,timeoutMs:10000}))(`${c.baseURL}/models`,{headers:{authorization:`Bearer ${key.trim()}`},signal:combined,redirect:'error'});
  if(!response.ok||response.status>=300)throw new Error('模型列表请求失败');
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];if(reader)try{while(true){combined.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024)throw new Error('响应过大');chunks.push(value);}}finally{await reader.cancel();}
  const data=JSON.parse(Buffer.concat(chunks).toString()) as {data?:unknown};
  if(!Array.isArray(data.data))throw new Error('格式无效');
  const found=[...new Set(data.data.flatMap((item:unknown)=>{const id=(item as {id?:unknown})?.id;return typeof id==='string'&&id.trim()&&id.length<=200&&!/[\r\n\0]/.test(id)&&!id.includes(key)?[id]:[];}))].slice(0,2000);
  if(!found.length)throw new Error('没有可用模型');return {models:models(...found),source:'remote',message:'已获取模型列表；列出不代表当前账号可调用，仍需文字连接测试'};
 }catch{if(signal?.aborted)throw new Error('操作已取消');return {models:structuredClone(PROVIDERS.find(p=>p.id===c.provider)!.models),source:'preset',message:'模型列表获取失败，以下为未验证预设；请核对Key权限或手动填写模型/推理接入点ID'};}
}


