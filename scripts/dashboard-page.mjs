/** 紧凑用量仪表盘；保留完整查询能力，按需展示高级条件和趋势。 */
import { readFileSync } from 'node:fs';
import { buildDaySeries, calendarCells, heatmapWeeks } from './chart-data.mjs';
import { installAnalytics } from './dashboard-analytics.mjs';

export function renderDashboard() {
  let html=readFileSync(new URL('../assets/dashboard.html',import.meta.url),'utf8');
  const periodStart=html.indexOf('      <div class="period-wrap"');
  const toolbarStart=html.indexOf('      <div class="toolbar">');
  // 保留旧交互引用的隐藏节点，顶部只呈现六个常用范围。
  const periods=html.slice(periodStart,toolbarStart).replace('id="calendarBtn"','id="calendarBtn" hidden aria-hidden="true" tabindex="-1"');
  const filterIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/></svg>';
  const trendIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16h16M8 16v-5m5 5V7m5 9V4"/></svg>';
  const moreIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
  const header=`<header><div class="header-inner unified-header"><div class="brand"><span class="brand-mark" aria-hidden="true">◈</span><div><h1>Codex Usage</h1><div class="brand-kicker scan-status"><span data-i18n="lastScan">最近扫描</span> <time id="lastScanTime">—</time></div></div></div>
    <div class="header-range">${periods}<span id="activeRangeLabel" class="active-range-label"></span></div>
    <div class="header-actions">
      <button id="filterToggle" class="icon-button" type="button" title="高级时间筛选" aria-label="高级时间筛选" aria-expanded="false" aria-controls="advancedFilters">${filterIcon}</button>
      <button id="trendToggle" class="icon-button" type="button" title="每日消耗趋势" aria-label="每日消耗趋势" aria-haspopup="dialog" aria-controls="trendDialog" aria-expanded="false">${trendIcon}</button>
      <button id="refreshBtn" class="icon-button refresh-icon" type="button" title="重新扫描本地日志" aria-label="刷新" data-i18n-aria="refresh" data-i18n-title="refreshTitle">刷新</button>
      <div class="header-more"><button id="moreToggle" class="icon-button" type="button" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false" aria-controls="headerMenu">${moreIcon}</button>
        <div id="headerMenu" class="header-menu" role="menu" aria-label="更多操作" hidden>
          <button id="priceSync" class="menu-action sync-icon" role="menuitem" type="button" data-i18n="priceSync">同步费率</button>
          <button id="remoteBtn" class="menu-action import-icon" role="menuitem" type="button" data-i18n="importRemote" data-i18n-title="importRemoteTitle">导入远程数据</button>
          <button id="snapshotExportBtn" class="menu-action export-icon" role="menuitem" type="button" data-i18n="exportSnapshot" data-i18n-title="exportSnapshotTitle">导出快照</button>
          <div class="menu-language"><span data-i18n="language">语言</span><div class="lang-toggle"><button class="lang-option active" data-lang-button="zh" role="menuitemradio" aria-checked="true" type="button">中文</button><button class="lang-option" data-lang-button="en" role="menuitemradio" aria-checked="false" type="button">EN</button></div></div>
          <div id="headerMenuStatus" class="menu-status" role="status"></div>
        </div>
      </div>
    </div></div></header>`;
  html=html.replace(/  <header>[\s\S]*?<\/header>/,header);
  const query=`<section class="query-panel compact-query" id="advancedFilters" aria-label="高级时间筛选" hidden>
      <div class="query-bottom"><div><span class="field-label" id="quickLabel">快捷区间</span><div class="quick-ranges">
        ${[['30m','近30分钟','period30m'],['1h','近1小时','period1h'],['3h','近3小时','period3h'],['5h','近5小时','period5h'],['10h','近10小时','period10h']].map(([v,label,key])=>'<button type="button" data-period-button="'+v+'" data-i18n="'+key+'">'+label+'</button>').join('')}
      </div></div><div class="date-range-fields">
        <label><span class="field-label" data-i18n="intervalFrom">开始时间</span><input id="intervalFrom" type="datetime-local"></label>
        <label><span class="field-label" data-i18n="intervalTo">结束时间</span><input id="intervalTo" type="datetime-local"></label>
        <button class="primary" id="intervalApply" type="button" data-i18n="intervalApply">应用范围</button>
      </div></div>
      <div class="query-foot"><span id="nodeStatus" role="status"></span><span class="subtitle" id="codexHome"></span></div>
  </section>`;
  const trend=`<dialog id="trendDialog" class="trend-dialog" aria-labelledby="trendTitle">
    <div class="trend-dialog-top"><h2 id="trendTitle">每日 Token 消耗</h2><button id="trendClose" class="icon-button" type="button" aria-label="关闭趋势图" title="关闭趋势图"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
    <div class="analytics-head"><div><div class="analytics-sub" id="trendPeriod"></div><div class="trend-summary"><span class="trend-total" id="trendTotal">—</span><span id="trendAverage"></span></div></div><div class="chart-tools"><div class="chart-tabs" aria-label="趋势图时间范围"><button data-trend-days="7" aria-pressed="false">7天</button><button class="active" data-trend-days="30" aria-pressed="true">30天</button><button data-trend-days="90" aria-pressed="false">90天</button></div><select id="chartMetric" aria-label="图表统计指标"><option value="total_tokens">总量</option><option value="input_tokens">输入</option><option value="cached_input_tokens">缓存</option><option value="output_tokens">输出</option></select></div></div>
    <div class="analytics-sub" id="historyScope">按自然日统计 · 跟随模型、环境与搜索筛选</div><div class="chart-message" id="chartMessage" role="status"></div>
    <div class="trend-canvas"><canvas id="dailyTrend" role="img" aria-label="每日 Token 消耗趋势图"></canvas></div>
    <div class="chart-foot"><span><i class="legend-dot"></i><b id="chartLegend">总 Token</b></span><span id="trendPeak"></span></div><div class="chart-foot"><span id="chartHint">点击图表中的日期，可查看当日会话</span></div>
  </dialog>`;
  const heat=`<article class="compact-heat" aria-label="用量热力图">
    <div class="heat-title-row"><h2 id="heatTitle">用量日历</h2><span id="heatSummary"></span><div class="heat-nav"><button id="heatPrev" aria-label="热力图更早16周" title="更早16周">‹</button><button id="heatNext" aria-label="热力图更近16周" title="更近16周">›</button></div></div>
    <div class="heat-map-body"><div class="heat-week-labels" aria-hidden="true"><span>一</span><span>四</span><span>日</span></div><div class="heat-map-scroll"><div id="heatMonths" class="heat-months"></div><div id="heatGrid" class="heat-grid"></div></div></div>
    <div class="heat-legend"><span id="heatPeriod"></span><span class="heat-levels"><span id="heatLess">少</span><i style="background:#f1f4f5"></i><i style="background:#ddefe5"></i><i style="background:#a7d6b9"></i><i style="background:#5faf83"></i><i style="background:#238356"></i><span id="heatMore">多</span></span></div>
    <span id="chartTimezone" hidden></span><span id="heatDetail" class="sr-only"></span>
  </article>`;
  html=html.replace('<div class="metrics" id="metrics"></div>',query+'<section class="summary-strip" aria-label="用量统计"><div class="metrics" id="metrics"></div>'+heat+'</section>'+trend+'<div id="heatTooltip" class="heat-tooltip" role="tooltip" hidden></div>');
  html=html.replace('    <div class="controls">','<div class="detail-section-heading"><h2 id="detailHeading">会话与项目</h2><span id="detailCaption">选择一条会话，查看详细消耗</span></div><div class="controls">');
  html=html.replace('</main>','<footer class="page-footer"><span id="footerNote">仅统计已记录的 Token · 费用为公开 API 价格估算</span><span>Codex Usage</span></footer></main>');
  html=html.replace('</head>','<link rel="stylesheet" href="/assets/dashboard-redesign.css"><script src="/assets/chart.umd.min.js"></script></head>');
  html=html.replace('    applyStaticText();\n    populateEnvironmentFilter();','    installNodeFeatures();\n    applyStaticText();\n    populateEnvironmentFilter();');
  html=html.replace('    setInterval(() => loadData(false, { silent: true }), 10000);','    setInterval(() => loadData(false, { silent: true }), 10000);\n    window.addEventListener("focus", () => loadData(false, { silent: true }));');
  const end=html.lastIndexOf('</script>');
  html=html.slice(0,end)+features.toString()+'\n'+buildDaySeries.toString()+'\n'+calendarCells.toString()+'\n'+heatmapWeeks.toString()+'\n'+installAnalytics.toString()+'\nfunction installNodeFeatures(){features();installAnalytics();}\n'+html.slice(end);
  return html;
}

// 将函数源码直接插入 HTML，避免多层模板字符串破坏原版转义。
function features() {
  Object.assign(I18N.zh,{period30m:'近30分钟',period1h:'近1小时',period3h:'近3小时',period5h:'近5小时',period10h:'近10小时',intervalFrom:'开始时间',intervalTo:'结束时间',intervalApply:'查询时间范围',priceSync:'同步官方模型与费率',syncing:'正在同步…',syncOk:'费率同步成功',invalidRange:'请填写有效的起止时间，结束不得早于开始。'});
  Object.assign(I18N.en,{period30m:'Last 30 min',period1h:'Last 1 hour',period3h:'Last 3 hours',period5h:'Last 5 hours',period10h:'Last 10 hours',intervalFrom:'From',intervalTo:'To',intervalApply:'Apply time range',priceSync:'Sync official models & prices',syncing:'Syncing…',syncOk:'Prices synced',invalidRange:'Enter a valid time range.'});
  Object.assign(I18N.zh,{intervalApply:'应用范围',priceSync:'同步费率',metricCost:'API 估算费用'});
  Object.assign(I18N.zh,{lastScan:'最近扫描'});
  Object.assign(I18N.en,{lastScan:'Last scan'});
  let lastCheckedAt=0;
  function renderScanTime(stamp){
    const candidate=Date.parse(stamp);
    if(Number.isFinite(candidate))lastCheckedAt=Math.max(lastCheckedAt,candidate);
    if(!lastCheckedAt)return;
    const moment=new Date(lastCheckedAt),element=document.getElementById('lastScanTime');
    element.dateTime=moment.toISOString();
    element.textContent=moment.toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    element.title=moment.toLocaleString(locale(),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'});
  }
  const more=document.getElementById('moreToggle'),menu=document.getElementById('headerMenu');
  const menuItems=()=>Array.from(menu.querySelectorAll('button:not(:disabled)'));
  const setMenu=(open,focus=false)=>{menu.hidden=!open;more.setAttribute('aria-expanded',String(open));more.classList.toggle('active',open);if(focus){if(open)menuItems()[0]?.focus();else more.focus();}};
  more.onclick=()=>setMenu(menu.hidden,true);
  more.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setMenu(true,true);if(event.key==='ArrowUp')menuItems().at(-1)?.focus();}});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.header-more'))setMenu(false);});
  menu.addEventListener('keydown',event=>{const items=menuItems(),index=items.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();setMenu(false,true);}else if(event.key==='Tab'){setMenu(false,true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}});
  menu.addEventListener('click',event=>{const item=event.target.closest('.menu-action');if(item)setMenu(false,true);});
  const oldStaticText=applyStaticText;
  applyStaticText=function(){oldStaticText();renderScanTime();document.querySelectorAll('[data-lang-button]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.langButton===state.lang)));for(const [id,zh,en] of [['moreToggle','更多操作','More actions'],['filterToggle','高级时间筛选','Advanced time filters'],['trendToggle','每日消耗趋势','Daily usage trend']]){const button=document.getElementById(id);button.title=state.lang==='en'?en:zh;button.setAttribute('aria-label',button.title);}};
  const oldParams=periodParams,oldLabel=periodLabel,oldApply=applySessionData;
  let from='',to='';
  const toggle=document.getElementById('filterToggle'),advanced=document.getElementById('advancedFilters');
  const setExpanded=value=>{advanced.hidden=!value;toggle.setAttribute('aria-expanded',String(value));toggle.classList.toggle('active',value);};
  toggle.onclick=()=>setExpanded(advanced.hidden);
  advanced.addEventListener('keydown',event=>{if(event.key==='Escape'){setExpanded(false);toggle.focus();}});
  periodParams=function(period=state.period){const p=oldParams(period);if(period==='interval'){p.set('from',from);p.set('to',to);}return p;};
  periodLabel=function(){const map={'30m':'period30m','1h':'period1h','3h':'period3h','5h':'period5h','10h':'period10h'};if(map[state.period])return t(map[state.period]);if(state.period==='interval')return state.lang==='en'?'Selected range':'指定时间段';return oldLabel();};
  const oldButtons=updatePeriodButtons;
  updatePeriodButtons=function(){oldButtons();const special=['30m','1h','3h','5h','10h','interval','custom'].includes(state.period);document.getElementById('activeRangeLabel').textContent=special?periodLabel():'';toggle.classList.toggle('has-filter',special);if(state.period==='interval')document.getElementById('activeRangeLabel').title=document.getElementById('intervalFrom').value+' — '+document.getElementById('intervalTo').value;};
  applySessionData=async function(data,...args){await oldApply(data,...args);const p=data.pricing||{};const i=data.index||{};renderScanTime(i.checkedAt);const status=document.getElementById('nodeStatus');status.textContent=(state.lang==='en'?'Price sync: ':'费率同步：')+(p.updatedAt?new Date(p.updatedAt).toLocaleString(locale()):'—')+(p.error?' · '+p.error:'')+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone+(i.checkedAt?' · '+(state.lang==='en'?'Logs checked: ':'日志检查：')+new Date(i.checkedAt).toLocaleTimeString(locale()):'');if(!document.getElementById('priceSync').disabled)document.getElementById('headerMenuStatus').textContent=(state.lang==='en'?'Price sync: ':'费率同步：')+(p.updatedAt?new Date(p.updatedAt).toLocaleString(locale()):'—')+(p.error?' · '+p.error:'');};
  document.getElementById('intervalApply').onclick=()=>{const a=new Date(document.getElementById('intervalFrom').value),b=new Date(document.getElementById('intervalTo').value);if(!Number.isFinite(+a)||!Number.isFinite(+b)||a>b){document.getElementById('nodeStatus').textContent=t('invalidRange');return;}from=a.toISOString();to=b.toISOString();state.periodCache.clear();if(state.period==='interval')loadData(false);else setPeriod('interval');};
  const dateInput=d=>{const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);};
  document.getElementById('intervalFrom').value=dateInput(new Date(Date.now()-3600000));document.getElementById('intervalTo').value=dateInput(new Date());
  document.getElementById('priceSync').onclick=async()=>{const button=document.getElementById('priceSync');button.disabled=true;const note=message=>{document.getElementById('nodeStatus').textContent=message;document.getElementById('headerMenuStatus').textContent=message;};note(t('syncing'));try{const r=await fetch('/api/pricing/refresh',{method:'POST'});const d=await r.json();if(!r.ok||d.error)throw Error(d.error||'同步失败');state.periodCache.clear();await loadData(false);note(t('syncOk'));}catch(e){note(e.message);}finally{button.disabled=false;}};
}
