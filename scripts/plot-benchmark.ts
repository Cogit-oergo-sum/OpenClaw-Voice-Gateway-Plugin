import * as fs from 'fs';

/**
 * 从 benchmark JSONL 结果绘制折线图 (HTML + Chart.js)
 *
 * 用法:
 *   npx ts-node scripts/plot-benchmark.ts benchmark-results-xxx.jsonl
 *   open benchmark-chart.html
 */

const INPUT_FILE = process.argv[2];
if (!INPUT_FILE || !fs.existsSync(INPUT_FILE)) {
  console.error('用法: npx ts-node scripts/plot-benchmark.ts <benchmark-results.jsonl>');
  process.exit(1);
}

// ─── 解析 JSONL ────────────────────────────────────────

interface TTFTRecord {
  type: 'ttft';
  model: string;
  targetInputTokens: number;
  actualInputTokens?: number;
  outputTokens?: number;
  ttft_ms: number;
  ttfu_ms: number;
  totalLatency_ms: number;
}

interface IFERecord {
  type: 'ifeval';
  model: string;
  case_name: string;
  passed: boolean;
  output: string;
  expect: string;
}

type Record = TTFTRecord | IFERecord;

const lines = fs.readFileSync(INPUT_FILE, 'utf-8').trim().split('\n');
const records: Record[] = lines.map(l => JSON.parse(l));

const ttftRecords = records.filter(r => r.type === 'ttft') as TTFTRecord[];
const ifeRecords = records.filter(r => r.type === 'ifeval') as IFERecord[];

// ─── 聚合 TTFT 数据 (按 model × targetInputTokens 取 P50) ──

const models = [...new Set(ttftRecords.map(r => r.model))];
const sizes = [...new Set(ttftRecords.map(r => r.targetInputTokens))].sort((a, b) => a - b);

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

interface DataPoint { x: number; ttft: number; ttfu: number; total: number; }

const series: Record<string, DataPoint[]> = {};
for (const model of models) {
  series[model] = [];
  for (const size of sizes) {
    const group = ttftRecords.filter(r => r.model === model && r.targetInputTokens === size && r.ttft_ms > 0);
    if (group.length === 0) continue;
    const ttfts = group.map(r => r.ttft_ms);
    const ttfus = group.map(r => r.ttfu_ms).filter(v => v > 0);
    const totals = group.map(r => r.totalLatency_ms);
    series[model].push({
      x: group[0].actualInputTokens ?? size,
      ttft: percentile(ttfts, 0.5),
      ttfu: ttfus.length > 0 ? percentile(ttfus, 0.5) : 0,
      total: percentile(totals, 0.5),
    });
  }
}

// ─── 聚合 IFEval 数据 ──────────────────────────────────

const ifeSummary: Record<string, { pass: number; fail: number; details: string[] }> = {};
for (const model of models) {
  const group = ifeRecords.filter(r => r.model === model);
  ifeSummary[model] = {
    pass: group.filter(r => r.passed).length,
    fail: group.filter(r => !r.passed).length,
    details: group.filter(r => !r.passed).map(r => r.case_name),
  };
}

// ─── 颜色 ──────────────────────────────────────────────

const COLORS = [
  { line: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },   // red
  { line: '#3498db', bg: 'rgba(52,152,219,0.1)' },   // blue
  { line: '#2ecc71', bg: 'rgba(46,204,113,0.1)' },   // green
  { line: '#f39c12', bg: 'rgba(243,156,18,0.1)' },   // orange
  { line: '#9b59b6', bg: 'rgba(155,89,182,0.1)' },   // purple
  { line: '#1abc9c', bg: 'rgba(26,188,156,0.1)' },   // teal
];

// ─── 生成 HTML ─────────────────────────────────────────

const ttftDatasets = models.map((model, i) => ({
  label: model,
  data: series[model],
  color: COLORS[i % COLORS.length],
}));

const ttfuDatasets = models.map((model, i) => ({
  label: model,
  data: series[model].filter(d => d.ttfu > 0),
  color: COLORS[i % COLORS.length],
}));

function makeChartConfig(datasets: typeof ttftDatasets, field: 'ttft' | 'ttfu', label: string) {
  return datasets.map(ds => `{
    label: '${ds.label}',
    data: ${JSON.stringify(ds.data.map(d => ({ x: d.x, y: d[field] })))},
    borderColor: '${ds.color.line}',
    backgroundColor: '${ds.color.bg}',
    borderWidth: 2,
    pointRadius: 4,
    pointBackgroundColor: '${ds.color.line}',
    fill: false,
    tension: 0.3,
  }`).join(',\n    ');
}

// IFEval 表格
const ifeTableRows = models.map(model => {
  const s = ifeSummary[model];
  if (!s) return '';
  const rate = s.pass + s.fail > 0 ? (s.pass / (s.pass + s.fail) * 100).toFixed(0) : '-';
  const bar = s.pass + s.fail > 0 ? '█'.repeat(Math.round(s.pass / (s.pass + s.fail) * 20)) : '';
  return `<tr>
    <td>${model}</td>
    <td>${s.pass}/${s.pass + s.fail}</td>
    <td>${rate}%</td>
    <td style="font-family:monospace;color:#2ecc71">${bar}</td>
    <td style="color:#e74c3c;font-size:0.85em">${s.details.join(', ') || '-'}</td>
  </tr>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Qwen Benchmark Results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { font-family: -apple-system, "Helvetica Neue", sans-serif; max-width: 1100px; margin: 0 auto; padding: 20px; background: #fafafa; }
  h1 { color: #2c3e50; }
  h2 { color: #34495e; margin-top: 2em; }
  .chart-container { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 1em 0; }
  table { border-collapse: collapse; width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f8f9fa; color: #2c3e50; font-weight: 600; }
  .subtitle { color: #7f8c8d; font-size: 0.9em; margin-bottom: 0.5em; }
</style>
</head>
<body>

<h1>Qwen 模型基准测试</h1>
<p class="subtitle">数据来源: ${INPUT_FILE} | 生成时间: ${new Date().toLocaleString()}</p>

<h2>TTFT (首 Token 延迟) vs Input Tokens</h2>
<div class="chart-container">
  <canvas id="ttftChart"></canvas>
</div>

<h2>TTFU (首句完整延迟) vs Input Tokens</h2>
<p class="subtitle">首句 = 首个句末标点(，。？！等)出现时刻</p>
<div class="chart-container">
  <canvas id="ttfuChart"></canvas>
</div>

<h2>TTFT 与 TTFU 对比 (同图)</h2>
<div class="chart-container">
  <canvas id="compareChart"></canvas>
</div>

<h2>指令遵循 (IFEval 风格)</h2>
<table>
  <thead>
    <tr><th>Model</th><th>通过/总数</th><th>通过率</th><th>可视化</th><th>失败项</th></tr>
  </thead>
  <tbody>
    ${ifeTableRows}
  </tbody>
</table>

<script>
const baseOptions = {
  responsive: true,
  scales: {
    x: {
      type: 'linear',
      title: { display: true, text: 'Input Tokens (actual)', font: { size: 13 } },
      ticks: { callback: v => v >= 1000 ? (v/1000)+'K' : v }
    },
    y: {
      title: { display: true, text: 'Latency (ms)', font: { size: 13 } },
      beginAtZero: true,
    }
  },
  plugins: {
    tooltip: {
      callbacks: {
        label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + 'ms @ ' + ctx.parsed.x + ' tokens'
      }
    }
  }
};

new Chart(document.getElementById('ttftChart'), {
  type: 'line',
  datasets: [${makeChartConfig(ttftDatasets, 'ttft', 'TTFT')}],
  options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'TTFT (首Token延迟) vs Input Tokens' } } },
});

new Chart(document.getElementById('ttfuChart'), {
  type: 'line',
  datasets: [${makeChartConfig(ttfuDatasets, 'ttfu', 'TTFU')}],
  options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'TTFU (首句完整延迟) vs Input Tokens' } } },
});

// 对比图: 每个模型画 TTFT 实线 + TTFU 虚线
const compareDatasets = [];
${models.map((model, i) => {
  const c = COLORS[i % COLORS.length];
  const ttftData = JSON.stringify(series[model].map(d => ({ x: d.x, y: d.ttft })));
  const ttfuData = JSON.stringify(series[model].filter(d => d.ttfu > 0).map(d => ({ x: d.x, y: d.ttfu })));
  return `compareDatasets.push({
  label: '${model} TTFT',
  data: ${ttftData},
  borderColor: '${c.line}',
  backgroundColor: '${c.bg}',
  borderWidth: 2,
  pointRadius: 4,
  pointBackgroundColor: '${c.line}',
  fill: false,
  tension: 0.3,
});
compareDatasets.push({
  label: '${model} TTFU',
  data: ${ttfuData},
  borderColor: '${c.line}',
  backgroundColor: 'transparent',
  borderWidth: 2,
  borderDash: [6, 3],
  pointRadius: 3,
  pointStyle: 'triangle',
  pointBackgroundColor: '${c.line}',
  fill: false,
  tension: 0.3,
});`;
}).join('\n')}

new Chart(document.getElementById('compareChart'), {
  type: 'line',
  data: { datasets: compareDatasets },
  options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'TTFT (实线) vs TTFU (虚线) 对比' } } },
});
</script>

</body>
</html>`;

const outPath = INPUT_FILE.replace('.jsonl', '.html').replace('benchmark-results-', 'benchmark-chart-');
fs.writeFileSync(outPath, html);
console.log(`📊 图表已生成: ${outPath}`);
console.log(`   用浏览器打开即可查看`);
