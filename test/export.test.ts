import {test} from 'node:test';import assert from 'node:assert/strict';import {exportTask} from '../src/export.js';import {createTask as createVersionedTask,parseMetric} from '../src/domain.js';

const createTask=(keyword:string,mode:'engagement'|'likes'='likes',options?:unknown)=>createVersionedTask(keyword,mode,options,2);
test('report states frozen research scope rather than fixed ninety days or five authors',()=>{
 const t=(createTask as any)('FDE','engagement',{authorCount:3,videosPerAuthor:2,days:30});assert.match(exportTask(t,'md'),/近30天/);assert.match(exportTask(t,'md'),/3位.*2条/);assert.match(exportTask(t,'csv'),/时间范围/);
});
test('CSV escapes spreadsheet formulas and quotes; markdown marks missing data and partial coverage',()=>{
 const t=createTask('FDE');t.status='partial';t.videos=[{id:'1',url:'https://www.douyin.com/video/1',authorId:'a',authorName:'=cmd',authorUrl:'',title:'=1+2,"x"',description:'',dateText:'3月前',publishedAt:null,duration:1,likes:parseMetric(null),favorites:parseMetric('0'),shares:parseMetric('1'),kind:'video',related:true,collectedAt:t.createdAt,frames:[]}];t.selectedVideoIds=['1'];
 const csv=exportTask(t,'csv');assert.ok(csv.includes("'=1+2"));assert.ok(csv.includes('未获取'));assert.ok(!csv.includes('apiKey'));
 assert.ok(exportTask(t,'md').includes('未核实'));assert.ok(exportTask(t,'md').includes('样本'));
});
