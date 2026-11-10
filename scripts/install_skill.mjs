#!/usr/bin/env node
/** 将独立运行所需的资源安装为本地 Codex skill，保留已有安装。 */
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const files = [
  'SKILL.md', 'agents/openai.yaml', 'THIRD_PARTY_NOTICES.md', 'licenses/Chart.js-LICENSE.md',
  'assets/dashboard.html', 'assets/dashboard-redesign.css', 'assets/chart.umd.min.js',
  'assets/codex_usage_dashboard.ico',
  'scripts/chart-data.mjs', 'scripts/dashboard-analytics.mjs', 'scripts/dashboard-engine.mjs',
  'scripts/dashboard-page.mjs', 'scripts/codex_usage_dashboard.mjs', 'scripts/open_dashboard_node.mjs',
];

export function defaultDestination(home = homedir()) {
  return join(home, '.agents', 'skills', 'codex-usage-dashboard');
}

export async function installSkill(destination = defaultDestination()) {
  const target = resolve(destination);
  await mkdir(dirname(target), { recursive: true });
  // 单独创建目标目录；已存在时直接退出，包含符号链接和其他类型的文件。
  try { await mkdir(target); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error(`目标已存在，未覆盖：${target}。请先备份并移走旧版本，或使用 --dest 指定新目录。`);
    throw error;
  }
  try {
    for (const file of files) {
      const output = join(target, file);
      await mkdir(dirname(output), { recursive: true });
      await copyFile(join(sourceRoot, file), output);
    }
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('用法：node scripts/install_skill.mjs [--dest /完整/技能目录]');
    console.log(`默认位置：${defaultDestination()}`);
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--dest' || !args[1] || args[1].startsWith('--'))) {
    throw Error('参数无效。用法：node scripts/install_skill.mjs [--dest /完整/技能目录]');
  }
  const target = await installSkill(args[1]);
  console.log(`已安装 Codex skill：${target}`);
  console.log('在 Codex 中使用 $codex-usage-dashboard 打开仪表盘；若技能尚未出现，请重新启动 Codex。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
