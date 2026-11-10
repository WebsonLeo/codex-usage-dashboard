#!/usr/bin/env node
/** 本地 Codex 用量仪表盘（Node 版，无第三方依赖）。 */

import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ParityEngine } from './dashboard-engine.mjs';
import { renderDashboard } from './dashboard-page.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.COUSASH_NODE_PORT || 8766);
const PRICE_URL = 'https://developers.openai.com/api/docs/pricing.md';
const MODELS_URL = 'https://developers.openai.com/api/docs/models.md';
const CACHE_PATH = join(homedir(), '.codex', 'cousash-node-price-cache.json');
const USAGE_DB_PATH = join(homedir(), '.codex', 'cousash-node-usage.sqlite');
const USAGE_KEYS = ['input_tokens', 'cached_input_tokens', 'cache_write_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const RELATIVE_RANGES = { '30m': 30, '1h': 60, '3h': 180, '5h': 300, '10h': 600 };

function zeroUsage() {
  return Object.fromEntries(USAGE_KEYS.map(key => [key, 0]));
}

function normalizeUsage(value) {
  const usage = zeroUsage();
  if (!value || typeof value !== 'object') return usage;
  for (const key of USAGE_KEYS) {
    if (Number.isFinite(value[key])) usage[key] = Math.max(0, Number(value[key]));
  }
  return usage;
}

function addUsage(left, right) {
  const total = zeroUsage();
  for (const key of USAGE_KEYS) total[key] = (left?.[key] || 0) + (right?.[key] || 0);
  return total;
}

function subtractUsage(total, previous) {
  const delta = zeroUsage();
  for (const key of USAGE_KEYS) delta[key] = Math.max(0, (total?.[key] || 0) - (previous?.[key] || 0));
  return delta;
}

function modelFrom(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(payload.model || payload.model_name || payload.model_id || payload.thread_settings?.model || '').trim();
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => typeof item === 'string' ? item : String(item?.text || item?.content || '')).join(' ').trim();
}

function cleanText(value, length = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function parseMoney(value) {
  const match = String(value || '').replaceAll(',', '').match(/\$?([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}

/** 从官方 pricing.md 的标准费率表读取每百万 tokens 价格。 */
export function parseOfficialPriceTable(markdown) {
  const prices = {};
  const lines = String(markdown || '').split(/\r?\n/);
  let headers = null;
  for (const line of lines) {
    if (!line.includes('|')) {
      headers = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (!cells.length || cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
    const lowered = cells.map(cell => cell.toLowerCase());
    if (lowered.includes('model') && lowered.some(cell => cell.includes('input')) && lowered.some(cell => cell.includes('output'))) {
      headers = lowered;
      continue;
    }
    if (!headers) continue;
    const model = cells.join(' ').match(/\b(gpt-[a-z0-9.-]+)\b/i)?.[1]?.toLowerCase();
    if (!model || prices[model]) continue;
    const indexFor = terms => headers.findIndex(header => terms.some(term => header.includes(term)));
    const inputIndex = indexFor(['input']);
    const outputIndex = indexFor(['output']);
    const cachedIndex = indexFor(['cached input', 'cached']);
    const writeIndex = indexFor(['30m write', 'cache write', 'write']);
    const input = parseMoney(cells[inputIndex]);
    const output = parseMoney(cells[outputIndex]);
    const cachedInput = parseMoney(cells[cachedIndex]);
    const cacheWrite = parseMoney(cells[writeIndex]);
    if (input === null || output === null || cachedInput === null) continue;
    prices[model] = { input, output, cachedInput, cacheWrite: cacheWrite ?? input };
  }
  return prices;
}

export function parseOfficialModels(markdown) {
  return [...new Set([...String(markdown || '').matchAll(/`(gpt-[a-z0-9.-]+)`/gi)].map(match => match[1].toLowerCase()))].sort();
}

export function filterEventsByRange(events, range, now = new Date()) {
  let start = null;
  let end = now;
  if (range.kind === 'relative') start = new Date(now.getTime() - range.minutes * 60_000);
  if (range.kind === 'custom') {
    start = new Date(range.from);
    end = new Date(range.to);
  }
  return events.filter(event => {
    const time = new Date(event.timestamp);
    return !Number.isNaN(time.valueOf()) && (!start || time >= start) && time <= end;
  });
}

function rangeFromQuery(query) {
  const range = query.get('range') || 'today';
  if (RELATIVE_RANGES[range]) return { kind: 'relative', key: range, minutes: RELATIVE_RANGES[range], label: range };
  if (range === 'custom' && query.get('from') && query.get('to')) return { kind: 'custom', key: range, from: query.get('from'), to: query.get('to'), label: '自定义' };
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return { kind: 'custom', key: 'today', from: midnight.toISOString(), to: now.toISOString(), label: '今日' };
}

async function walkJsonl(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walkJsonl(candidate));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(candidate);
  }
  return found;
}

async function parseSession(file, source) {
  const events = [];
  const models = new Set();
  let currentModel = 'unknown';
  let previousTotal = zeroUsage();
  let sessionId = '';
  let title = '';
  let project = '';
  let firstPrompt = '';
  let startAt = '';
  let endAt = '';
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const timestamp = item.timestamp;
    if (timestamp && (!startAt || timestamp < startAt)) startAt = timestamp;
    if (timestamp && (!endAt || timestamp > endAt)) endAt = timestamp;
    const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
    const noteModel = value => {
      if (!value) return;
      currentModel = String(value);
      models.add(currentModel);
    };
    if (item.type === 'session_meta') {
      sessionId = String(payload.id || payload.session_id || sessionId);
      title = String(payload.thread_name || title);
      project = String(payload.cwd || project);
      noteModel(modelFrom(payload));
    } else if (item.type === 'turn_context') {
      project = String(payload.cwd || project);
      noteModel(modelFrom(payload));
    } else if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'user' && !firstPrompt) {
      firstPrompt = cleanText(textFromContent(payload.content));
    } else if (item.type === 'event_msg' && payload.type === 'thread_settings_applied') {
      project = String(payload.cwd || payload.thread_settings?.cwd || project);
      noteModel(modelFrom(payload));
    } else if (item.type === 'event_msg' && payload.type === 'token_count' && payload.info) {
      const info = payload.info;
      const total = normalizeUsage(info.total_token_usage);
      let delta = normalizeUsage(info.last_token_usage);
      if (!delta.total_tokens) delta = subtractUsage(total, previousTotal);
      previousTotal = total;
      const model = modelFrom(info) || modelFrom(payload) || currentModel;
      noteModel(model);
      if (delta.total_tokens > 0 && timestamp) events.push({ timestamp, model, usage: delta });
    }
  }
  if (!events.length) return null;
  const meta = await stat(file);
  return {
    id: sessionId || relative(join(homedir(), '.codex'), file),
    title: cleanText(title || firstPrompt || project || file.split('/').pop()),
    project: cleanText(project.split('/').filter(Boolean).at(-1) || '未归类'),
    source,
    models: [...models],
    startAt: startAt || meta.mtime.toISOString(),
    endAt: endAt || meta.mtime.toISOString(),
    events,
  };
}

/** 保存派生的会话索引；绝不改写 Codex 原始 JSONL。 */
export class UsageStore {
  constructor(path = USAGE_DB_PATH) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS session_files (
        path TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        project TEXT NOT NULL,
        source TEXT NOT NULL,
        mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS token_events (
        path TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens REAL NOT NULL,
        cached_input_tokens REAL NOT NULL,
        cache_write_tokens REAL NOT NULL,
        output_tokens REAL NOT NULL,
        reasoning_output_tokens REAL NOT NULL,
        total_tokens REAL NOT NULL,
        PRIMARY KEY (path, sequence)
      );
      CREATE INDEX IF NOT EXISTS token_events_timestamp ON token_events(timestamp);
    `);
  }

  fileVersion(path) {
    return this.database.prepare('SELECT mtime_ms, size FROM session_files WHERE path = ?').get(path);
  }

  replaceSession(path, session, events, version) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM token_events WHERE path = ?').run(path);
      this.database.prepare(`INSERT INTO session_files (path, session_id, title, project, source, mtime_ms, size, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET session_id=excluded.session_id, title=excluded.title, project=excluded.project,
        source=excluded.source, mtime_ms=excluded.mtime_ms, size=excluded.size, indexed_at=excluded.indexed_at`).run(
        path, session.id, session.title, session.project, session.source, version.mtimeMs, version.size, new Date().toISOString(),
      );
      const insert = this.database.prepare(`INSERT INTO token_events
        (path, sequence, timestamp, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_output_tokens, total_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      events.forEach((event, sequence) => {
        const usage = normalizeUsage(event.usage);
        insert.run(
          path, sequence, event.timestamp, event.model || 'unknown', usage.input_tokens, usage.cached_input_tokens,
          usage.cache_write_tokens, usage.output_tokens, usage.reasoning_output_tokens, usage.total_tokens,
        );
      });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  removeMissing(paths) {
    const keep = new Set(paths);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const { path } of this.database.prepare('SELECT path FROM session_files').all()) {
        if (!keep.has(path)) {
          this.database.prepare('DELETE FROM token_events WHERE path = ?').run(path);
          this.database.prepare('DELETE FROM session_files WHERE path = ?').run(path);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  eventsBetween(startAt, endAt) {
    const rows = this.database.prepare(`SELECT f.path, f.session_id, f.title, f.project, f.source,
      e.timestamp, e.model, e.input_tokens, e.cached_input_tokens, e.cache_write_tokens, e.output_tokens,
      e.reasoning_output_tokens, e.total_tokens
      FROM token_events e JOIN session_files f ON f.path = e.path
      WHERE e.timestamp >= ? AND e.timestamp <= ? ORDER BY e.timestamp`).all(startAt, endAt);
    return rows.map(row => ({
      key: row.path,
      id: row.session_id,
      title: row.title,
      project: row.project,
      source: row.source,
      timestamp: row.timestamp,
      model: row.model,
      usage: normalizeUsage(row),
    }));
  }

  close() { this.database.close(); }
}

class PriceCatalog {
  constructor() { this.data = { prices: {}, models: [], updatedAt: '', source: '未同步', error: '' }; }
  async loadCache() {
    try { this.data = { ...this.data, ...JSON.parse(await readFile(CACHE_PATH, 'utf8')), source: '本地缓存' }; } catch { /* 首次使用没有缓存。 */ }
  }
  async refresh() {
    try {
      const [pricingResponse, modelsResponse] = await Promise.all([fetch(PRICE_URL, { signal: AbortSignal.timeout(15000) }), fetch(MODELS_URL, { signal: AbortSignal.timeout(15000) })]);
      if (!pricingResponse.ok || !modelsResponse.ok) throw new Error(`官方页面响应 ${pricingResponse.status}/${modelsResponse.status}`);
      const [pricingMarkdown, modelsMarkdown] = await Promise.all([pricingResponse.text(), modelsResponse.text()]);
      const prices = parseOfficialPriceTable(pricingMarkdown);
      if (!Object.keys(prices).length) throw new Error('未能从官方价格页解析模型费率');
      this.data = {
        prices,
        models: parseOfficialModels(modelsMarkdown),
        updatedAt: new Date().toISOString(),
        source: 'OpenAI 官方页面',
        error: '',
      };
      await mkdir(dirname(CACHE_PATH), { recursive: true });
      await writeFile(CACHE_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      this.data.error = error instanceof Error ? error.message : String(error);
    }
    return this.data;
  }
}

function estimateCost(usage, model, prices) {
  const price = prices[model?.toLowerCase()];
  if (!price) return null;
  const input = Math.max(0, usage.input_tokens || 0);
  const cached = Math.min(input, Math.max(0, usage.cached_input_tokens || 0));
  const cacheWrite = Math.min(input - cached, Math.max(0, usage.cache_write_tokens || 0));
  const uncached = input - cached - cacheWrite;
  return (uncached * price.input + cached * price.cachedInput + cacheWrite * price.cacheWrite + (usage.output_tokens || 0) * price.output) / 1_000_000;
}

function rangeBounds(range, now = new Date()) {
  if (range.kind === 'relative') return [new Date(now.getTime() - range.minutes * 60_000), now];
  return [new Date(range.from), new Date(range.to)];
}

export function formatHtml() { return renderDashboard(); }

export async function createDashboardServer(options={}) {
  const state = new ParityEngine(options);
  const catalog = new PriceCatalog();
  await catalog.loadCache();
  // 网络同步不阻塞已缓存数据展示。
  if (options.prices) catalog.data.prices=options.prices;
  else void catalog.refresh();
  const send=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
  const body=async req=>{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw Error('快照超过64MB');chunks.push(chunk);}return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};};
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url||'/',`http://${HOST}`);
      const assets={'/assets/dashboard-redesign.css':['dashboard-redesign.css','text/css'],'/assets/chart.umd.min.js':['chart.umd.min.js','text/javascript']};
      if(assets[url.pathname]){const [file,type]=assets[url.pathname];response.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-cache'});response.end(await readFile(new URL('../assets/'+file,import.meta.url)));return;}
      if(url.pathname==='/'){response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(formatHtml());return;}
      if(url.pathname==='/api/health'){send(response,{ok:true,app:'codex-usage-dashboard-node',features:['original-ui-parity-v1','sqlite-index','time-ranges','official-prices']});return;}
      if(request.method==='POST'){
        const origin=request.headers.origin;
        if(origin && new URL(origin).host!==request.headers.host){send(response,{error:'不接受跨站写入'},403);return;}
        if(url.pathname==='/api/pricing/refresh'){send(response,await catalog.refresh());return;}
        const p=await body(request);let result;
        if(url.pathname==='/api/remotes/import')result=state.importRemote(p.snapshot,p);
        else if(url.pathname==='/api/remotes/rename')result=state.renameRemote(p.device_short_code,p.label);
        else if(url.pathname==='/api/remotes/delete')result=state.deleteRemote(p.device_short_code,p.confirm);
        else {send(response,{error:'未找到接口'},404);return;}
        send(response,result,result.ok?200:409);return;
      }
      if(url.pathname==='/api/remotes'){send(response,{current_device_short_code:state.code,remotes:state.remotes().map(p=>state.remoteMetadata(p))});return;}
      if(url.pathname==='/api/session' && url.searchParams.get('snapshot_token')){
        const snap=state.snapshots.get(url.searchParams.get('snapshot_token'));
        if(!snap){send(response,{error:'快照已过期',code:'snapshot_stale'},409);return;}
        const detail=snap.details_by_uid[url.searchParams.get('id')];send(response,detail||{error:'未找到会话'},detail?200:404);return;
      }
      await state.refresh();
      if(url.pathname==='/api/export.json'){response.setHeader('Content-Disposition',`attachment; filename="cousash-${state.code}.json"`);send(response,state.exportSnapshot(catalog.data.prices));return;}
      if(url.pathname==='/api/daily-usage'){send(response,state.dailyUsage(url.searchParams,catalog.data.prices));return;}
      if(['/api/sessions','/api/session','/api/usage'].includes(url.pathname)){
        const s=state.snapshot(url.searchParams,catalog.data.prices);
        if(url.pathname==='/api/session'){const d=s.details_by_uid[url.searchParams.get('id')];send(response,d||{error:'未找到会话'},d?200:404);return;}
        const {details_by_uid,...payload}=s;
        send(response,{...payload,pricing:catalog.data,usage:s.summary.usage,generatedAt:s.generated_at});return;
      }
      send(response,{error:'未找到接口'},404);
    }catch(error){send(response,{error:error.message},400);}
  });
  server.engine=state;server.on('close',()=>state.close());return server;
}

async function main() {
  const server = await createDashboardServer();
  server.listen(PORT, HOST, () => console.log(`Codex 用量仪表盘：http://${HOST}:${PORT}/`));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error => { console.error(error); process.exitCode = 1; });
