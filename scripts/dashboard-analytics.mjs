/** 浏览器图表交互，与现有详情筛选和日期查询联动。 */
export function installAnalytics() {
  const $=id=>document.getElementById(id);
  const text=(zh,en)=>state.lang==='en'?en:zh;
  let history=[],today=dateKey(new Date()),heatEnd=today,zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  let chart,windowDays=30,metric='total_tokens',fetchedAt=0,lastKey='',revision=0,timer;
  const compact=n=>fmtCompact(n||0);
  const metricName=()=>({total_tokens:text('总 Token','Total tokens'),input_tokens:text('输入 Token','Input tokens'),cached_input_tokens:text('缓存输入','Cached input'),output_tokens:text('输出 Token','Output tokens')})[metric];
  const titles={trendTitle:['每日 Token 消耗','Daily token usage'],heatTitle:['用量日历','Usage calendar'],historyScope:['按自然日统计 · 跟随模型、环境与搜索筛选','Calendar days · follows model, environment and search filters'],detailHeading:['会话与项目','Sessions & projects'],detailCaption:['选择一条会话，查看详细消耗','Select a session to inspect usage'],overviewTitle:['用量概览','Usage overview'],overviewCaption:['了解消耗去了哪里，以及它如何随时间变化','Understand your usage and how it changes over time'],queryCaption:['选择下方会话的统计范围','Choose a range for the sessions below'],quickLabel:['快捷区间','Quick range'],liveLabel:['本地数据 · 自动更新','Local data · live updates'],heatLess:['少','Less'],heatMore:['多','More'],chartHint:['点击图表中的日期，可查看当日会话','Click a date to inspect its sessions'],footerNote:['仅统计已记录的 Token · 费用为公开 API 价格估算','Recorded tokens only · costs estimated at public API rates']};
  function translate(){for(const [id,v] of Object.entries(titles)){if($(id))$(id).textContent=v[state.lang==='en'?1:0];}$('chartMetric').options[0].text=text('总量','Total');$('chartMetric').options[1].text=text('输入','Input');$('chartMetric').options[2].text=text('缓存','Cached');$('chartMetric').options[3].text=text('输出','Output');for(const b of document.querySelectorAll('[data-trend-days]'))b.textContent=b.dataset.trendDays+text('天','d');}
  const dialog=$('trendDialog'),trendToggle=$('trendToggle');
  trendToggle.onclick=()=>{dialog.showModal();trendToggle.setAttribute('aria-expanded','true');paintTrend();if(chart)chart.resize();void loadHistory();$('trendClose').focus();};
  $('trendClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{trendToggle.setAttribute('aria-expanded','false');trendToggle.focus();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  function chooseDate(day){$('heatTooltip').hidden=true;if(dialog.open)dialog.close();state.periodCache.clear();setCustomPeriod(day,day);paintHeat();$('detailHeading').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
  function paintTrend(){
    translate(); if(!dialog.open)return;
    const rows=buildDaySeries(history,today,windowDays),values=rows.map(r=>r.usage[metric]||0);
    const sum=values.reduce((a,b)=>a+b,0),max=Math.max(0,...values),peak=max?rows[values.indexOf(max)].date:'—';
    $('trendTotal').textContent=compact(sum);$('trendAverage').textContent=text('日均 ','Daily avg. ')+compact(sum/windowDays);$('trendPeriod').textContent=rows[0].date+' — '+today;
    $('trendPeak').textContent=text('峰值 ','Peak ')+peak+(max?' · '+compact(max):'');$('chartLegend').textContent=metricName();
    if(typeof Chart==='undefined'){$('chartMessage').textContent=text('图表资源加载失败，请刷新页面。','Chart resource failed to load. Please reload.');return;}
    const data={labels:rows.map(r=>r.date.slice(5).replace('-','/')),datasets:[{label:metricName(),data:values,borderColor:'#268b6d',backgroundColor:'rgba(38,139,109,0.07)',fill:true,borderWidth:2,pointRadius:windowDays>30?0:2,pointBackgroundColor:'#fff',pointBorderWidth:1.5,pointHoverRadius:5,tension:0.15}]};
    const options={responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:'#203b36',titleFont:{size:11},bodyFont:{size:11},padding:10,displayColors:false,callbacks:{title:items=>rows[items[0].dataIndex].date,label:item=>metricName()+': '+new Intl.NumberFormat(locale()).format(item.parsed.y)}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:'#9caaaf',font:{size:10},maxTicksLimit:7,maxRotation:0}},y:{beginAtZero:true,grid:{color:'#f0f3f4'},border:{display:false,dash:[3,4]},ticks:{color:'#a0adb3',font:{size:10},maxTicksLimit:4,callback:compact}}},onClick:(_event,elements)=>{if(elements.length)chooseDate(rows[elements[0].index].date);}};
    if(chart){chart.data=data;chart.options=options;chart.update('none');}else chart=new Chart($('dailyTrend'),{type:'line',data,options});
  }
  function paintHeat(){
    const cells=heatmapWeeks(history,heatEnd,today,16);$('heatNext').disabled=heatEnd>=today;
    const months=[];let lastMonth='';for(let week=0;week<16;week++){const c=cells[week*7],m=c.date.slice(0,7);const name=lastMonth!==m?new Date(c.date+'T12:00:00').toLocaleDateString(locale(),{month:'short'}):'';lastMonth=m;months.push('<span style="grid-column:'+(week+1)+'">'+name+'</span>');}
    $('heatMonths').innerHTML=months.join('');
    $('heatGrid').innerHTML=cells.map(c=>'<button type="button" class="heat-day'+(c.date===today?' today':'')+(state.period==='custom' && c.date>=state.customStartDate && c.date<=(state.customEndDate||state.customStartDate)?' selected':'')+'" data-heat-date="'+c.date+'" data-level="'+c.level+'" data-tokens="'+c.tokens+'" aria-label="'+c.date+' · '+new Intl.NumberFormat(locale()).format(c.tokens)+' tokens" '+(c.future?'disabled':'')+'></button>').join('');
    const active=cells.filter(c=>c.tokens>0),total=active.reduce((n,c)=>n+c.tokens,0);
    $('heatSummary').textContent=active.length+text(' 个活跃日',' active days');$('heatSummary').title=text('所示区间合计：','Range total: ')+compact(total)+' tokens';
    $('heatPeriod').textContent=cells[0].date.slice(5).replace('-','/')+'–'+(heatEnd>today?today:heatEnd).slice(5).replace('-','/');
    $('heatDetail').textContent=text('悬停查看每日用量，点击查看明细','Hover for usage, click for session details');
    $('chartTimezone').textContent=text('统计时区：','Time zone: ')+zone;
  }
  function paint(){paintTrend();paintHeat();}
  async function loadHistory(force=false){
    const p=new URLSearchParams({environment:state.environment,source:state.source,model:state.model,search:state.search});const k=p.toString()+JSON.stringify(state.remotes);
    if(!force&&k===lastKey&&Date.now()-fetchedAt<60000){paintHeat();return;}
    const id=++revision;$('chartMessage').textContent=text('正在读取每日统计…','Loading daily usage…');
    try{const r=await fetch('/api/daily-usage?'+p,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(id!==revision)return;history=data.daily_usage||[];const previous=today;today=data.today||today;if(heatEnd===previous)heatEnd=today;zone=data.timezone||zone;lastKey=k;fetchedAt=Date.now();$('chartMessage').textContent='';$('chartMessage').classList.remove('error');paint();}
    catch(e){if(id!==revision)return;$('chartMessage').textContent=text('图表更新失败：','Chart update failed: ')+e.message;$('chartMessage').classList.add('error');$('heatSummary').textContent=text('加载失败','Load failed');}
  }
  for(const b of document.querySelectorAll('[data-trend-days]'))b.onclick=()=>{windowDays=Number(b.dataset.trendDays);for(const x of document.querySelectorAll('[data-trend-days]')){x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));}paintTrend();};
  $('chartMetric').onchange=()=>{metric=$('chartMetric').value;paintTrend();};
  for(const [id,dir] of [['heatPrev',-1],['heatNext',1]])$(id).onclick=()=>{const d=new Date(heatEnd+'T12:00:00');d.setDate(d.getDate()+dir*112);heatEnd=dateKey(d)>today?today:dateKey(d);paintHeat();};
  $('heatGrid').onclick=e=>{const b=e.target.closest('[data-heat-date]');if(b&&!b.disabled)chooseDate(b.dataset.heatDate);};
  function tooltip(e){const b=e.target.closest('[data-heat-date]');if(!b||b.disabled)return;const label=b.dataset.heatDate+' · '+new Intl.NumberFormat(locale()).format(Number(b.dataset.tokens))+' tokens';$('heatDetail').textContent=label;const tip=$('heatTooltip');tip.textContent=label;tip.hidden=false;const rect=b.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(innerWidth-245,rect.left))+'px';tip.style.top=(rect.top-37)+'px';}
  $('heatGrid').addEventListener('mouseover',tooltip);$('heatGrid').addEventListener('focusin',tooltip);$('heatGrid').addEventListener('mouseleave',()=>{$('heatTooltip').hidden=true;});$('heatGrid').addEventListener('focusout',()=>{$('heatTooltip').hidden=true;});
  for(const id of ['environmentFilter','sourceFilter','modelFilter'])$(id).addEventListener('change',()=>loadHistory(true));
  $('searchInput').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>loadHistory(true),250);});
  $('refreshBtn').addEventListener('click',()=>loadHistory(true));
  const oldApply=applySessionData,oldLanguage=setLanguage;
  applySessionData=async function(...args){await oldApply(...args);void loadHistory();};
  setLanguage=function(...args){oldLanguage(...args);paint();};
  translate();paintHeat();
}
