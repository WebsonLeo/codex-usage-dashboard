import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { UsageStore, filterEventsByRange, formatHtml, parseOfficialPriceTable } from '../scripts/codex_usage_dashboard.mjs';

test('解析官方标准价格表中的模型费率', () => {
  const markdown = `
## Standard

| Model | Input | Output | Cached input | 30m write |
| --- | --- | --- | --- | --- |
| gpt-6.1-sol | $2.00 | $10.00 | $0.10 | $2.50 |
| gpt-6-luna | $0.10 | $0.50 | $0.01 | $0.125 |
`;

  const prices = parseOfficialPriceTable(markdown);

  assert.deepEqual(prices['gpt-6.1-sol'], {
    input: 2,
    output: 10,
    cachedInput: 0.1,
    cacheWrite: 2.5,
  });
  assert.equal(prices['gpt-6-luna'].output, 0.5);
});

test('按最近一小时过滤 token 事件', () => {
  const now = new Date('2026-11-08T18:00:00.000Z');
  const events = [
    { timestamp: '2026-11-08T16:59:59.000Z', usage: { total_tokens: 1 } },
    { timestamp: '2026-11-08T17:00:00.000Z', usage: { total_tokens: 2 } },
    { timestamp: '2026-11-08T17:59:59.000Z', usage: { total_tokens: 3 } },
  ];

  const filtered = filterEventsByRange(events, { kind: 'relative', minutes: 60 }, now);

  assert.deepEqual(filtered.map(event => event.usage.total_tokens), [2, 3]);
});

test('仪表盘输出的浏览器脚本可以解析', () => {
  const script = formatHtml().match(/<script>([\s\S]*)<\/script>/)?.[1];

  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('SQLite 增量索引按时间区间读取 token 事件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cousash-node-test-'));
  const databasePath = join(directory, 'usage.sqlite');
  const store = new UsageStore(databasePath);
  try {
    store.replaceSession('/tmp/session.jsonl', { id: 'session-1', title: '测试会话', project: 'demo', source: 'active' }, [
      { timestamp: '2026-11-09T10:00:00.000Z', model: 'gpt-6.1-sol', usage: { total_tokens: 10 } },
      { timestamp: '2026-11-09T11:00:00.000Z', model: 'gpt-6.1-sol', usage: { total_tokens: 20 } },
    ], { mtimeMs: 1, size: 2 });

    const records = store.eventsBetween('2026-11-09T10:30:00.000Z', '2026-11-09T11:30:00.000Z');

    assert.equal(records.length, 1);
    assert.equal(records[0].usage.total_tokens, 20);
    assert.equal(records[0].title, '测试会话');
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
