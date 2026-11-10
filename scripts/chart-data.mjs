/** 按自然日补齐图表数据，日期以数据接口给出的时区为准。 */
export function buildDaySeries(rows, endDay, days) {
  const values = new Map(rows.map(row => [row.date, row.usage || {}]));
  const end = new Date(endDay + 'T12:00:00');
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(end); d.setDate(d.getDate() - days + index + 1);
    const key = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    return { date: key, usage: values.get(key) || { total_tokens:0,input_tokens:0,cached_input_tokens:0,output_tokens:0 }, recorded: values.has(key) };
  });
}

export function calendarCells(rows, month, today) {
  const values = new Map(rows.map(row => [row.date, Number(row.usage?.total_tokens || 0)]));
  const start = new Date(month + '-01T12:00:00');
  const offset = (start.getDay()+6)%7;
  const count = new Date(start.getFullYear(), start.getMonth()+1, 0).getDate();
  const max = Math.max(0, ...rows.filter(row => row.date.startsWith(month)).map(row=>Number(row.usage?.total_tokens || 0)));
  return Array.from({length:42},(_,i)=>{
    const day=i-offset+1;
    if(day<1 || day>count) return {empty:true};
    const date=month+'-'+String(day).padStart(2,'0'); const tokens=values.get(date)||0;
    return {date,day,tokens,future:date>today,level:tokens>0?Math.min(4,Math.max(1,Math.ceil(tokens/max*4))):0};
  });
}

/** 按周排列的小方格热力图，列为周、行为周一至周日。 */
export function heatmapWeeks(rows, endDay, today, weeks=16) {
  const values=new Map(rows.map(row=>[row.date,Number(row.usage?.total_tokens||0)]));
  const end=new Date(endDay+'T12:00:00');
  end.setDate(end.getDate()+6-(end.getDay()+6)%7);
  const series=buildDaySeries(rows,[end.getFullYear(),String(end.getMonth()+1).padStart(2,'0'),String(end.getDate()).padStart(2,'0')].join('-'),weeks*7);
  const max=Math.max(0,...series.filter(r=>r.date<=today).map(r=>r.usage.total_tokens||0));
  return series.map((r,i)=>{const tokens=values.get(r.date)||0;return {date:r.date,week:Math.floor(i/7),weekday:i%7,tokens,future:r.date>today,level:tokens>0?Math.min(4,Math.max(1,Math.ceil(tokens/max*4))):0};});
}
