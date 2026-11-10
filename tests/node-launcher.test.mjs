import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launchDashboard, probeDashboard, browserCommand } from '../scripts/open_dashboard_node.mjs';

async function server(t, body) {
  const instance=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));});
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>instance.close(resolve)));
  return instance.address().port;
}

test('重复启动复用健康的仪表盘服务',async t=>{
  const port=await server(t,{ok:true,app:'codex-usage-dashboard-node'});
  const result=await launchDashboard({port,open:false});
  assert.equal(result.reused,true);assert.equal(result.opened,false);
  assert.equal(result.url,`http://127.0.0.1:${port}/`);
});

test('端口被其他服务占用时拒绝启动且原服务仍可访问',async t=>{
  const port=await server(t,{ok:true,app:'another-app'});
  await assert.rejects(launchDashboard({port,open:false}),/其他服务占用/);
  assert.equal(await probeDashboard(`http://127.0.0.1:${port}/`),'occupied');
});

test('非法端口在发起启动前被拒绝',async()=>{
  await assert.rejects(launchDashboard({port:NaN,open:false}),/端口必须/);
  await assert.rejects(launchDashboard({port:70000,open:false}),/端口必须/);
});

test('打开浏览器时直接传递网址参数而不经 shell 拼接',()=>{
  const url='http://127.0.0.1:8766/';
  assert.deepEqual(browserCommand(url,'darwin'),['/usr/bin/open',[url]]);
  assert.deepEqual(browserCommand(url,'win32'),['rundll32.exe',['url.dll,FileProtocolHandler',url]]);
  assert.deepEqual(browserCommand(url,'linux'),['xdg-open',[url]]);
});
