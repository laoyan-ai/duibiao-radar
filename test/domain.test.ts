import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMetric,parsePublishDate,isInWindow,rankAuthors,selectTopVideos,samplingTimes,accountSelectionReasons,createTask as createVersionedTask} from '../src/domain.js';

const createTask=(keyword:string,mode:'engagement'|'likes'='likes',options?:unknown)=>createVersionedTask(keyword,mode,options,2);
import type {Video,ResearchTask} from '../src/types.js';
const now='2026-11-13T12:00:00.000Z', cutoff='2026-08-15T12:00:00.000Z';
const video=(id:string,authorId='a',likes='10',related=true):Video=>({id,url:'https://www.douyin.com/video/'+id,authorId,authorName:'同名',authorUrl:'https://www.douyin.com/user/'+authorId,title:'FDE',description:'',dateText:'10月5日',publishedAt:'2026-10-05T04:00:00.000Z',duration:90,likes:parseMetric(likes),favorites:parseMetric('2'),shares:parseMetric('3'),kind:'video',related,collectedAt:now,frames:[]});
const task=(videos:Video[]):ResearchTask=>({id:'t',keyword:'FDE',createdAt:now,cutoff,status:'idle',phase:'',message:'',mode:'engagement',limits:{searchPerSort:100,maxSearchVideos:200,maxAuthors:20,profileMax:300},videos,authors:['a','b'].map(id=>({id,name:'同名',url:'https://www.douyin.com/user/'+id,coverage:'complete',reason:'end',fetchedCount:5})),ranking:[],excludedAuthorIds:[],selectedVideoIds:[],errors:[],events:[],searchDone:true,totalFrames:0,updatedAt:now});

test('research options freeze requested days/counts and account selection uses requested maximum',()=>{
 const t=(createTask as any)('FDE','engagement',{authorCount:2,videosPerAuthor:7,days:30});
 assert.deepEqual(t.options,{authorCount:2,videosPerAuthor:7,days:30});assert.equal(Date.parse(t.createdAt)-Date.parse(t.cutoff),30*86400000);
 t.videos=Array.from({length:9},(_,i)=>({...video('v'+i),publishedAt:t.createdAt}));assert.equal(selectTopVideos(t,'a').length,7);
 assert.deepEqual((createTask('old') as any).options,{authorCount:5,videosPerAuthor:5,days:90});
});
test('research options reject zero fractions strings excessive values and unknown fields',()=>{
 for(const bad of [{authorCount:0},{videosPerAuthor:21},{days:366},{days:1.5},{days:'30'},{extra:2},null,[]])assert.throws(()=>(createTask as any)('FDE','engagement',bad));
 const legacy=task(Array.from({length:8},(_,i)=>video('v'+i)));assert.equal(selectTopVideos(legacy,'a').length,5);
});
test('missing metric differs from genuine zero; compact counts keep approximation',()=>{
 assert.equal(parseMetric('--').value,null);assert.equal(parseMetric('0').value,0);
 assert.deepEqual(parseMetric('1.2万'),{raw:'1.2万',value:12000,approximate:true});
 assert.equal(parseMetric('849').approximate,false);assert.equal(parseMetric('点赞').value,null);
});
test('date inference is conservative for ambiguous months and respects year rollover',()=>{
 assert.equal(parsePublishDate('3月前',new Date(now)),null);
 assert.equal(parsePublishDate('10月5日',new Date(now))?.slice(0,10),'2026-10-05');
 assert.equal(parsePublishDate('12月31日',new Date('2026-01-02T04:00:00Z'))?.slice(0,10),'2025-12-31');
 assert.equal(parsePublishDate('2026年2月30日',new Date(now)),null);
 assert.equal(parsePublishDate('发布时间：2026-10-05 10:00',new Date(now)),'2026-10-05T02:00:00.000Z');
 assert.equal(parsePublishDate('2026-10-05 01:02:03',new Date(now)),'2026-10-04T17:02:03.000Z');
});
test('window includes exact cutoff, excludes unknown, old and future posts',()=>{
 const v=video('1');v.publishedAt=cutoff;assert.equal(isInWindow(v,cutoff,now),true);
 v.publishedAt=null;assert.equal(isInWindow(v,cutoff,now),false);
 v.publishedAt='2026-12-01T00:00:00Z';assert.equal(isInWindow(v,cutoff,now),false);
});
test('rank sums best five related works with stable identities; not followers or entire post count',()=>{
 const t=task([...Array.from({length:6},(_,i)=>video('a'+i,'a','10')),video('b1','b','100'),video('other','a','99999',false)]);
 const r=rankAuthors(t);assert.equal(r[0].authorId,'b');assert.equal(r.find(x=>x.authorId==='a')?.score,75);
 assert.equal(r.find(x=>x.authorId==='a')?.videoIds.length,5);
});
test('unknown required interactions/partial source make rank tentative; explicit likes mode is consistent',()=>{
 const v=video('1');v.shares=parseMetric(null);const t=task([v]);
 assert.equal(rankAuthors(t).find(x=>x.authorId==='a')?.eligible,false);
 t.mode='likes';assert.equal(rankAuthors(t).find(x=>x.authorId==='a')?.eligible,true);
 t.authors[0].coverage='partial';assert.equal(rankAuthors(t).find(x=>x.authorId==='a')?.eligible,false);
});
test('account-wide selection includes unrelated high-like work and excludes old pinned posts',()=>{
 const old=video('old','a','99999');old.publishedAt='2025-10-05T00:00:00Z';
 const t=task([video('on','a','10'),video('off','a','100',false),old]);
 assert.deepEqual(selectTopVideos(t,'a').map(x=>x.id),['off','on']);
});
test('sampling schedule is bounded and deduplicated for short and hour-long video',()=>{
 const times=samplingTimes(3600);assert.deepEqual(times,[3,720,1800,2880,3597]);
 const tiny=samplingTimes(1);assert.ok(tiny.length<5);assert.ok(tiny.every(t=>t>=0&&t<=.8));assert.equal(new Set(tiny).size,tiny.length);
 assert.deepEqual(samplingTimes(0),[]);
});
test('unresolved related kind cannot disappear from ranking eligibility',()=>{
 const unknown=video('unknown');unknown.kind='unknown';const t=task([video('good'),unknown]);
 assert.equal(rankAuthors(t).find(r=>r.authorId==='a')?.eligible,false);
});
test('account selection uncertainty includes unrelated unknown date, kind and likes',()=>{
 const unknown=video('unknown','a','999',false);unknown.publishedAt=null;const t=task([video('good'),unknown]);
 assert.ok(accountSelectionReasons(t,'a').length>0);
 unknown.publishedAt=now;unknown.kind='unknown';assert.ok(accountSelectionReasons(t,'a').length>0);
 unknown.kind='video';unknown.likes=parseMetric(null);assert.ok(accountSelectionReasons(t,'a').length>0);
 unknown.likes=parseMetric('999');assert.equal(accountSelectionReasons(t,'a').length,0);
});
test('card ranking includes unknown date/type as tentative, excludes known outside window and explicit images',()=>{
 const unknown=video('unknown','a','900');unknown.publishedAt=null;unknown.kind='unknown';
 const old=video('old','a','99999');old.publishedAt='2024-01-01T00:00:00Z';const image=video('image','a','999999');image.kind='image';
 const t=task([unknown,old,image,video('known','a','5')]);t.mode='likes';assert.deepEqual(selectTopVideos(t,'a').map(v=>v.id),['unknown','known']);const rank=rankAuthors(t).find(r=>r.authorId==='a')!;assert.equal(rank.score,905);assert.equal(rank.eligible,false);
});
