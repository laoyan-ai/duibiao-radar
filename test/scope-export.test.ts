import test from 'node:test';import assert from 'node:assert/strict';
import {exportTask} from '../src/export.js';
import {createTask,parseMetric} from '../src/domain.js';
import type {Author,Video} from '../src/types.js';
function scopeFixture(){
 const task=createTask('FDE');Object.assign(task,{collectionVersion:4,profileRanking:true,rankingRequested:true,collectionScope:{searchLimit:100,profileLimit:30}});
 const videos:Video[]=Array.from({length:30},(_,i)=>({id:`v${i+1}`,authorId:'a',authorName:'作者',authorUrl:'',url:`https://www.douyin.com/video/${i+1}`,title:`标题${i+1}`,description:'',dateText:'',publishedAt:null,duration:null,likes:parseMetric(i===29?'3000':'0'),favorites:parseMetric(null),shares:parseMetric(null),kind:'unknown',related:false,collectedAt:'2026-11-14',frames:[]}));
 const author:Author={id:'a',name:'作者',url:'https://www.douyin.com/user/a',bio:'FDE',profileCollected:true,profileSampleIds:videos.map(v=>v.id),coverage:'partial',fetchedCount:30,relevance:{profileScore:0,videos:videos.map((v,i)=>({id:v.id,score:i===29?100:0,reason:`依据${i+1}`})),reason:'全部样本'}};
 task.videos=videos;task.authors=[author];return {task,author,videos};
}
test('candidate markdown and CSV record frozen limits, actual counts and every evidence title',()=>{
 const {task}=scopeFixture();for(const format of ['md','csv'] as const){const output=exportTask(task,format);assert.match(output,/搜索视频上限/);assert.match(output,/主页作品上限/);assert.match(output,/100/);assert.match(output,/30/);assert.match(output,/实际搜索视频数/);assert.match(output,/实际博主数/);assert.match(output,/标题30/);assert.match(output,/依据30/);}
 assert.doesNotMatch(exportTask(task,'md'),/前50条|前12条/);
});
test('unranked search exports include frozen limits and actual counts',()=>{
 const {task}=scopeFixture();task.rankingRequested=false;task.profileRanking=false;
 for(const format of ['md','csv'] as const){const output=exportTask(task,format);assert.match(output,/搜索视频上限/);assert.match(output,/主页作品上限/);assert.match(output,/100/);assert.match(output,/实际搜索视频数/);assert.match(output,/实际博主数/);assert.match(output,/标题30/);}
 assert.doesNotMatch(exportTask(task,'md'),/前50条|\/50条/);
});
test('empty CSV exports still record scope values and zero actual counts',()=>{
 const {task}=scopeFixture();task.authors=[];task.videos=[];task.searchVideoIds=[];
 for(const ranked of [true,false]){task.rankingRequested=ranked;const output=exportTask(task,'csv');assert.match(output,/"100","30","0","0"/);}
});
