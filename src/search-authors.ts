import type {Video,Author} from './types.js';
export function organizeSearchAuthors(input:Video[]):{videos:Video[];authors:Author[]}{
 const authors=new Map<string,Author>();
 const videos=input.map(source=>{
  const v={...source};
  // Recover only the standalone @author line immediately before a publication date.
  // An @mention inside a title is not evidence of authorship.
  const lines=v.description.trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const dated=/^(?:\d+\s*(?:分钟|小时|天|周|个?月|年)前|今天|昨天|\d{1,2}[-月]\d{1,2}日?|\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?)$/;
  if(!v.authorName&&dated.test(lines.at(-1)||'')){
   const name=lines.at(-2);if(name?.startsWith('@')&&name.length>1)v.authorName=name.slice(1).trim();
  }
  v.authorName=v.authorName.replace(/^@\s*/,'').trim();
  let identity:Author['identity']='account';
  if(!v.authorId||v.authorId.startsWith('nickname:')||v.authorId.startsWith('unverified:')){
   v.authorUrl='';
   if(v.authorName){const truncated=/…|\.{3}/.test(v.authorName);identity=truncated?'truncated':'nickname';v.authorId=truncated?'unverified:'+v.id:'nickname:'+encodeURIComponent(v.authorName.normalize('NFC'));}
   else v.authorId='';
  }
  if(v.authorId&&!authors.has(v.authorId))authors.set(v.authorId,{id:v.authorId,name:v.authorName,url:v.authorUrl,identity,coverage:'partial',reason:identity==='account'?'公开账号链接去重；未访问主页':identity==='truncated'?'昵称不完整，单独保留，不与其他记录合并':'按完整昵称暂归组，主页链接未提供；同名可能是不同账号',fetchedCount:0,sourceSorts:['search']});
  return v;
 });
 return {videos,authors:[...authors.values()]};
}
