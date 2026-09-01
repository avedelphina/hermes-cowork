import { spawn } from 'node:child_process'; import { randomUUID } from 'node:crypto';
const t0=Date.now(); const T=()=>((Date.now()-t0)/1000).toFixed(1);
const p=spawn('/Users/avedelphina/.local/bin/hermes',['acp'],{stdio:['pipe','pipe','pipe'],env:{...process.env,HERMES_HOME:process.env.HOME+'/.hermes/profiles/anikke'}});
let buf='';const pend=new Map();const variants=new Set();const toolCalls=[];const plans=[];
p.stdout.on('data',c=>{buf+=c;let n;while((n=buf.indexOf('\n'))>=0){const l=buf.slice(0,n).trim();buf=buf.slice(n+1);if(!l)continue;let m;try{m=JSON.parse(l)}catch{continue}
 if(m.id!==undefined&&m.method===undefined){const q=pend.get(m.id);if(q){pend.delete(m.id);m.error?q.rej(m.error):q.res(m.result)}}
 else if(m.method==='session/update'){const u=m.params?.update||{};variants.add(u.sessionUpdate);
   if(u.sessionUpdate==='tool_call')toolCalls.push({title:u.title,kind:u.kind,name:u.toolName||u.name,raw:JSON.stringify(u.rawInput||{}).slice(0,120)});
   if(u.sessionUpdate==='plan')plans.push(JSON.stringify(u).slice(0,500));}
 else if(m.method==='session/request_permission'){console.log(T(),'PERMISSION REQ:',JSON.stringify(m.params?.toolCall?.title));p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{outcome:{outcome:'cancelled'}}})+'\n')}}});
p.stderr.on('data',()=>{});p.on('exit',c=>console.log(T(),'EXIT',c));
const req=(method,params)=>new Promise((res,rej)=>{const id=randomUUID();pend.set(id,{res,rej});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');setTimeout(()=>rej(new Error('timeout '+method)),120000)});
await req('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'x',version:'0'}});
const s=await req('session/new',{cwd:'/tmp',mcpServers:[]});
console.log(T(),'session',s.sessionId,'modes:',JSON.stringify(s.modes?.availableModes?.map(x=>x.id)));
const SYS=`You are running in Hermes Cowork mode. Before doing any work, propose a plan using kanban_create — one subtask per concrete step, linked under a parent task whose title is the user's goal.`;
const pr=await req('session/prompt',{sessionId:s.sessionId,prompt:[{type:'text',text:SYS+"\n\nGoal: Create three text files a.txt b.txt c.txt in /tmp/coworktest with the words one two three. Propose a plan now."}]});
console.log(T(),'prompt done:',pr.stopReason);
console.log('VARIANTS:',[...variants]);
console.log('TOOL CALLS:',JSON.stringify(toolCalls,null,1));
console.log('PLANS:',plans);
p.stdin.end();setTimeout(()=>p.kill(),300);
