import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDaySeries, calendarCells, heatmapWeeks } from '../scripts/chart-data.mjs';
import { ParityEngine, zero } from '../scripts/dashboard-engine.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('趋势补齐自然日空缺且不把缓存输入重复计入总量',()=>{
 const rows=[{date:'2026-11-01',usage:{total_tokens:120,input_tokens:100,cached_input_tokens:80,output_tokens:20}},{date:'2026-11-03',usage:{total_tokens:200}}];
 const series=buildDaySeries(rows,'2026-11-03',3);
 assert.deepEqual(series.map(x=>x.date),['2026-11-01','2026-11-02','2026-11-03']);
 assert.deepEqual(series.map(x=>x.usage.total_tokens),[120,0,200]);assert.equal(series[1].recorded,false);
});
test('月历按周一对齐，区分未来日期与零记录',()=>{
 const cells=calendarCells([{date:'2026-11-01',usage:{total_tokens:10}},{date:'2026-11-08',usage:{total_tokens:100}}],'2026-11','2026-11-08');
 assert.equal(cells[5].empty,true);assert.equal(cells[6].day,1);assert.equal(cells[6].level,1);
 assert.equal(cells.find(c=>c.day===8).level,4);assert.equal(cells.find(c=>c.day===8).future,false);assert.equal(cells.find(c=>c.day===9).future,true);assert.equal(cells.filter(c=>!c.empty).length,30);
});
test('闰年二月热力图保留29日，空数据仍生成可用月历',()=>{
 assert.equal(calendarCells([],'2028-02','2028-02-29').filter(c=>!c.empty).length,29);
 assert.ok(calendarCells([],'2026-02','2026-02-28').filter(c=>!c.empty).every(c=>c.level===0));
});
test('紧凑热力图按16列周次排列且保留真实日期和未来状态',()=>{
 const cells=heatmapWeeks([{date:'2026-11-09',usage:{total_tokens:42}}],'2026-11-09','2026-11-09');
 assert.equal(cells.length,112);assert.equal(new Date(cells[0].date+'T12:00:00').getDay(),1);
 assert.equal(cells[0].weekday,0);assert.equal(cells[6].weekday,6);assert.equal(cells[7].week,1);
 assert.equal(cells.find(c=>c.date==='2026-11-09').tokens,42);assert.equal(cells.find(c=>c.date==='2026-11-09').level,4);
 assert.equal(cells.find(c=>c.date==='2026-11-10').future,true);assert.equal(cells.at(-1).date,'2026-11-15');
});
test('每日图表聚合遵循模型、环境、状态和搜索筛选',async t=>{
 const root=await mkdtemp(join(tmpdir(),'cousash-chart-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const engine=new ParityEngine({home:root,dbPath:join(root,'d.sqlite'),remoteDir:join(root,'remotes'),currentCode:'local-test'});t.after(()=>engine.close());
 const raw=(uid,model,project,total)=>({uid,session_id:uid,source:'active',environment_id:'remote-os',environment:'Windows',title:project,project,models:[model],model,tasks:[],timeline:[{timestamp:'2026-11-08T12:00:00.000Z',model,total_token_usage:{...zero(),input_tokens:total,total_tokens:total},last_token_usage:{...zero(),input_tokens:total,total_tokens:total}}]});
 const a=raw('a','gpt-6.1-sol','alpha',100),b=raw('b','gpt-6-astra','beta',200);
 engine.importRemote({schema:'cousash.remote-snapshot',version:1,device:{short_code:'win-x'},snapshot:{sessions:[a,b],details_by_uid:{a,b}}},{label:'办公电脑'});
 const total=q=>engine.dailyUsage(new URLSearchParams(q),{}).daily_usage.reduce((n,r)=>n+r.usage.total_tokens,0);
 assert.equal(total({}),300);assert.equal(total({model:'gpt-6.1-sol'}),100);assert.equal(total({search:'beta'}),200);
 assert.equal(total({environment:'macos'}),0);assert.equal(total({source:'archived'}),0);assert.equal(total({environment:'remote-win-x'}),300);
});
