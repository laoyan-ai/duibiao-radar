import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {TaskStore} from '../src/store.js';import {createTask} from '../src/domain.js';
test('store atomically saves public task state; interrupted jobs recover paused without running',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dy-store-'));try{const s=new TaskStore(dir);const t=createTask('FDE');t.status='sampling';await s.save(t);
 assert.equal((await s.load(t.id))?.keyword,'FDE');await s.recover();assert.equal((await s.load(t.id))?.status,'paused');assert.equal((await s.list()).length,1);
 assert.ok(!(await readFile(join(s.taskDir(t.id),'task.json'),'utf8')).includes('apiKey'));await assert.rejects(s.load('../escape'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
