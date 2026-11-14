import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTask,parseMetric} from '../src/domain.js';
import {Analyzer} from '../src/analyzer.js';
import {assessmentInput,authorAssessmentKey,buildCandidateScores,sampleVideos,validateAssessment,SCORING_VERSION} from '../src/scoring.js';
import type {Author,Video} from '../src/types.js';

export function scopeFixture(){
 const task=createTask('FDE');Object.assign(task,{collectionVersion:4,profileRanking:true,rankingRequested:true,collectionScope:{searchLimit:100,profileLimit:30}});
 const videos:Video[]=Array.from({length:30},(_,i)=>({id:`v${i+1}`,authorId:'a',authorName:'作者',authorUrl:'',url:`https://www.douyin.com/video/${i+1}`,title:`标题${i+1}`,description:'',dateText:'',publishedAt:null,duration:null,likes:parseMetric(i===29?'3000':'0'),favorites:parseMetric(null),shares:parseMetric(null),kind:'unknown',related:false,collectedAt:'2026-11-14',frames:[]}));
 const author:Author={id:'a',name:'作者',url:'https://www.douyin.com/user/a',bio:'FDE',profileCollected:true,profileSampleIds:videos.map(v=>v.id),coverage:'partial',fetchedCount:30,relevance:{profileScore:0,videos:videos.map((v,i)=>({id:v.id,score:i===29?100:0,reason:`依据${i+1}`})),reason:'全部样本'}};
 task.videos=videos;task.authors=[author];return {task,author,videos};
}
test('frozen thirty-title scope includes the last title in validation, mean likes and relevance',()=>{
 const {task,author,videos}=scopeFixture();assert.equal(sampleVideos(task,author).length,30);
 const input=assessmentInput('FDE',author,videos,30);assert.equal(input.videos.length,30);
 assert.throws(()=>validateAssessment({...author.relevance!,videos:author.relevance!.videos.slice(0,29)},input),/缺少/);
 const row=buildCandidateScores(task)[0];assert.equal(row.sampleCount,30);assert.equal(row.meanLikes,100);assert.equal(row.relevanceScore,2.7);
 assert.ok(!row.warnings.some(w=>w.includes('不足12')||w.includes('前12')));
 task.videos=videos.slice(0,29);assert.ok(buildCandidateScores(task)[0].warnings.some(w=>w.includes('不足30')));
});
test('default twelve keeps historic input and hash; nondefault scope prevents false cache reuse even when underfilled',()=>{
 const {author,videos}=scopeFixture();const old={version:SCORING_VERSION,keyword:'FDE',author:{id:'a',name:'作者',bio:'FDE'},videos:videos.slice(0,12).map(v=>({id:v.id,title:v.title}))};
 assert.deepEqual(assessmentInput(' FDE ',author,videos),old);
 const legacyKey=createHash('sha256').update(JSON.stringify({model:'model',input:old})).digest('hex');assert.equal(authorAssessmentKey('FDE',author,videos,'model'),legacyKey);
 assert.notEqual(authorAssessmentKey('FDE',author,videos.slice(0,1),'model',30),authorAssessmentKey('FDE',author,videos.slice(0,1),'model',12));
});
test('analyzer sends and accepts all thirty titles, scales output budget and isolates scoped cache',async()=>{
 const {author,videos}=scopeFixture();let calls=0;const analyzer=new Analyzer(async request=>{
  calls++;const input=JSON.parse((request.input as any)[0].content[0].text);assert.equal(input.videos.length,calls===1?12:30);
  if(calls>1){assert.ok(request.max_output_tokens!>4000&&request.max_output_tokens!<=12000);assert.match(request.instructions!,/30/);}
  return {output_text:JSON.stringify({...author.relevance!,videos:author.relevance!.videos.slice(0,input.videos.length)}),status:'completed'};
 });analyzer.configure('offline-fake-key','offline-model');
 await analyzer.scoreAuthor('FDE',author,videos);const full=await analyzer.scoreAuthor('FDE',author,videos,{profileLimit:30});assert.equal(full.assessment.videos.length,30);assert.equal((await analyzer.scoreAuthor('FDE',author,videos,{profileLimit:30})).cached,true);assert.equal(calls,2);
 for(const profileLimit of [0,31,1.5])await assert.rejects(analyzer.scoreAuthor('FDE',author,videos,{profileLimit}));
});
test('analyzer rejects a response omitting the thirtieth title without caching it',async()=>{
 const {author,videos}=scopeFixture();let calls=0;const analyzer=new Analyzer(async()=>{calls++;return {output_text:JSON.stringify({...author.relevance!,videos:author.relevance!.videos.slice(0,29)}),status:'completed'};});analyzer.configure('offline-fake-key','offline-model');
 await assert.rejects(analyzer.scoreAuthor('FDE',author,videos,{profileLimit:30}),/缺少/);await assert.rejects(analyzer.scoreAuthor('FDE',author,videos,{profileLimit:30}));assert.equal(calls,2);
});
