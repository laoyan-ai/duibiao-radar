import test from 'node:test';import assert from 'node:assert/strict';
import {createTask,parseMetric} from '../src/domain.js';
import {buildCandidateScores,authorAssessmentKey,assessmentInput,validateAssessment} from '../src/scoring.js';
import type {Author,Video} from '../src/types.js';
import {exportTask} from '../src/export.js';
const video=(id:string,likes:string|null,title='企业AI应用'):Video=>({id,authorId:id.split('-')[0],authorName:'作者',authorUrl:'',url:'https://www.douyin.com/video/'+id,title,description:'',dateText:'',publishedAt:null,duration:null,likes:parseMetric(likes),favorites:parseMetric(null),shares:parseMetric(null),kind:'unknown',related:false,collectedAt:'2026-11-14T00:00:00Z',frames:[]});
function author(id:string,ids:string[],score=80):Author{return {id,name:'作者'+id,url:'https://www.douyin.com/user/'+id,bio:'企业AI服务',profileSampleIds:ids,coverage:'partial',reason:'只取12',fetchedCount:ids.length,relevance:{profileScore:score,videos:ids.map(id=>({id,score,reason:'标题依据'})),reason:'样本方向'}};}
test('new task uses exact combined50, all50 possible authors, first12 profile budget, fixed half-year',()=>{
 const t=createTask('企业AI服务');assert.equal(t.collectionVersion,3);assert.deepEqual(t.limits,{searchPerSort:50,maxSearchVideos:50,maxAuthors:50,profileMax:12,policy:'combined50'});assert.equal(t.options!.days,180);
});
test('scores use only displayed sample IDs, average known likes, log cohort scale and 70/30 composite',()=>{
 const t=createTask('AI');t.videos=[video('a-1','100'),video('a-2','300'),video('a-extra','999999'),video('b-1','2000')];t.authors=[author('a',['a-1','a-2']),author('b',['b-1'],30)];
 const scores=buildCandidateScores(t),a=scores.find(s=>s.authorId==='a')!,b=scores.find(s=>s.authorId==='b')!;assert.equal(a.meanLikes,200);assert.equal(a.totalLikes,400);assert.equal(a.maxLikes,300);assert.equal(a.relevanceScore,80);assert.equal(b.likesScore,100);assert.equal(a.likesScore,Math.round(100*Math.log1p(200)/Math.log1p(2000)*10)/10);assert.equal(a.compositeScore,Math.round((80*.7+a.likesScore!*.3)*10)/10);assert.equal(scores[0].authorId,'a');
});
test('real zero differs from missing; absent semantic score never becomes zero; excluded stays visible',()=>{
 const t=createTask('AI');t.videos=[video('a-1','0'),video('b-1',null),video('c-1','0')];t.authors=[author('a',['a-1']),author('b',['b-1']),author('c',['c-1'])];t.authors[2].relevance=undefined;t.excludedAuthorIds=['a'];const s=buildCandidateScores(t);
 assert.equal(s.find(x=>x.authorId==='a')!.likesScore,0);assert.equal(s.find(x=>x.authorId==='a')!.excluded,true);assert.equal(s.find(x=>x.authorId==='b')!.likesScore,null);assert.equal(s.find(x=>x.authorId==='b')!.compositeScore,null);assert.equal(s.find(x=>x.authorId==='c')!.relevanceScore,null);assert.equal(s.length,3);
});
test('assessment validates exact supplied title IDs and missing bio; cache ignores likes but changes with topic/model/text',()=>{
 const a=author('a',['a-1']),v=[video('a-1','10')];const input=assessmentInput('FDE',a,v);validateAssessment(a.relevance!,input);assert.throws(()=>validateAssessment({...a.relevance!,videos:[{id:'invented',score:100,reason:'假的'}]},input));assert.throws(()=>validateAssessment({...a.relevance!,profileScore:101},input));const k=authorAssessmentKey('FDE',a,v,'model');v[0].likes=parseMetric('200');assert.equal(k,authorAssessmentKey('FDE',a,v,'model'));assert.notEqual(k,authorAssessmentKey('AI',a,v,'model'));assert.notEqual(k,authorAssessmentKey('FDE',a,v,'other'));a.bio='';assert.throws(()=>validateAssessment(a.relevance!,assessmentInput('FDE',a,v)));
});
test('candidate exports include all rows and raw evidence, preserve missing scores and escape malicious text',()=>{
 const t=createTask('AI');t.videos=[video('a-1','10'),video('b-1',null)];t.authors=[author('a',['a-1']),author('b',['b-1'])];t.authors[0].name='=1+2';t.authors[0].bio='<script>unsafe</script>';t.authors[1].relevance=undefined;t.candidateScores=buildCandidateScores(t);const csv=exportTask(t,'csv'),md=exportTask(t,'md');assert.doesNotMatch(csv,/最终入选/);assert.match(csv,/'=1\+2/);assert.match(csv,/内容相关度分/);assert.match(csv,/未评分/);assert.match(md,/作者b/);assert.ok(!md.includes('<script>'));assert.match(md,/70%/);assert.match(md,/企业AI应用/);
});
