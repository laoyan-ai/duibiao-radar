import test from 'node:test';
import assert from 'node:assert/strict';
import {startLocal} from '../scripts/start-local.mjs';
const expected={app:'douyin-research-local',build:'2026-11-14-ranking-only-3'};
function harness(probe:()=>Promise<any>){const logs:string[]=[];let starts=0;return {logs,get starts(){return starts;},options:{...expected,probe,log:(s:string)=>logs.push(s),spawnServer:()=>{starts++;return 'child';}}};}
test('launcher reuses matching instance without starting or opening anything',async()=>{const h=harness(async()=>({kind:'running',health:expected}));assert.equal(await startLocal(h.options),'reused');assert.equal(h.starts,0);assert.match(h.logs.join(''),/127.0.0.1:3210/);});
test('launcher refuses old, unknown and unreachable occupied services',async()=>{for(const result of [{kind:'running',health:{ok:true}},{kind:'running',health:{...expected,build:'old'}},{kind:'running',health:{...expected,app:'other'}},{kind:'blocked',reason:'timeout'}]){const h=harness(async()=>result);await assert.rejects(()=>startLocal(h.options),/Ctrl\+C/);assert.equal(h.starts,0);}});
test('launcher starts server only after connection refused',async()=>{const h=harness(async()=>({kind:'absent'}));assert.equal(await startLocal(h.options),'child');assert.equal(h.starts,1);});
test('health probe recognizes local version JSON, malformed and refused responses',async()=>{
 const {createServer}=await import('node:http');const {probeService}=await import('../scripts/start-local.mjs');
 let body=JSON.stringify(expected);const server=createServer((_req,res)=>res.end(body));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as import('node:net').AddressInfo;const url=`http://127.0.0.1:${address.port}`;
 try{assert.deepEqual(await probeService(url),{kind:'running',health:expected});body='not JSON';assert.equal((await probeService(url)).kind,'blocked');}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 assert.equal((await probeService(url)).kind,'absent');
});
