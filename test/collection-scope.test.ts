import test from 'node:test';import assert from 'node:assert/strict';
import {createTask} from '../src/domain.js';

test('new v4 tasks snapshot independent 200 by 30 collection scope and retain legacy options',()=>{
 const draft={searchLimit:200,profileLimit:30};const t=createTask('FDE','likes',undefined,4,draft);draft.searchLimit=1;
 assert.deepEqual(t.collectionScope,{searchLimit:200,profileLimit:30});
 assert.deepEqual(t.limits,{searchPerSort:200,maxSearchVideos:200,maxAuthors:200,profileMax:30,policy:'raw50'});
 assert.equal(t.options?.authorCount,5);
});
test('v4 defaults and partially specified scope use 50 search and 12 profile',()=>{
 assert.deepEqual(createTask('FDE','likes',undefined,4).collectionScope,{searchLimit:50,profileLimit:12});
 assert.deepEqual(createTask('FDE','likes',undefined,4,{profileLimit:20}).collectionScope,{searchLimit:50,profileLimit:20});
});
test('scope rejects malformed, unknown, noninteger and out of range values before task creation',()=>{
 for(const scope of [null,[],1,'50',{extra:1},{searchLimit:0},{searchLimit:201},{searchLimit:2.5},{searchLimit:'100'},{profileLimit:0},{profileLimit:31},{profileLimit:NaN}])assert.throws(()=>createTask('FDE','likes',undefined,4,scope));
 assert.equal(createTask('FDE','likes',undefined,4,{searchLimit:1,profileLimit:1}).limits.profileMax,1);
});
test('legacy v2 and v3 collection algorithms retain their existing limits',()=>{
 assert.equal(createTask('FDE','likes',undefined,2).limits.profileMax,300);
 assert.deepEqual(createTask('FDE','likes',undefined,3).limits,{searchPerSort:50,maxSearchVideos:50,maxAuthors:50,profileMax:12,policy:'combined50'});
});

test('legacy task missing scope resolves default budgets independently of limits or old options',async()=>{
 const {taskCollectionScope}=await import('../src/collection-scope.js');const old=createTask('FDE','likes',{authorCount:20,videosPerAuthor:20},3);delete old.collectionScope;
 old.limits.maxSearchVideos=100;old.limits.profileMax=30;assert.deepEqual(taskCollectionScope(old),{searchLimit:50,profileLimit:12});
});
test('nonrecord objects cannot silently become default scope',()=>{
 assert.throws(()=>createTask('FDE','likes',undefined,4,new Date()));
});
