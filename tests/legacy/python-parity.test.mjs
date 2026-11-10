import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ParityEngine, zero } from '../../scripts/dashboard-engine.mjs';

const rates={'gpt-6.1-sol':{input:2,cachedInput:0.1,cacheWrite:2.5,output:10}};
const stamp='2026-11-08T12:00:00.000Z';
const u=n=>({...zero(),input_tokens:n-10,output_tokens:10,total_tokens:n});
const ev=(n,t=stamp)=>({timestamp:t,model:'gpt-6.1-sol',total_token_usage:u(n),last_token_usage:u(n)});
const item=(type,payload,t=stamp)=>JSON.stringify({timestamp:t,type,payload});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'cousash-parity-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'sessions'));const options={home:root,dbPath:join(root,'usage.sqlite'),remoteDir:join(root,'remotes'),currentCode:'mac-test',scanInterval:0};return {root,options};}
const log=(id='s1')=>[
  item('session_meta',{id,cwd:'/tmp/demo',timestamp:stamp}),
  item('response_item',{type:'message',role:'user',content:[{text:'<environment_context>上下文</environment_context>'}]}),
  item('response_item',{type:'message',role:'user',content:[{text:'真实任务'}]}),
  item('turn_context',{turn_id:'t1',model:'gpt-6.1-sol',effort:'high'}),
  item('response_item',{type:'function_call',name:'exec_command'}),
  item('event_msg',{type:'token_count',info:{total_token_usage:u(110),last_token_usage:u(110),model_context_window:500000}}),
  item('event_msg',{type:'token_count',info:{total_token_usage:u(110),last_token_usage:u(110)}}),
  item('event_msg',{type:'task_complete',turn_id:'t1',duration_ms:1000,time_to_first_token_ms:40,last_agent_message:'完成'}),
].join('\n')+'\n';

test('同一日志与 Python 原版的 token、任务和工具统计一致',async t=>{
 const {root,options}=await fixture(t);await writeFile(join(root,'sessions','a.jsonl'),log());
 const script=fileURLToPath(new URL('../../scripts/codex_usage_dashboard.py',import.meta.url));
 const python='import importlib.util,sys,json; from pathlib import Path; s=importlib.util.spec_from_file_location("dash",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);a=m.CodexUsageAnalyzer(Path(sys.argv[2]),resolve_project_info=False,parallel_workers=0);d=a.scan("all",include_remotes=False);print(json.dumps(list(d["details_by_uid"].values())[0]));a.close()';
 const original=JSON.parse(execFileSync(process.env.PYTHON || 'python3',['-B','-c',python,script,root],{encoding:'utf8'}));
 const e=new ParityEngine(options);t.after(()=>e.close());await e.refresh();const d=Object.values(e.snapshot(new URLSearchParams({period:'all'}),rates).details_by_uid)[0];
 for(const field of ['total_token_usage','last_token_usage','models','tool_counts','effort','first_user_prompt','duration_ms_total','completed_turn_count','time_to_first_token_ms_avg'])assert.deepEqual(d[field],original[field],field);
});
