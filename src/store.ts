import type {ResearchTask} from './types.js';
import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
export class TaskStore {
 private writes=new Map<string,Promise<void>>();
 constructor(public root:string,private replaceFile:(from:string,to:string)=>Promise<void>=rename){}
 private async replace(from:string,to:string){for(let attempt=0;;attempt++){try{await this.replaceFile(from,to);return;}catch(error){if(attempt>=5||!['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error;await new Promise(resolve=>setTimeout(resolve,50*2**attempt));}}}
 taskDir(id:string):string {if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw new Error('无效任务ID');return join(resolve(this.root),'tasks',id);}
 frameDir(id:string):string {return join(this.taskDir(id),'frames');}
 async save(task:ResearchTask):Promise<void>{
  task.updatedAt=new Date().toISOString();const json=JSON.stringify(task,null,2);const dir=this.taskDir(task.id);
  const previous=this.writes.get(task.id)??Promise.resolve();const next=previous.catch(()=>{}).then(async()=>{await mkdir(dir,{recursive:true});const temp=join(dir,`task-${crypto.randomUUID()}.tmp`);await writeFile(temp,json,'utf8');await this.replace(temp,join(dir,'task.json'));});
  this.writes.set(task.id,next);try{await next;}finally{if(this.writes.get(task.id)===next)this.writes.delete(task.id);}
 }
 async load(id:string):Promise<ResearchTask|undefined>{const path=join(this.taskDir(id),'task.json');await this.writes.get(id);try{return JSON.parse(await readFile(path,'utf8')) as ResearchTask;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}
 async list():Promise<ResearchTask[]>{await mkdir(join(this.root,'tasks'),{recursive:true});const ids=await readdir(join(this.root,'tasks'));const tasks:ResearchTask[]=[];for(const id of ids){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))continue;const t=await this.load(id);if(t)tasks.push(t);}return tasks.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async archiveLegacy(task:ResearchTask,name:'legacy-before-search50.json'|'legacy-before-v3.json'|'legacy-before-combined50.json'='legacy-before-v3.json'):Promise<void>{const dir=this.taskDir(task.id);await mkdir(dir,{recursive:true});try{await writeFile(join(dir,name),JSON.stringify(task,null,2),{encoding:'utf8',flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
 async recover():Promise<void>{for(const t of await this.list()){if(['searching','collecting','sampling','analyzing','stopping','idle'].includes(t.status)){t.status='paused';t.message='上次运行已中断；点击继续后才恢复，不会自动调用API';await this.save(t);}}}
}
