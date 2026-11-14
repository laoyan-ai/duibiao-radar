import type {ResearchTask} from './types.js';

export type CollectionScope={searchLimit:number;profileLimit:number};

/** Collection budgets are separate from the legacy research/selection options. */
export function collectionScope(value?:unknown):CollectionScope {
 if(value===undefined)return {searchLimit:50,profileLimit:12};
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('采集范围必须为有效对象');
 const data=value as Record<string,unknown>;
 if(Object.keys(data).some(key=>!['searchLimit','profileLimit'].includes(key)))throw new Error('采集范围包含未知字段');
 const scope:CollectionScope={searchLimit:50,profileLimit:12};
 for(const key of ['searchLimit','profileLimit'] as const){
  const n=data[key]===undefined?scope[key]:data[key],max=key==='searchLimit'?200:30;
  if(typeof n!=='number'||!Number.isInteger(n)||n<1||n>max)throw new Error(key==='searchLimit'?'搜索视频上限须为1—200的整数':'每位主页作品上限须为1—30的整数');
  scope[key]=n;
 }
 return scope;
}

export function taskCollectionScope(task:Pick<ResearchTask,'collectionScope'>):CollectionScope {
 return collectionScope(task.collectionScope);
}
