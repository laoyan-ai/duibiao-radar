import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

// A failed or unrecognized health response never licenses starting another process.
export function probeService(url='http://127.0.0.1:3210') {
  return new Promise(resolve=>{
    const request=http.get(`${url}/health`,response=>{
      let body='';
      response.setEncoding('utf8');
      response.on('data',chunk=>{body+=chunk;if(body.length>16384)request.destroy(new Error('health response too large'));});
      response.on('end',()=>{try{resolve({kind:'running',health:response.statusCode===200?JSON.parse(body):null});}catch{resolve({kind:'blocked',reason:'无法识别健康检查响应'});}});
      response.on('error',()=>resolve({kind:'blocked',reason:'健康检查响应中断'}));
    });
    request.setTimeout(2000,()=>request.destroy(new Error('健康检查超时')));
    request.on('error',error=>resolve(error.code==='ECONNREFUSED'?{kind:'absent'}:{kind:'blocked',reason:error.message}));
  });
}
export async function startLocal({app,build,probe=probeService,spawnServer=()=>spawn(process.execPath,[fileURLToPath(new URL('../dist/server.js',import.meta.url))],{cwd:fileURLToPath(new URL('..',import.meta.url)),stdio:'inherit',env:{...process.env,PORT:'3210'}}),log=console.log}={}) {
  if(app===undefined||build===undefined){const version=await import('../dist/build.js');app??=version.APP_ID;build??=version.APP_BUILD;}
  const service=await probe();
  if(service.kind==='running'&&service.health?.app===app&&service.health?.build===build){log('同版本后台已在运行，请打开 http://127.0.0.1:3210 。不会重新启动或续跑任务。');return 'reused';}
  if(service.kind!=='absent')throw new Error('3210 端口已有旧版或未知服务，或健康检查无法确认。请先停止当前任务，在原启动窗口按 Ctrl+C，再重新双击 start.cmd。不会自动结束任何进程。');
  log('正在启动本机服务：http://127.0.0.1:3210 。Ctrl+C 停止；任务不会自动续跑。');
  return spawnServer();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const child=await startLocal();if(child!=='reused'){child.on('error',error=>{console.error(`启动失败：${error.message}`);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});}}
  catch(error){console.error(error.message);process.exitCode=1;}
}
