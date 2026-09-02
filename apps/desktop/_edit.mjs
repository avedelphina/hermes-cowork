import { spawn } from 'node:child_process'; import { randomUUID } from 'node:crypto';
const p=spawn('/Users/avedelphina/.local/bin/hermes',['acp'],{stdio:['pipe','pipe','pipe'],env:{...process.env,HERMES_HOME:process.env.HOME+'/.hermes/profiles/anikke'}});
let buf='';const pend=new Map();
p.stdout.on('data',c=>{buf+=c;let n;while((n=buf.indexOf('\n'))>=0){const l=buf.slice(0,n).trim();buf=buf.slice(n+1);if(!l)continue;let m;try{m=JSON.parse(l)}catch{continue}
 if(m.id!==undefined&&m.method===undefined){const q=pend.get(m.id);if(q){pend.delete(m.id);m.error?q.rej(m.error):q.res(m.result)}}
 else if(m.method==='session/update'){const u=m.params?.update||{};
   if(u.sessionUpdate==='tool_call')console.log('TOOL_CALL:',JSON.stringify(u));
   if(u.sessionUpdate==='tool_call_update')console.log('TOOL_UPDATE:',JSON.stringify(u).slice(0,300));}
 else if(m.method==='session/request_permission'){console.log('PERM:',JSON.stringify(m.params).slice(0,400));p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{outcome:{outcome:'selected',optionId:(m.params.options.find(o=>o.kind==='allow_once')||m.params.options[0]).optionId}}})+'\n')}}});
p.stderr.on('data',()=>{});
const req=(method,params)=>new Promise((res,rej)=>{const id=randomUUID();pend.set(id,{res,rej});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');setTimeout(()=>rej(new Error('t')),120000)});
await req('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'x',version:'0'}});
const s=await req('session/new',{cwd:'/tmp/edittest',mcpServers:[]});
await req('session/set_mode',{sessionId:s.sessionId,modeId:'default'});
const r=await req('session/prompt',{sessionId:s.sessionId,prompt:[{type:'text',text:'Create a file foo.txt containing the word bar in the current directory. Just do it.'}]});
console.log('done',r.stopReason);
p.stdin.end();setTimeout(()=>p.kill(),300);
