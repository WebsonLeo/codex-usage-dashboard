/** 原版功能对应的 Node 数据层；SQLite 持久化会话、事件和远程快照。 */
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, mkdirSync, existsSync } from 'node:fs';
import { readdir, stat, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { homedir, hostname, platform } from 'node:os';
import { dirname, join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const keys = ['input_tokens','cached_input_tokens','cache_write_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
export const zero = () => Object.fromEntries(keys.map(k => [k, 0]));
export const norm = v => Object.fromEntries(keys.map(k => [k, Math.max(0, Number(v?.[k] ?? (k === 'cache_write_tokens' ? v?.cache_write_input_tokens : 0)) || 0)]));
export const add = (a,b) => Object.fromEntries(keys.map(k => [k, (a?.[k] || 0) + (b?.[k] || 0)]));
export function delta(a,b) {
  if ((a.total_tokens || 0) < (b.total_tokens || 0)) return norm(a);
  return Object.fromEntries(keys.map(k => [k, Math.max(0, (a?.[k] || 0) - (b?.[k] || 0))]));
}
const hash = s => createHash('sha256').update(s).digest('hex').slice(0,16);
const clean = (s,n=260) => String(s || '').replace(/\s+/g,' ').trim().slice(0,n);
const iso = t => Number.isFinite(Date.parse(t)) ? new Date(t).toISOString() : null;
const modelOf = p => p?.model || p?.model_slug || p?.model_name || p?.thread_settings?.model || p?.thread_settings?.model_slug || p?.collaboration_mode?.settings?.model || p?.thread_settings?.collaboration_mode?.settings?.model || '';
const synthetic = t => /^(<(?:environment_context|recommended_plugins|permissions|skill|external_|INSTRUCTIONS)|# AGENTS\.md instructions)/i.test(t.trim());
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x=>x.text || '').join(' ') : '';
const SCHEMA = 'cousash.remote-snapshot';
const PARSER = 4;

function configDir() {
  if (process.env.COUSASH_CONFIG_DIR) return process.env.COUSASH_CONFIG_DIR;
  if (platform()==='darwin') return join(homedir(),'Library','Application Support','cousash');
  if (platform()==='win32') return join(process.env.APPDATA || join(homedir(),'AppData','Roaming'),'cousash');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(),'.config'),'cousash');
}
function deviceCode() {
  let identity=''; const prefix=platform()==='darwin'?'mac':platform()==='win32'?'win':'linux';
  try {
    if(platform()==='darwin') identity=execFileSync('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{encoding:'utf8',timeout:2000}).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] || '';
  } catch {}
  return `${prefix}-${hash(`${prefix}:${identity || hostname()}`).slice(0,8)}`;
}

export function periodBounds(q, now=new Date()) {
  const key=q.get('period') || q.get('range') || 'today'; const end=new Date(now); let start=new Date(now);
  const relative={'30m':30,'1h':60,'3h':180,'5h':300,'10h':600};
  if(relative[key]) start=new Date(+now-relative[key]*60000);
  else if(key==='all') start=new Date(0);
  else if(key==='custom' || key==='interval') {
    let a=q.get('from') || q.get('start'), b=q.get('to') || q.get('end') || a;
    if(!a || !b) throw Error('请填写起止时间');
    const dateOnly=/^\d{4}-\d{2}-\d{2}$/;
    start=new Date(dateOnly.test(a)?a+'T00:00:00':a);
    end.setTime(+new Date(dateOnly.test(b)?b+'T23:59:59.999':b));
    if(!Number.isFinite(+start) || !Number.isFinite(+end) || start>end) throw Error('起止时间无效或顺序错误');
  } else {
    start.setHours(0,0,0,0);
    if(key==='7d') start.setDate(start.getDate()-6);
    else if(key==='30d') start.setDate(start.getDate()-29);
    else if(key==='week') start.setDate(start.getDate()-((start.getDay()+6)%7));
    else if(key==='month') start.setDate(1);
    else if(key!=='today') throw Error('不支持的时间区间');
  }
  const day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return {key,start_at:start.toISOString(),end_at:end.toISOString(),start_date:day(start),end_date:day(end)};
}

export async function parseLog(file, source, home, titles={}) {
  const d={uid:hash(home+':'+file),session_id:'',root_session_id:'',parent_thread_id:'',forked_from_id:'',is_subagent:false,agent_path:'',agent_nickname:'',agent_role:'',thread_source:'',title:'',source,codex_home:home,path:file,cwd:'',project:'',project_root:'',workspace_root:'',project_branch:'',is_git_worktree:false,environment_id:platform()==='darwin'?'macos':platform(),environment:platform()==='darwin'?'macOS':platform(),is_remote:false,model:'unknown',models:[],effort:'',timeline:[],tasks:[],tool_counts:{},first_user_prompt:'',last_agent_preview:'',parse_errors:0,line_count:0,user_message_count:0,assistant_message_count:0,turn_ids:[],latest_rate_limits:null};
  let meta=false;
  for await(const line of createInterface({input:createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity})) {
    d.line_count++; let item; try {item=JSON.parse(line);} catch {if(line.trim()) d.parse_errors++;continue;}
    const p=item.payload || {}, t=iso(item.timestamp); if(t) {d.start_at ||=t; d.end_at=t;}
    const note=v=>{if(v){d.model=String(v);if(!d.models.includes(d.model))d.models.push(d.model);}};
    const prompt=v=>{const s=textOf(v); if(s && !synthetic(s) && !d.first_user_prompt)d.first_user_prompt=clean(s);};
    if(item.type==='session_meta' && !meta) {
      meta=true; d.session_id=String(p.id || p.session_id || hash(file)); d.root_session_id=String(p.session_id || d.session_id); d.created_at=iso(p.timestamp)||t;
      d.cwd=p.cwd || ''; d.originator=p.originator||'';d.cli_version=p.cli_version||''; note(modelOf(p));
      const sub=p.source?.subagent || {}, spawn=sub.thread_spawn || sub;
      for(const k of ['parent_thread_id','forked_from_id','agent_path','agent_nickname','agent_role'])d[k]=String(p[k] || spawn[k] || sub[k] || '');
      d.thread_source=p.thread_source || '';d.is_subagent=Boolean(p.source?.subagent || d.parent_thread_id || d.thread_source==='subagent');
      if(d.is_subagent && !d.parent_thread_id)d.parent_thread_id=d.forked_from_id || (d.root_session_id!==d.session_id?d.root_session_id:'');
    } else if(item.type==='turn_context') {note(modelOf(p));d.cwd=p.cwd||d.cwd;d.effort=p.effort||p.reasoning_effort||d.effort;if(p.turn_id && !d.turn_ids.includes(p.turn_id))d.turn_ids.push(p.turn_id);}
    else if(item.type==='response_item') {
      if(p.type==='message' && p.role==='user'){d.user_message_count++;prompt(p.content);}
      if(p.type==='message' && p.role==='assistant'){d.assistant_message_count++;d.last_agent_preview=clean(textOf(p.content),320);}
      if(p.type==='function_call')d.tool_counts[p.name||'function_call']=(d.tool_counts[p.name||'function_call']||0)+1;
    } else if(item.type==='event_msg') {
      if(p.type==='thread_settings_applied'){note(modelOf(p));d.effort=p.thread_settings?.reasoning_effort||p.thread_settings?.effort||p.effort||d.effort;}
      else if(p.type==='token_count') {
        d.latest_rate_limits=p.rate_limits||null;d.latest_plan_type=p.plan_type||d.latest_plan_type;d.latest_rate_limit_reached_type=p.rate_limit_reached_type||'';
        if(p.info && t){note(modelOf(p.info)||modelOf(p));d.model_context_window=p.info.model_context_window;d.timeline.push({timestamp:t,model:d.model,total_token_usage:norm(p.info.total_token_usage),last_token_usage:norm(p.info.last_token_usage),model_context_window:d.model_context_window,rate_limits:d.latest_rate_limits});}
      } else if(p.type==='task_complete') {d.tasks.push({timestamp:t,turn_id:p.turn_id,duration_ms:p.duration_ms,time_to_first_token_ms:p.time_to_first_token_ms});if(p.last_agent_message)d.last_agent_preview=clean(p.last_agent_message,320);}
      else if(['user_message','user_input','human_message'].includes(p.type))prompt(p.message||p.text||p.content);
      else if(['agent_message','assistant_message'].includes(p.type))d.last_agent_preview=clean(p.message,320);
    }
  }
  d.session_id ||=hash(file);d.root_session_id ||=d.session_id;d.created_at ||=d.start_at;d.title=titles[d.session_id] || [d.agent_nickname,basename(d.agent_path)].filter(Boolean).join(' · ') || d.first_user_prompt || basename(d.cwd)||basename(file);
  d.project=basename(d.cwd)||'未归类';d.project_root=d.cwd;d.workspace_root=d.cwd;d.branch_total_token_usage=d.timeline.at(-1)?.total_token_usage||zero();d.reported_last_token_usage=d.timeline.at(-1)?.last_token_usage||zero();return d;
}

export function normalizedTimeline(d, parent) {
  const child=[...(d.timeline||[])].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  let prefix=0,baseline=zero(),resolved=true;
  if(d.is_subagent || d.forked_from_id) {
    const prior=(parent?.timeline||[]).filter(r=>!d.created_at||Date.parse(r.timestamp)<=Date.parse(d.created_at));
    const fp=r=>JSON.stringify([norm(r.total_token_usage),norm(r.last_token_usage)]);
    for(let j=0;j<prior.length;j++){let n=0;while(n<child.length && j+n<prior.length && fp(child[n])===fp(prior[j+n]))n++;prefix=Math.max(prefix,n);}
    if(prefix)baseline=norm(child[prefix-1].total_token_usage);
    else if(d.forked_from_id && child.length){
      const before=norm(prior.at(-1)?.total_token_usage),first=norm(child[0].total_token_usage),last=norm(child[0].last_token_usage);
      if(JSON.stringify(first)===JSON.stringify(last))baseline=zero();
      else if(parent && JSON.stringify(delta(first,before))===JSON.stringify(last))baseline=before;
      else if(parent && !before.total_tokens)baseline=zero();
      else resolved=false;
    }
  }
  let prev=baseline,total=zero(); const timeline=[];
  if(resolved) for(const r of child.slice(prefix)) {const next=norm(r.total_token_usage),use=delta(next,prev);prev=next;total=add(total,use);timeline.push({...r,total_token_usage:{...total},last_token_usage:use});}
  return {timeline,inherited_token_usage:baseline,inherited_token_event_count:prefix,fork_usage_resolved:resolved};
}

export function applyPricing(detail, prices) {
  const parts=Object.fromEntries(keys.filter(k=>k!=='total_tokens').map(k=>[k,0]));let known=detail.fork_usage_resolved!==false;const segments=new Map();
  for(const r of detail.timeline || []) {
    const u=norm(r.last_token_usage);if(!u.total_tokens)continue;
    const name=String(r.model||detail.model||'').toLowerCase().split('/').at(-1);
    const canonical=Object.keys(prices).sort((a,b)=>b.length-a.length).find(k=>name===k || name.startsWith(k+'-'));
    const p=canonical?prices[canonical]:null;
    if(!p){if(name==='codex-auto-review')continue;known=false;continue;}
    const long=u.input_tokens>272000; const rates={input:p.input*(long?2:1),cached_input:p.cachedInput*(long?2:1),cache_write_input:p.cacheWrite*(long?2:1),output:p.output*(long?1.5:1)};
    const cached=Math.min(u.cached_input_tokens,u.input_tokens),write=Math.min(u.cache_write_tokens,u.input_tokens-cached);
    parts.input_tokens+=(u.input_tokens-cached-write)*rates.input/1e6;parts.cached_input_tokens+=cached*rates.cached_input/1e6;parts.cache_write_tokens+=write*rates.cache_write_input/1e6;parts.output_tokens+=u.output_tokens*rates.output/1e6;parts.reasoning_output_tokens+=u.reasoning_output_tokens*rates.output/1e6;
    const key=canonical+long;const s=segments.get(key)||{model:canonical,effective_at:null,context_tier:long?'long':'short',prices:rates,usage:zero()};s.usage=add(s.usage,u);segments.set(key,s);
  }
  detail.price_model_known=known;detail.estimated_cost_usd=known?Number((parts.input_tokens+parts.cached_input_tokens+parts.cache_write_tokens+parts.output_tokens).toFixed(6)):null;
  detail.estimated_cost_breakdown_usd=known?parts:null;detail.applied_price_segments=[...segments.values()];return detail;
}

export function rangedDetail(raw, period, prices) {
  const d={...raw};let total=zero(); d.timeline=(raw.timeline||[]).filter(r=>r.timestamp>=period.start_at && r.timestamp<=period.end_at).map(r=>{total=add(total,norm(r.last_token_usage));return {...r,total_token_usage:{...total}};});
  d.tasks=(raw.tasks||[]).filter(r=>r.timestamp>=period.start_at && r.timestamp<=period.end_at);d.total_token_usage=total;d.last_token_usage=d.timeline.at(-1)?.last_token_usage||zero();
  if(period.key==='all' && !d.is_subagent && !d.forked_from_id && raw.reported_last_token_usage)d.last_token_usage=raw.reported_last_token_usage;
  if(period.key==='all' && !d.timeline.length && raw.is_remote)d.total_token_usage=norm(raw.total_token_usage);
  d.token_event_count=d.timeline.length;d.completed_turn_count=d.tasks.length;d.turn_count=d.tasks.length||d.timeline.length;
  d.duration_ms_total=d.tasks.reduce((n,t)=>n+(t.duration_ms||0),0);const tt=d.tasks.map(t=>t.time_to_first_token_ms).filter(Number.isFinite);d.time_to_first_token_ms_avg=tt.length?Math.round(tt.reduce((a,b)=>a+b,0)/tt.length):null;
  d.cached_input_percent=total.input_tokens?Math.round(total.cached_input_tokens/total.input_tokens*1000)/10:null;
  d.models=[...new Set(d.timeline.map(r=>r.model).filter(Boolean))];if(!d.models.length)d.models=raw.models||[raw.model];d.model=d.timeline.at(-1)?.model||raw.model;
  if(d.timeline.length){d.start_at=d.timeline[0].timestamp;d.end_at=d.timeline.at(-1).timestamp;d.latest_rate_limits=d.timeline.at(-1).rate_limits;d.model_context_window=d.timeline.at(-1).model_context_window;}
  if(d.is_remote && !d.timeline.length && period.key==='all')return d;
  return applyPricing(d,prices);
}

export class ParityEngine {
  constructor({home=process.env.CODEX_HOME||join(homedir(),'.codex'),dbPath=join(homedir(),'.codex','cousash-node-usage.sqlite'),remoteDir=join(configDir(),'remotes'),currentCode=deviceCode(),scanInterval=5000}={}) {
    this.home=home;this.remoteDir=remoteDir;this.code=currentCode;this.scanInterval=scanInterval;this.lastScan=0;this.inflight=null;this.snapshots=new Map();this.projectCache=new Map();this.indexStats={parsed:0,reused:0,files:0};
    mkdirSync(dirname(dbPath),{recursive:true});this.db=new DatabaseSync(dbPath);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS parity_files(path TEXT PRIMARY KEY,mtime REAL,size INTEGER,parser INTEGER,detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS parity_events(path TEXT,seq INTEGER,stamp TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(path,seq));
      CREATE INDEX IF NOT EXISTS parity_events_time ON parity_events(stamp,path);
      CREATE TABLE IF NOT EXISTS parity_remote(code TEXT PRIMARY KEY,payload TEXT NOT NULL,deleted INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS parity_imported(path TEXT PRIMARY KEY);
    `);
  }
  async files(dir) {const result=[];try{for(const e of await readdir(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isDirectory())result.push(...await this.files(f));else if(e.isFile()&&e.name.endsWith('.jsonl'))result.push(f);}}catch(e){if(e.code!=='ENOENT')throw e;}return result;}
  project(cwd) {
    if(this.projectCache.has(cwd))return this.projectCache.get(cwd);
    let p={project:basename(cwd)||'未归类',project_root:cwd,workspace_root:cwd,project_branch:'',is_git_worktree:false};
    try{const run=args=>execFileSync('git',['-C',cwd,'rev-parse',...args],{encoding:'utf8',timeout:1000,stdio:['ignore','pipe','ignore']}).trim();const root=run(['--show-toplevel']),common=resolve(cwd,run(['--git-common-dir']));p={project:basename(common.endsWith('.git')?dirname(common):root),project_root:common.endsWith('.git')?dirname(common):root,workspace_root:root,project_branch:run(['--abbrev-ref','HEAD']),is_git_worktree:resolve(common)!==resolve(root,'.git')};}catch{}
    this.projectCache.set(cwd,p);return p;
  }
  async refresh(force=false) {
    if(this.inflight)return this.inflight;if(!force && Date.now()-this.lastScan<this.scanInterval)return;
    this.inflight=this.index().finally(()=>{this.inflight=null;});return this.inflight;
  }
  async index() {
    let titles={};try{for(const l of (await readFile(join(this.home,'session_index.jsonl'),'utf8')).split('\n')){try{const x=JSON.parse(l);titles[x.id]=x.thread_name;}catch{}}}catch{}
    const homes=[...new Set([this.home,...(process.env.COUSASH_CODEX_HOMES||'').split(';').filter(Boolean)])];
    if(platform()==='linux'&&process.env.WSL_DISTRO_NAME){try{for(const e of await readdir('/mnt/c/Users')){const h=join('/mnt/c/Users',e,'.codex');if(existsSync(h))homes.push(h);}}catch{}}
    this.titles=titles;
    const versions=new Map(this.db.prepare('SELECT path,mtime,size,parser FROM parity_files').all().map(r=>[r.path,r]));let changed=0,reused=0,files=0;
    for(const home of homes) for(const file of [...await this.files(join(home,'sessions')),...await this.files(join(home,'archived_sessions'))]) {
      files++;const st=await stat(file),v=versions.get(file);if(v && v.mtime===st.mtimeMs && v.size===st.size && v.parser===PARSER){reused++;continue;}
      const d=await parseLog(file,file.includes('archived_sessions')?'archived':'active',home,titles);Object.assign(d,this.project(d.cwd));d.file_size=st.size;d.updated_at=st.mtime.toISOString();
      if(home!==this.home){d.environment_id=hash(home);d.environment=home.startsWith('/mnt/')?'Windows':basename(dirname(home));}
      this.db.prepare('INSERT OR REPLACE INTO parity_files VALUES (?,?,?,?,?)').run(file,st.mtimeMs,st.size,PARSER,JSON.stringify(d));changed++;
    }
    // 持久化数据保留；JSONL 被归档移动时按会话 ID 选择最新一份，不重复累计。
    const all=this.db.prepare('SELECT path,detail FROM parity_files').all().map(r=>{const {normalizedMeta,...raw}=JSON.parse(r.detail);return raw;});const byId=new Map();
    for(const d of all){const k=d.codex_home+':'+d.session_id;const old=byId.get(k);if(!old || Date.parse(d.updated_at)>=Date.parse(old.updated_at))byId.set(k,d);}
    const up=this.db.prepare('UPDATE parity_files SET detail=? WHERE path=?');
    const insert=this.db.prepare('INSERT INTO parity_events VALUES(?,?,?,?)');
    if(changed){this.db.exec('BEGIN IMMEDIATE');try{this.db.exec('DELETE FROM parity_events');for(const raw of byId.values()){
      const n=normalizedTimeline(raw,byId.get(raw.codex_home+':'+(raw.forked_from_id||raw.parent_thread_id)));const d={...raw,...n};
      const cutoff=n.inherited_token_event_count?raw.timeline[n.inherited_token_event_count-1]?.timestamp:null;
      const meta={...d,tasks:cutoff?(d.tasks||[]).filter(t=>t.timestamp>cutoff):d.tasks,timeline:undefined,rawTimeline:undefined}; // 详情保留在独立缓存列内，查询只取区间事件。
      up.run(JSON.stringify({...raw,normalizedMeta:meta}),raw.path);n.timeline.forEach((r,i)=>insert.run(raw.path,i,r.timestamp,JSON.stringify(r)));
    }this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
    this.indexStats={parsed:changed,reused,files,checkedAt:new Date().toISOString()};this.lastScan=Date.now();
    try{for(const e of await readdir(this.remoteDir)){if(!e.endsWith('.json'))continue;const path=join(this.remoteDir,e);if(this.db.prepare('SELECT 1 FROM parity_imported WHERE path=?').get(path))continue;const p=JSON.parse(await readFile(path,'utf8'));this.validate(p);this.db.prepare('INSERT OR IGNORE INTO parity_remote(code,payload) VALUES(?,?)').run(p.device.short_code,JSON.stringify(p));this.db.prepare('INSERT INTO parity_imported VALUES(?)').run(path);}}catch(e){if(e.code!=='ENOENT')this.remoteWarning=e.message;}
  }
  validate(p){if(p?.schema!==SCHEMA || p.version>1 || !/^[a-zA-Z0-9_-]+$/.test(p?.device?.short_code||'') || !Array.isArray(p?.snapshot?.sessions)||!p.snapshot.details_by_uid)throw Error('远程快照格式无效');}
  remotes(){return this.db.prepare('SELECT payload FROM parity_remote WHERE deleted=0').all().map(r=>JSON.parse(r.payload));}
  remoteMetadata(p){return {device_short_code:p.device.short_code,label:p.device.label||p.device.short_code,platform:p.device.platform||'',hostname:p.device.hostname||'',session_count:p.snapshot.sessions.length,usage:p.snapshot.summary?.usage||zero(),imported_at:p.imported_at||'',exported_at:p.exported_at||'',generated_at:p.snapshot.generated_at||''};}
  importRemote(p,{label,allow_current_device=false}={}) {
    this.validate(p);const code=p.device.short_code;const oldRow=this.db.prepare('SELECT payload FROM parity_remote WHERE code=? AND deleted=0').get(code);const old=oldRow?JSON.parse(oldRow.payload):null;
    if(code===this.code&&!allow_current_device)return {ok:false,needs_confirmation:true,reason:'current_device',suggested_label:p.device.label||code};
    if(!old&&!label)return {ok:false,needs_label:true,suggested_label:p.device.label||code,device_short_code:code};
    const sessions=new Map(),details={...(old?.snapshot.details_by_uid||{})};for(const s of [...(old?.snapshot.sessions||[]),...p.snapshot.sessions])sessions.set((s.environment_id||'')+':'+(s.session_id||s.uid),s);Object.assign(details,p.snapshot.details_by_uid);
    const stored={...p,imported_at:new Date().toISOString(),device:{...p.device,label:clean(label||old?.device.label||p.device.label||code,120)},snapshot:{...p.snapshot,sessions:[...sessions.values()],details_by_uid:details}};
    this.db.prepare('INSERT OR REPLACE INTO parity_remote VALUES(?,?,0)').run(code,JSON.stringify(stored));return {ok:true,created:!old,remote:this.remoteMetadata(stored)};
  }
  renameRemote(code,label){const r=this.db.prepare('SELECT payload FROM parity_remote WHERE code=? AND deleted=0').get(code);if(!r)throw Error('未找到远程设备');const p=JSON.parse(r.payload);p.device.label=clean(label,120)||code;this.db.prepare('UPDATE parity_remote SET payload=? WHERE code=?').run(JSON.stringify(p),code);return {ok:true,remote:this.remoteMetadata(p)};}
  deleteRemote(code,confirm){if(confirm!==true)throw Error('删除需要确认');this.db.prepare('UPDATE parity_remote SET deleted=1 WHERE code=?').run(code);return {ok:true};}
  snapshot(q,prices,{localOnly=false}={}) {
    const period=periodBounds(q),timelineByPath=new Map();
    for(const r of this.db.prepare('SELECT path,data FROM parity_events WHERE stamp>=? AND stamp<=? ORDER BY stamp,seq').all(period.start_at,period.end_at)){const list=timelineByPath.get(r.path)||[];list.push(JSON.parse(r.data));timelineByPath.set(r.path,list);}
    const details=[];for(const [path,timeline] of timelineByPath){const raw=JSON.parse(this.db.prepare('SELECT detail FROM parity_files WHERE path=?').get(path).detail);details.push(rangedDetail({...raw,...raw.normalizedMeta,title:this.titles?.[raw.session_id]||raw.title,timeline},period,prices));}
    if(period.key==='all'){
      const known=new Set(details.map(d=>d.codex_home+':'+d.session_id));
      for(const r of this.db.prepare('SELECT detail FROM parity_files ORDER BY mtime DESC').all()){const d=JSON.parse(r.detail),k=d.codex_home+':'+d.session_id;if(!known.has(k)){known.add(k);details.push(rangedDetail({...d,...d.normalizedMeta,title:this.titles?.[d.session_id]||d.title,timeline:[]},period,prices));}}
    }
    if(!localOnly)for(const p of this.remotes())for(const s of p.snapshot.sessions){const raw={...s,...p.snapshot.details_by_uid[s.uid]};let total=zero(),prev=zero();const timeline=(raw.timeline||[]).map(r=>{const use=delta(norm(r.total_token_usage),prev);prev=norm(r.total_token_usage);total=add(total,use);return {...r,timestamp:iso(r.timestamp),last_token_usage:use,total_token_usage:{...total}};}).filter(r=>r.timestamp);
      const code=p.device.short_code;const d=rangedDetail({...raw,timeline,uid:hash(code+':'+raw.uid),environment_id:'remote-'+code,environment:p.device.label||code,is_remote:true,remote_device_short_code:code,remote_imported_at:p.imported_at,remote_exported_at:p.exported_at},period,prices);
      if(d.token_event_count||d.total_token_usage.total_tokens||period.key==='all')details.push(d);
    }
    details.sort((a,b)=>b.total_token_usage.total_tokens-a.total_token_usage.total_tokens);const summary=zero();for(const d of details)Object.assign(summary,add(summary,d.total_token_usage));
    const daily=new Map();for(const d of details)for(const r of d.timeline){const t=new Date(r.timestamp),day=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;daily.set(day,add(daily.get(day),r.last_token_usage));}
    const sources=new Map(details.map(d=>[d.environment_id,{id:d.environment_id,label:d.environment,codex_home:d.codex_home,is_remote:d.is_remote}]));
    const token=randomUUID();const snap={snapshot_token:token,generated_at:new Date().toISOString(),period,codex_home:this.home,codex_sources:[...sources.values()],sessions:details.map(({timeline,tasks,tool_counts,first_user_prompt,last_agent_preview,normalizedMeta,turn_ids,...s})=>s),details_by_uid:Object.fromEntries(details.map(d=>[d.uid,d])),summary:{usage:summary,session_count:details.length,active_count:details.filter(d=>d.source==='active').length,archived_count:details.filter(d=>d.source==='archived').length,estimated_cost_usd:details.reduce((a,d)=>a+(d.estimated_cost_usd||0),0)},daily_usage:[...daily].map(([date,usage])=>({date,usage})).sort((a,b)=>a.date.localeCompare(b.date)),daily_usage_complete:period.key==='all',current_device_short_code:this.code,remotes:this.remotes().map(p=>this.remoteMetadata(p)),index:this.indexStats};
    this.snapshots.set(token,snap);while(this.snapshots.size>24)this.snapshots.delete(this.snapshots.keys().next().value);return snap;
  }
  dailyUsage(filters,prices) {
    const snapshot=this.snapshot(new URLSearchParams({period:'all'}),prices);
    const needle=(filters.get('search')||'').trim().toLowerCase();
    const days=new Map();
    for(const d of Object.values(snapshot.details_by_uid)) {
      if(filters.get('environment') && filters.get('environment')!=='all' && d.environment_id!==filters.get('environment'))continue;
      if(filters.get('source') && filters.get('source')!=='all' && d.source!==filters.get('source'))continue;
      if(filters.get('model') && filters.get('model')!=='all' && !(d.models||[d.model]).includes(filters.get('model')))continue;
      if(needle && ![d.title,d.session_id,...(d.models||[]),d.project,d.project_root,d.workspace_root,d.project_branch,d.cwd,d.path,d.source,d.environment].join(' ').toLowerCase().includes(needle))continue;
      for(const r of d.timeline||[]) {
        const t=new Date(r.timestamp),key=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
        days.set(key,add(days.get(key),r.last_token_usage));
      }
    }
    return {generated_at:snapshot.generated_at,daily_usage:[...days].map(([date,usage])=>({date,usage})).sort((a,b)=>a.date.localeCompare(b.date)),daily_usage_complete:true,today:snapshot.period.end_date,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  }
  exportSnapshot(prices){const snapshot=this.snapshot(new URLSearchParams({period:'all'}),prices,{localOnly:true});return {schema:SCHEMA,version:1,exported_at:snapshot.generated_at,device:{short_code:this.code,label:hostname(),platform:platform(),hostname:hostname()},snapshot};}
  close(){this.db.close();}
}
