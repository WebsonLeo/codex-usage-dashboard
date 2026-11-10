import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { defaultDestination, installSkill } from '../scripts/install_skill.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-skill-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('CLI 安装后的独立技能可提供健康接口、网页和静态资源', async t => {
  const root = await fixture(t), target = join(root, 'skill');
  execFileSync(process.execPath, ['scripts/install_skill.mjs', '--dest', target]);
  assert.ok((await readFile(join(target, 'SKILL.md'), 'utf8')).includes('codex-usage-dashboard'));
  assert.deepEqual((await readdir(target)).sort(), ['SKILL.md', 'THIRD_PARTY_NOTICES.md', 'agents', 'assets', 'licenses', 'scripts']);
  const { createDashboardServer } = await import(pathToFileURL(join(target, 'scripts/codex_usage_dashboard.mjs')));
  const home = join(root, 'logs');
  await mkdir(home);
  const server = await createDashboardServer({ home, dbPath: join(root, 'usage.sqlite'), remoteDir: join(root, 'remotes'), currentCode: 'install-test', prices: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
  assert.ok((await (await fetch(base)).text()).includes('lastScanTime'));
  for (const file of ['dashboard-redesign.css', 'chart.umd.min.js']) {
    const response = await fetch(base + '/assets/' + file);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await readFile(join(target, 'assets', file), 'utf8'));
  }
  assert.equal((await (await fetch(base + '/api/sessions?period=all')).json()).summary.session_count, 0);
});

test('已有技能安装失败且原有文件完整保留', async t => {
  const root = await fixture(t), target = join(root, 'skill');
  await mkdir(target);
  await writeFile(join(target, 'keep.txt'), '用户现有内容');
  await assert.rejects(installSkill(target), /目标已存在/);
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), '用户现有内容');
  assert.deepEqual(await readdir(target), ['keep.txt']);
});

test('默认安装到用户技能目录，非法参数不触发安装', () => {
  assert.equal(defaultDestination('/example'), join('/example', '.agents', 'skills', 'codex-usage-dashboard'));
  const result = spawnSync(process.execPath, ['scripts/install_skill.mjs', '--dest'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /参数无效/);
});
