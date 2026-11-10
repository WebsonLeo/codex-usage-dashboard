#!/usr/bin/env node
/** 启动或复用本地仪表盘，默认在浏览器中打开。 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';

const script = join(dirname(fileURLToPath(import.meta.url)), 'codex_usage_dashboard.mjs');
const logPath = join(tmpdir(), 'codex-usage-dashboard-node.log');

export async function probeDashboard(url) {
  let response;
  try { response = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(800) }); }
  catch { return 'offline'; }
  try {
    const data = await response.json();
    return response.ok && data.ok === true && data.app === 'codex-usage-dashboard-node' ? 'ready' : 'occupied';
  } catch { return 'occupied'; }
}

export function browserCommand(url, system = process.platform) {
  if (system === 'darwin') return ['/usr/bin/open', [url]];
  if (system === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

async function openBrowser(url) {
  const [command, args] = browserCommand(url);
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio:'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
}

export async function launchDashboard({ port = Number(process.env.COUSASH_NODE_PORT || 8766), open = true } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw Error('需要 Node.js 22.13 或更新版本，请先使用兼容的 Node 解释器。');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('端口必须是 1 到 65535 的整数。');
  const url = `http://127.0.0.1:${port}/`;
  let status = await probeDashboard(url);
  if (status === 'occupied') throw Error(`端口 ${port} 已被其他服务占用，未停止该服务。`);
  const reused = status === 'ready';
  if (!reused) {
    const log = openSync(logPath, 'a');
    let failure;
    const child = spawn(process.execPath, [script], {
      detached:true, stdio:['ignore', log, log], env:{...process.env, COUSASH_NODE_PORT:String(port)},
    });
    child.once('error', error => { failure = error; });
    child.once('exit', code => { failure ||= Error(`服务进程已退出（${code}）`); });
    closeSync(log); child.unref();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (failure) throw Error(`${failure.message}；启动日志：${logPath}`);
      status = await probeDashboard(url);
      if (status === 'ready') break;
      if (status === 'occupied') throw Error(`端口 ${port} 已被其他服务占用。`);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (status !== 'ready') throw Error(`仪表盘未在 30 秒内就绪；启动日志：${logPath}`);
  }
  return { url, reused, opened:open ? await openBrowser(url) : false };
}

async function main() {
  const result = await launchDashboard({ open:!process.argv.includes('--no-open') });
  console.log(`${result.reused ? '已复用运行中的仪表盘' : '仪表盘已启动'}：${result.url}`);
  if (!process.argv.includes('--no-open') && !result.opened) console.log('浏览器未自动打开，请点击上方地址。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
