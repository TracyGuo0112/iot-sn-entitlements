import { customers, devices, batches, batchItems, orders, resolveCustomer, queryDevices, queryBatches, queryOrders, getBatchSummary, getDeviceDetail, toCsv } from './data.mjs';
import { parseSnFile, MAX_SNS } from './upload.mjs';

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8m-8 4h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.4 1.6c-.9.7-1.9 1.2-1.9 2.9M12 17h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 9M20 3v5h-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  key: '<circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 9-9M16 7l3 3m-1-5 3 3"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  headset: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v7h5v-7H4Zm16 0h2v7h-5v-7h3ZM20 19v3h-7"/>',
  sparkle: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>'
};
const icon = (name, extra = '') => `<svg class="${extra}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, s => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[s]));
const fmt = value => value ? esc(String(value).replace('T', ' ').slice(0, 16)) : '—';
const shortDate = value => value ? esc(String(value).slice(0, 10)) : '—';
const number = value => Number(value || 0).toLocaleString('zh-CN');
const money = value => `¥${Number(value || 0).toFixed(2)}`;
const claimNames = { unclaimed:'待领取', claimed:'已领取', restored:'待重领' };
const benefitNames = { inactive:'未激活', active:'生效中', expired:'已到期' };
const resultNames = { added:'新增成功', skipped:'已存在，跳过', restored:'退权益成功', failed:'处理失败' };
const badge = (label, tone = 'neutral') => `<span class="badge ${tone}"><span class="badge-dot"></span>${esc(label)}</span>`;
const claimBadge = status => badge(claimNames[status], { unclaimed:'neutral', claimed:'success', restored:'warning' }[status]);
const benefitBadge = status => badge(benefitNames[status], { inactive:'neutral', active:'success', expired:'warning' }[status]);
const resultBadge = result => badge(resultNames[result], { added:'success', skipped:'neutral', restored:'info', failed:'danger' }[result]);
const copyButton = (value, label = '复制') => `<button type="button" class="copy-button" data-copy="${esc(value)}" title="${esc(label)}" aria-label="${esc(label)}">${icon('copy')}</button>`;
const empty = (title = '没有找到匹配的记录', hint = '试试更换关键词，或重置筛选条件。') => `<div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>${esc(title)}</h3><p>${esc(hint)}</p><button class="button secondary small" data-action="reset-filters">重置筛选</button></div>`;
const pageNames = { devices:'SN 权益查询', batches:'导入记录', orders:'订单记录', guide:'使用说明' };
const initialFilters = () => ({ devices:{ query:'', claimStatus:'', benefitStatus:'', productId:'', from:'', to:'' }, batches:{ query:'', from:'', to:'', status:'' }, orders:{ query:'', status:'', refundStatus:'', from:'', to:'' } });
const initialUpload = () => ({ status:'idle',fileName:'',result:null,error:'' });
const state = { upload:initialUpload(),customer:customers[0], page:'devices', queryMode:'single', filters:initialFilters(), currentPage:1, pageSize:10, batchFilter:'', overlay:null, returnFocus:null };
const tenantDevices = () => devices.filter(d => d.tenantId === state.customer.id);
const tenantBatches = () => batches.filter(b => b.tenantId === state.customer.id);
const products = () => [...new Map(tenantDevices().map(d => [d.productId, d.productName])).entries()];

function render() {
  const nav = [['devices','chip'], ['batches','layers'], ['orders','file']].map(([page, glyph]) => `<button class="nav-item ${state.page === page ? 'active' : ''}" data-page="${page}" ${state.page === page ? 'aria-current="page"' : ''} title="${pageNames[page]}"><span class="nav-icon">${icon(glyph)}</span><span class="nav-label">${pageNames[page]}</span>${page === 'batches' ? `<span class="nav-badge">${tenantBatches().length}</span>` : ''}</button>`).join('');
  document.getElementById('app').innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#" aria-label="IOT-SN 权益查询首页" data-page="devices"><span class="brand-mark"><img src="./brand-logo.jpg" alt="喜马拉雅"></span><span><span class="brand-name"><span>IOT-SN</span><span>权益查询</span></span><span class="brand-sub">喜马拉雅 · IOT</span></span></a><div class="nav-group-label">客户工作台</div><nav aria-label="主导航">${nav}</nav><div class="nav-group-label" style="margin-top:30px">支持</div><button class="nav-item ${state.page === 'guide' ? 'active' : ''}" data-page="guide" title="使用说明"><span class="nav-icon">${icon('help')}</span><span class="nav-label">使用说明</span></button><div class="sidebar-bottom"><div class="help-card"><span class="help-icon">${icon('shield')}</span><strong>每一份权益，都有迹可循</strong><p>从设备报备到权益领取，<br>清楚掌握每一步。</p><button class="text-link" data-page="guide">了解权益规则 ${icon('arrow')}</button></div><div class="user-block"><span class="avatar">${esc(state.customer.initials)}</span><span class="user-info"><strong>${esc(state.customer.name)}</strong><small>客户查询空间</small></span></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">客户工作台 <span>/</span> <strong>${pageNames[state.page]}</strong></div><div class="topbar-actions"><span class="demo-badge">DEMO · 模拟数据</span><span class="connection-indicator"><span class="status-dot"></span> 查询服务可用</span><button class="icon-button" data-page="guide" title="查看使用说明" aria-label="查看使用说明">${icon('help')}</button></div></header><main class="main" id="main-content">${renderMain()}</main></div></div>`;
  document.title = `${pageNames[state.page]} · IOT-SN 权益查询`;
}

function pageHeading(title, description, action = '') {
  return `<div class="page-heading"><div class="eyebrow">${state.page === 'devices' ? 'DEVICE ENTITLEMENTS' : state.page === 'batches' ? 'IMPORT HISTORY' : state.page === 'orders' ? 'ORDER RECORDS' : 'QUICK START'}</div><div class="heading-row"><div><h1 class="page-title">${title}</h1><p class="page-description">${description}</p></div><div class="heading-actions">${action}</div></div></div>`;
}

function contextCard() {
  return `<section class="context-card" aria-label="当前客户"><div class="context-identity"><div class="context-avatar">${esc(state.customer.initials)}</div><div class="context-info"><strong>${esc(state.customer.name)}</strong><span>${badge('当前客户','success')}<span class="context-key">Appkey <code>${esc(state.customer.appkey.slice(0, 8))}••••${esc(state.customer.appkey.slice(-6))}</code> ${copyButton(state.customer.appkey, '复制当前 appkey')}</span></span></div></div><div class="context-actions"><span class="muted">按 appkey 查询专属数据</span><button class="button secondary small" data-action="switch-key">${icon('key')} 切换 appkey</button></div></section>`;
}

function renderMain() {
  if (state.page === 'guide') return renderGuide();
  if (state.page === 'batches') return renderBatches();
  if (state.page === 'orders') return renderOrders();
  return renderDevices();
}

function renderDevices() {
  const ds = tenantDevices();
  const f = state.filters.devices;
  const rows = queryDevices({ ...f, tenantId:state.customer.id, exactMatch:state.queryMode === 'batch' });
  const counts = { all:ds.length, unclaimed:ds.filter(d => d.claimStatus === 'unclaimed').length, claimed:ds.filter(d => d.claimStatus === 'claimed').length, restored:ds.filter(d => d.claimStatus === 'restored').length };
  const cards = [ ['all','全部设备','chip','green','已报备的 SN 设备'], ['unclaimed','待领取','clock','blue','已获得初始化权益资格'], ['claimed','已领取','check','green','已使用本轮领取资格'], ['restored','待重领','refresh','amber','退权益成功，恢复一次资格'] ].map(([key,label,glyph,tone,note]) => `<button class="stat-card" data-stat="${key}" aria-label="筛选${label}"><div class="stat-label">${label}<span class="stat-icon ${tone}">${icon(glyph)}</span></div><div class="stat-value">${number(counts[key])}<span>台</span></div><div class="stat-note">${note}<span class="stat-link">${icon('arrow')}</span></div></button>`).join('');
  return `${pageHeading('IOT-SN 权益查询', '查询设备领取资格与权益状态，追溯每一次领取记录。', `<button class="button secondary" data-action="export">${icon('down')} 导出查询结果</button>`)}${contextCard()}<section class="stats-grid" aria-label="设备状态概览">${cards}</section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">查询设备权益</h2><p class="panel-subtitle">每个 appkey 下，同一 SN 的初始化权益只能领取一次</p></div><span class="notice-icon">${icon('search')}</span></div>${renderDeviceSearch(f)}</section><section class="panel results-panel">${batchLookupNotice(rows)}<div class="results-header"><div><h2 class="panel-title">设备权益列表 <span class="tab-count">${rows.length}</span></h2><p class="panel-subtitle">点击 SN 查看权益详情与完整流转记录</p></div><span class="results-summary">数据截至 2026-10-15 16:30</span></div>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>SN 设备号</th><th>权益名称 / 商品</th><th>领取状态</th><th>权益状态</th><th>权益有效期</th><th>首次导入时间</th><th>操作</th></tr></thead><tbody>${pageRows(rows).map(d => `<tr><td><button class="sn-link mono" data-device="${esc(d.sn)}">${esc(d.sn)}</button><div class="cell-secondary">设备序列号</div></td><td><span class="cell-title">${esc(d.benefitName)}</span><span class="cell-secondary">${esc(d.productName)}</span></td><td>${claimBadge(d.claimStatus)}</td><td>${benefitBadge(d.benefitStatus)}</td><td>${d.startAt ? `<span class="mono">${shortDate(d.startAt)}</span><span class="cell-secondary mono">至 ${shortDate(d.endAt)}</span>` : '<span class="muted">领取后生效</span>'}</td><td class="mono muted">${shortDate(d.createdAt)}</td><td><button class="text-link" data-device="${esc(d.sn)}">详情 ${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>${pagination(rows.length)}` : state.queryMode === 'batch' && state.upload.status !== 'ready' ? empty('上传表格后显示查询结果', '先下载示例表格填写 SN，再上传查询。') : empty()}</section><div class="footer-note">${icon('info')} 退权益会恢复领取资格并扣减商品额度；资金退款请查看关联订单的退款状态。</div>`;
}

function renderDeviceSearch(f) {
  const u = state.upload;
  const tabs = `<div class="tabs" role="tablist" aria-label="查询方式"><button type="button" role="tab" aria-selected="${state.queryMode === 'single'}" class="tab ${state.queryMode === 'single' ? 'active' : ''}" data-query-mode="single">单个 SN 查询</button><button type="button" role="tab" aria-selected="${state.queryMode === 'batch'}" class="tab ${state.queryMode === 'batch' ? 'active' : ''}" data-query-mode="batch">批量 SN 查询</button></div>`;
  const single = `<div class="search-row"><div class="input-wrap"><label class="sr-only" for="query">SN 设备号</label><span class="input-icon">${icon('search')}</span><input class="input search-input" id="query" name="query" value="${esc(f.query)}" placeholder="输入 SN 设备号，支持模糊搜索" autocomplete="off"></div><button class="button primary" type="submit">${icon('search')} 查询</button><button class="button ghost" type="button" data-action="reset-filters">重置</button></div>`;
  const upload = `<input type="hidden" id="query" name="query" value="${esc(f.query)}"><div class="upload-steps"><span class="upload-step"><b>1</b> 下载示例表格</span><span class="upload-step"><b>2</b> 填写 SN 清单</span><span class="upload-step active"><b>3</b> 上传并查询</span></div><div class="upload-zone ${u.status === 'error' ? 'has-error' : ''}" id="upload-zone"><input type="file" id="sn-file" accept=".xlsx,.csv" class="sr-only" aria-label="上传 SN 查询表格"><div class="upload-icon">${icon(u.status === 'ready' ? 'check' : 'file')}</div><h3 class="upload-title">${u.status === 'reading' ? '正在读取表格…' : u.status === 'ready' ? '表格已读取，查询完成' : '将填写好的表格拖到这里'}</h3><p class="upload-description">支持 Excel（.xlsx）或 UTF-8 CSV，最多 ${MAX_SNS} 个 SN，文件不超过 2 MB</p><div class="upload-actions"><button class="button primary" type="button" data-action="select-file" ${u.status === 'reading' ? 'disabled' : ''}>${icon('file')} ${u.status === 'ready' ? '更换表格' : '选择表格'}</button><a class="button secondary" href="./templates/sn-query-template.xlsx" download="IOT-SN批量查询模板.xlsx">${icon('down')} 下载 Excel 示例</a><a class="text-link" href="./templates/sn-query-template.csv" download="IOT-SN批量查询模板.csv">CSV 示例</a></div><p class="upload-meta">保留首行 SN 表头，用实际设备号替换示例。上传成功后自动查询。</p></div>${u.fileName ? `<div class="upload-file">${icon('file')}<strong>${esc(u.fileName)}</strong><button class="text-link upload-clear" type="button" data-action="clear-upload">清除</button></div>` : ''}${u.status === 'ready' ? `<div class="upload-summary">${badge(`已识别 ${u.result.sns.length} 个 SN`,'success')}<span>已去重 ${u.result.duplicateCount} 条，忽略 ${u.result.emptyCount} 个空行</span><button class="text-link" type="submit">重新查询 ${icon('arrow')}</button></div>` : ''}${u.error ? `<p class="form-error upload-status" role="alert">${esc(u.error)}</p>` : ''}`;
  return `<form id="query-form" class="search-form">${tabs}${state.queryMode === 'single' ? single : upload}<div class="filter-row">${selectField('claimStatus','领取状态',[['','全部状态'],...Object.entries(claimNames)],f.claimStatus)}${selectField('benefitStatus','权益状态',[['','全部状态'],...Object.entries(benefitNames)],f.benefitStatus)}${selectField('productId','关联商品',[['','全部商品'],...products()],f.productId)}${dateFields(f,'首次导入时间')}</div><p class="form-error" id="query-error" role="alert" hidden></p></form>`;
}

function batchLookupNotice(rows) {
  if (state.queryMode !== 'batch' || state.upload.status !== 'ready') return '';
  const sns = state.upload.result.sns;
  const known = new Set(tenantDevices().map(d => d.sn.toLowerCase()));
  const unmatched = sns.filter(sn => !known.has(sn.toLowerCase()));
  return `<div class="unmatched-note"><strong>本次查询 ${sns.length} 个 SN，当前筛选返回 ${rows.length} 条权益记录</strong>${unmatched.length ? `<span>当前 appkey 下未查到 ${unmatched.length} 个：<code>${unmatched.slice(0,10).map(esc).join('、')}${unmatched.length > 10 ? '…' : ''}</code></span>` : '<span>全部 SN 均已在当前客户下找到。</span>'}</div>`;
}

async function handleSnFile(file) {
  if (!file) return;
  const form = document.getElementById('query-form');
  const filters = form ? Object.fromEntries(new FormData(form)) : state.filters.devices;
  if (filters.from && filters.to && filters.from > filters.to) {
    const error = document.getElementById('query-error');
    error.textContent = '起始日期不能晚于结束日期，请修正后重新上传。';
    error.hidden = false;
    document.getElementById('sn-file').value = '';
    return;
  }
  const pending = { status:'reading',fileName:file.name,result:null,error:'' };
  state.upload = pending;
  state.filters.devices = { ...filters,query:'' };
  state.currentPage = 1;
  render();
  try {
    const result = await parseSnFile(file);
    if (state.upload !== pending) return;
    if (!result.sns.length && !result.invalidRows.length) throw new Error('表格中没有可查询的 SN，请填写 SN 列后重新上传。');
    if (result.invalidRows.length) {
      const detail = result.invalidRows.slice(0,5).map(r => `第 ${r.row} 行：${r.reason}`).join('；');
      state.upload = { ...pending,status:'error',error:`发现 ${result.invalidRows.length} 行格式错误，请修正后重新上传。${detail}` };
    } else {
      state.upload = { status:'ready',fileName:file.name,result,error:'' };
      state.filters.devices = { ...filters,query:result.sns.join('\n') };
      toast(`已读取 ${result.sns.length} 个 SN，并完成查询`);
    }
  } catch (error) {
    if (state.upload !== pending) return;
    state.upload = { ...pending,status:'error',error:error.message || '表格读取失败，请检查后重试。' };
  }
  render();
}

function selectField(name, label, options, value) {
  return `<label class="field"><span class="field-label">${label}</span><select class="select" name="${name}">${options.map(([val,text]) => `<option value="${esc(val)}" ${val === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}
function dateFields(f, label = '时间范围') {
  return `<div class="field date-field"><span class="field-label">${label}</span><div class="date-range"><label class="sr-only" for="from">起始日期</label><input class="input" type="date" id="from" name="from" value="${esc(f.from)}" aria-label="起始日期"><span>至</span><label class="sr-only" for="to">结束日期</label><input class="input" type="date" id="to" name="to" value="${esc(f.to)}" aria-label="结束日期"></div></div>`;
}
function pageRows(rows) { return rows.slice((state.currentPage - 1) * state.pageSize, state.currentPage * state.pageSize); }
function pagination(total) {
  const pages = Math.ceil(total / state.pageSize);
  return `<div class="pagination"><span class="muted">共 ${total} 条记录</span><div class="pagination-controls"><label class="page-size">每页 <select id="page-size" aria-label="每页条数">${[10,20,50].map(n => `<option ${n === state.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select> 条</label><button class="page-button" data-pagination="${state.currentPage - 1}" ${state.currentPage === 1 ? 'disabled' : ''} aria-label="上一页">${icon('left')}</button>${Array.from({ length:pages }, (_,i) => `<button class="page-button ${i + 1 === state.currentPage ? 'active' : ''}" data-pagination="${i + 1}" ${i + 1 === state.currentPage ? 'aria-current="page"' : ''}>${i + 1}</button>`).join('')}<button class="page-button" data-pagination="${state.currentPage + 1}" ${state.currentPage === pages ? 'disabled' : ''} aria-label="下一页">${icon('chevron')}</button></div></div>`;
}

function filteredBatches() {
  const f = state.filters.batches;
  return queryBatches({ ...f, tenantId:state.customer.id }).filter(b => !f.status || b.status === f.status);
}
function renderBatches() {
  const rows = filteredBatches();
  const f = state.filters.batches;
  const totals = tenantBatches().reduce((a,b) => { const s = getBatchSummary(b.id,state.customer.id); for (const k of Object.keys(a)) a[k] += s[k] || 0; return a; }, { total:0, added:0, restored:0, failed:0 });
  return `${pageHeading('导入记录', '从汇总数字到每一台设备，完整追踪 SN 导入处理结果。', `<button class="button secondary" data-action="export">${icon('down')} 导出批次记录</button>`)}${contextCard()}<div class="notice info"><span class="notice-icon">${icon('info')}</span><div class="notice-text"><strong>导入既是设备报备，也可能触发退权益。</strong><span>新 SN 新增；已导入且未领取的 SN 跳过；已领取的 SN 退权益成功后恢复一次领取资格。退权益会扣减商品额度。</span></div><button class="text-link" data-page="guide">查看规则 ${icon('arrow')}</button></div><div class="summary-strip"><div class="summary-item"><span>累计处理记录</span><strong>${number(totals.total)}<small> 条</small></strong></div><div class="summary-item"><span>新增成功</span><strong>${number(totals.added)}<small> 条</small></strong></div><div class="summary-item"><span>退权益成功</span><strong>${number(totals.restored)}<small> 条</small></strong></div><div class="summary-item"><span>处理失败</span><strong>${number(totals.failed)}<small> 条</small></strong></div></div><section class="panel"><form class="search-form" id="query-form"><div class="filter-row batch-search"><div class="field search-field"><label class="field-label" for="query">批次关键词</label><div class="input-wrap"><span class="input-icon">${icon('search')}</span><input class="input search-input" id="query" name="query" placeholder="批次号 / 文件名 / SN" value="${esc(f.query)}"></div></div>${selectField('status','处理状态',[['','全部状态'],['completed','全部完成'],['partial','部分失败']],f.status)}${dateFields(f,'导入时间')}<div class="filter-actions"><button class="button primary" type="submit">查询</button><button class="button ghost" type="button" data-action="reset-filters">重置</button></div></div><p class="form-error" id="query-error" hidden role="alert"></p></form></section><section class="panel results-panel"><div class="results-header"><div><h2 class="panel-title">导入批次 <span class="tab-count">${rows.length}</span></h2><p class="panel-subtitle">查看批次明细，定位新增、跳过、退权益与失败的具体 SN</p></div></div>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>导入批次 / 文件</th><th>导入时间</th><th>设备条数</th><th>新增 / 跳过</th><th>退权益 / 失败</th><th>处理状态</th><th>操作</th></tr></thead><tbody>${pageRows(rows).map(b => { const s = getBatchSummary(b.id,state.customer.id); return `<tr><td><button class="sn-link mono" data-batch="${esc(b.id)}">${esc(b.id)}</button><span class="cell-secondary">${esc(b.fileName)}</span></td><td class="mono muted">${fmt(b.createdAt)}</td><td><strong>${s.total}</strong></td><td><span class="cell-title">${s.added} 新增</span><span class="cell-secondary">${s.skipped} 跳过</span></td><td><span class="cell-title">${s.restored} 退权益成功</span><span class="cell-secondary ${s.failed ? 'text-danger' : ''}">${s.failed} 失败</span></td><td>${badge(b.status === 'completed' ? '全部完成' : '部分失败', b.status === 'completed' ? 'success' : 'warning')}</td><td><button class="text-link" data-batch="${esc(b.id)}">查看明细 ${icon('chevron')}</button></td></tr>`; }).join('')}</tbody></table></div>${pagination(rows.length)}` : empty()}</section><div class="footer-note">${icon('info')} 批次条数为逐次处理的历史记录，同一 SN 可以出现在多个批次中。</div>`;
}

function renderOrders() {
  const f = state.filters.orders;
  const rows = queryOrders({ ...f, tenantId:state.customer.id });
  return `${pageHeading('订单记录', '关联设备、领取订单与资金退款，查清每一笔权益的来源。', `<button class="button secondary" data-action="export">${icon('down')} 导出订单记录</button>`)}${contextCard()}<div class="notice info"><span class="notice-icon">${icon('info')}</span><div class="notice-text"><strong>订单退款与退权益是两条独立记录。</strong><span>本页“退款状态”指资金退款；导入触发的退权益与资格恢复，请在导入记录和 SN 详情中查询。</span></div></div><section class="panel"><form class="search-form" id="query-form"><div class="search-row"><div class="input-wrap"><label class="sr-only" for="query">订单关键词</label><span class="input-icon">${icon('search')}</span><input class="input search-input" name="query" id="query" placeholder="输入 SN、第三方订单号、喜马拉雅订单号或用户 ID" value="${esc(f.query)}"></div><button class="button primary" type="submit">${icon('search')} 查询</button><button class="button ghost" type="button" data-action="reset-filters">重置</button></div><div class="filter-row">${selectField('status','订单状态',[['','全部状态'],['success','下单成功'],['closed','已关闭']],f.status)}${selectField('refundStatus','资金退款状态',[['','全部状态'],['none','无退款'],['processing','退款处理中'],['success','退款成功']],f.refundStatus)}${dateFields(f,'下单时间')}</div><p class="form-error" id="query-error" hidden role="alert"></p></form></section><section class="panel results-panel"><div class="results-header"><div><h2 class="panel-title">关联订单 <span class="tab-count">${rows.length}</span></h2><p class="panel-subtitle">所有记录均限定在当前 appkey 下</p></div></div>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>SN / 用户 ID</th><th>第三方 / 喜马拉雅订单号</th><th>权益名称</th><th>订单状态</th><th>资金退款</th><th>下单时间</th><th>操作</th></tr></thead><tbody>${pageRows(rows).map(o => `<tr><td><button class="sn-link mono" data-device="${esc(o.sn)}">${esc(o.sn)}</button><span class="cell-secondary mono">用户 ${esc(o.userId || '—')}</span></td><td><span class="cell-title mono" title="${esc(o.thirdPartyOrderId)}">${esc(o.thirdPartyOrderId)}</span><span class="cell-secondary mono" title="${esc(o.platformOrderId)}">${esc(o.platformOrderId)}</span></td><td>${esc(o.benefitName)}</td><td>${badge(o.status === 'success' ? '下单成功' : '已关闭',o.status === 'success' ? 'success' : 'neutral')}</td><td>${refundBadge(o.refundStatus)}</td><td class="mono muted">${fmt(o.createdAt)}</td><td><button class="text-link" data-order="${esc(o.id)}">详情 ${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>${pagination(rows.length)}` : empty()}</section>`;
}
function refundBadge(status) { return badge({ none:'无退款', success:'退款成功', processing:'退款处理中' }[status],{ none:'neutral', success:'info', processing:'warning' }[status]); }

function renderGuide() {
  return `${pageHeading('让每台设备的权益清晰可查', '从 appkey 进入客户空间，再从 SN 追溯权益与导入记录。')}<section class="intro-card"><span class="stat-icon green">${icon('sparkle')}</span><div><h2>当前为交互演示版</h2><p>所有客户、设备、订单和处理结果均为虚构数据。支持查询、筛选、查看详情及 CSV 导出；查询操作不会变更任何权益。</p></div><button class="button primary" data-page="devices">开始查询 ${icon('arrow')}</button></section><section class="feature-grid"><article class="feature-card"><span class="stat-icon green">${icon('key')}</span><h3>01 / 选择客户空间</h3><p>点击“切换 appkey”，手动输入客户 appkey。客户之间以 appkey 区分，同一 SN 可以出现在不同客户下。</p></article><article class="feature-card"><span class="stat-icon blue">${icon('chip')}</span><h3>02 / 查询 SN 权益</h3><p>单个 SN 支持模糊查询。批量查询可下载 Excel 模板，填写 SN 后上传，按完整 SN 匹配。</p></article><article class="feature-card"><span class="stat-icon amber">${icon('layers')}</span><h3>03 / 追溯导入结果</h3><p>在导入批次里查看逐台结果，确认具体哪些 SN 新增、跳过、退权益成功或失败，并导出清单。</p></article></section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">导入处理规则</h2><p class="panel-subtitle">导入接口同时承担 SN 白名单写入与退货补领</p></div></div><div class="rule-flow"><div class="rule-step"><span class="badge success">新 SN</span><h3>新增白名单记录</h3><p>获得一次初始化权益领取资格，领取后该资格被消耗。</p></div><div class="rule-step"><span class="badge neutral">已导入 · 未领取</span><h3>跳过重复记录</h3><p>不重复新增，保留当前领取资格与状态。</p></div><div class="rule-step"><span class="badge warning">已导入 · 已领取</span><h3>退权益并恢复资格</h3><p>退权益成功后恢复一次领取机会，扣减商品 ID 额度。</p></div></div><div class="notice warning" style="margin:0 24px 24px"><span class="notice-icon">${icon('info')}</span><div class="notice-text"><strong>退权益与真实退款分别追踪</strong><span>恢复领取资格并不代表产生资金退款；也不能仅凭订单状态判断权益是否生效。再次领取次数上限及额度规则待真实接口确认。</span></div></div></section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">可使用的演示 appkey</h2><p class="panel-subtitle">以下凭证仅用于切换模拟客户，不对应真实业务系统</p></div></div><div class="sample-keys">${customers.map(c => `<div class="sample-key"><div><strong>${esc(c.name)}</strong><code>${esc(c.appkey)}</code></div><button class="button secondary small" data-customer="${esc(c.id)}">进入查询 ${icon('arrow')}</button></div>`).join('')}</div></section>`;
}

function detailField(label, value, wide = false) { return `<div class="detail-field ${wide ? 'full-width' : ''}"><div class="detail-label">${label}</div><div class="detail-value">${value}</div></div>`; }
function deviceDetail(sn) {
  const found = getDeviceDetail(state.customer.id,sn);
  if (!found) return '<div class="empty-state"><h3>当前客户下未找到该设备</h3></div>';
  const { device:d, orders:os, events:es, batchItems:items } = found;
  return `<div class="detail-title"><span class="stat-icon green">${icon('chip')}</span><div><span class="detail-label">SN 设备号</span><h2 class="detail-sn mono">${esc(d.sn)} ${copyButton(d.sn,'复制 SN')}</h2></div></div><div class="detail-section"><div class="detail-grid">${detailField('领取状态',claimBadge(d.claimStatus))}${detailField('权益状态',benefitBadge(d.benefitStatus))}${detailField('当前可领取次数',`<strong>${d.remainingClaims}</strong> 次`)}${detailField('历史领取次数',`${d.claimCount} 次`)}${detailField('权益名称',esc(d.benefitName))}${detailField('关联商品',`${esc(d.productName)}<span class="cell-secondary mono">${esc(d.productId)}</span>`)}${detailField('权益开始时间',fmt(d.startAt))}${detailField('权益结束时间',fmt(d.endAt))}${detailField('最近领取用户',`<span class="mono">${esc(d.userId || '—')}</span>`)}${detailField('最近更新时间',fmt(d.updatedAt))}</div></div>${d.claimStatus === 'restored' ? `<div class="notice warning"><span class="notice-icon">${icon('refresh')}</span><div class="notice-text"><strong>该设备已退权益，当前可重新领取一次</strong><span>历史领取记录保留；恢复资格不代表发生资金退款。</span></div></div>` : ''}<section class="detail-section"><div class="section-heading"><h3>权益流转记录</h3><span class="muted">${es.length} 条</span></div><div class="timeline">${[...es].sort((a,b) => String(b.at).localeCompare(String(a.at))).map((e,i) => `<div class="timeline-item"><span class="timeline-dot ${i === 0 ? 'current' : ''}"></span><div class="timeline-time mono">${fmt(e.at)}</div><strong class="timeline-title">${esc(e.title)}</strong><p class="timeline-description">${esc(e.description)}</p></div>`).join('') || '<p class="muted">暂无流转记录</p>'}</div></section><section class="detail-section"><div class="section-heading"><h3>关联订单</h3><button class="text-link" data-orders-for="${esc(d.sn)}">查看全部 ${icon('arrow')}</button></div>${os.length ? os.map(o => `<div class="linked-record"><div><button class="text-link mono" data-order="${esc(o.id)}">${esc(o.platformOrderId)}</button><span class="cell-secondary">${fmt(o.createdAt)} · ${esc(o.benefitName)}</span></div>${refundBadge(o.refundStatus)}</div>`).join('') : '<p class="muted">尚未领取，暂无关联订单</p>'}</section><section class="detail-section"><div class="section-heading"><h3>导入处理历史</h3><span class="muted">${items.length} 次</span></div>${items.map(i => `<div class="linked-record"><div><button class="text-link mono" data-batch="${esc(i.batchId)}">${esc(i.batchId)}</button><span class="cell-secondary">${fmt(i.processedAt)} · 额度扣减 ${i.quotaUsed}</span></div>${resultBadge(i.result)}</div>`).join('') || '<p class="muted">暂无导入记录</p>'}</section>`;
}

function batchDetail(id) {
  const b = batches.find(b => b.id === id && b.tenantId === state.customer.id);
  if (!b) return '';
  const s = getBatchSummary(id,state.customer.id);
  const items = batchItems.filter(i => i.batchId === id && i.tenantId === state.customer.id);
  const filtered = items.filter(i => !state.batchFilter || i.result === state.batchFilter);
  return `<div class="batch-banner"><span class="stat-icon green">${icon('layers')}</span><div><h2 class="detail-sn mono">${esc(b.id)}</h2><p class="muted">${esc(b.fileName)} · ${fmt(b.createdAt)}</p></div>${badge(b.status === 'completed' ? '全部完成' : '部分失败',b.status === 'completed' ? 'success' : 'warning')}</div><div class="summary-strip compact">${[['total','设备条数'],['added','新增'],['skipped','跳过'],['restored','退权益成功'],['failed','失败']].map(([key,label]) => `<div class="summary-item"><span>${label}</span><strong>${s[key]}</strong></div>`).join('')}</div><div class="notice info"><span class="notice-icon">${icon('info')}</span><div class="notice-text"><strong>本批次扣减商品额度 ${s.quotaUsed} 份</strong><span>退权益成功的 SN 恢复一次领取机会。以下状态为该批次处理时的历史快照。</span></div></div><div class="results-header" style="padding-left:0;padding-right:0"><div class="segmented" role="group" aria-label="筛选批次处理结果">${[['','全部'],...Object.entries(resultNames)].map(([key,label]) => `<button class="tab ${state.batchFilter === key ? 'active' : ''}" data-batch-filter="${key}">${label}${key ? ` ${s[key]}` : ` ${s.total}`}</button>`).join('')}</div><button class="button secondary small" data-action="export-batch">${icon('down')} 导出明细</button></div>${filtered.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>SN 设备号</th><th>处理结果</th><th>处理前 → 处理后</th><th>扣减额度</th><th>结果说明</th></tr></thead><tbody>${filtered.map(i => `<tr><td><button class="sn-link mono" data-device="${esc(i.sn)}">${esc(i.sn)}</button></td><td>${resultBadge(i.result)}</td><td><span class="cell-secondary">${esc(snapshotName(i.beforeStatus))}</span><span class="cell-title">→ ${esc(snapshotName(i.afterStatus))}</span></td><td>${i.quotaUsed}</td><td class="reason-cell">${esc(i.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><h3>该批次没有此类处理记录</h3></div>'}`;
}
function snapshotName(status) { return ({ ...claimNames, absent:'未导入', missing:'未导入', unknown:'未确认', not_imported:'未导入', not_exists:'未导入', unchanged:'保持不变' })[status] || status || '—'; }
function orderDetail(id) {
  const o = orders.find(o => o.id === id && o.tenantId === state.customer.id);
  if (!o) return '';
  return `<div class="detail-title"><span class="stat-icon blue">${icon('file')}</span><div><span class="detail-label">喜马拉雅订单号</span><h2 class="detail-sn mono">${esc(o.platformOrderId)}</h2></div></div><div class="detail-grid">${detailField('订单状态',badge(o.status === 'success' ? '下单成功' : '已关闭',o.status === 'success' ? 'success' : 'neutral'))}${detailField('资金退款状态',refundBadge(o.refundStatus))}${detailField('SN 设备号',`<button class="text-link mono" data-device="${esc(o.sn)}">${esc(o.sn)}</button>`)}${detailField('权益名称',esc(o.benefitName))}${detailField('第三方订单号',`<span class="mono">${esc(o.thirdPartyOrderId)}</span>${copyButton(o.thirdPartyOrderId)}`,true)}${detailField('喜马拉雅订单号',`<span class="mono">${esc(o.platformOrderId)}</span>${copyButton(o.platformOrderId)}`,true)}${detailField('活动码',`<span class="mono">${esc(o.activityCode)}</span>`,true)}${detailField('用户 ID',`<span class="mono">${esc(o.userId)}</span>`)}${detailField('下单时间',fmt(o.createdAt))}${detailField('订单金额',money(o.amount))}${detailField('分成比例',`${(o.shareRatio * 100).toFixed(0)}%`)}</div><div class="notice info" style="margin-top:24px"><span class="notice-icon">${icon('info')}</span><div class="notice-text"><strong>本页退款状态表示资金退款</strong><span>设备的实际权益状态和退权益记录，请进入 SN 详情查看。</span></div></div>`;
}

function showOverlay(type, id = '') {
  if (!state.overlay) state.returnFocus = document.activeElement;
  state.overlay = { type,id };
  if (type === 'batch') state.batchFilter = '';
  renderOverlay();
  requestAnimationFrame(() => document.querySelector(type === 'key' ? '#appkey' : '#overlay-root .close-button')?.focus());
}
function renderOverlay() {
  const o = state.overlay;
  if (!o) { document.getElementById('overlay-root').innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  if (o.type === 'key') {
    document.getElementById('overlay-root').innerHTML = `<div class="modal-backdrop" data-backdrop="true"><section class="modal small" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-header"><div><h2 id="dialog-title">切换客户 appkey</h2><p class="panel-subtitle">输入 appkey，进入对应客户的查询空间</p></div><button class="close-button" data-action="close-overlay" aria-label="关闭">${icon('close')}</button></div><form id="key-form"><div class="modal-body"><label class="field-label" for="appkey">客户 appkey</label><input class="input key-input mono" id="appkey" name="appkey" placeholder="请输入完整 appkey" value="${esc(state.customer.appkey)}" autocomplete="off" spellcheck="false"><p class="form-error" id="key-error" role="alert" hidden></p><p class="sub-text">演示版仅支持以下模拟 appkey，点击可自动填入。</p><div class="sample-keys">${customers.map(c => `<button type="button" class="sample-key" data-sample-key="${esc(c.appkey)}"><span><strong>${esc(c.name)}</strong><code>${esc(c.appkey)}</code></span>${icon('arrow')}</button>`).join('')}</div></div><div class="modal-footer"><button class="button secondary" type="button" data-action="close-overlay">取消</button><button class="button primary" type="submit">进入查询空间 ${icon('arrow')}</button></div></form></section></div>`;
    return;
  }
  const title = { device:'设备权益详情', batch:'导入批次明细', order:'订单详情' }[o.type];
  document.getElementById('overlay-root').innerHTML = `<div class="drawer-backdrop" data-backdrop="true"><section class="drawer ${o.type === 'batch' ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="drawer-header"><div><span class="eyebrow">${esc(state.customer.name)}</span><h2 id="dialog-title">${title}</h2></div><button class="close-button" data-action="close-overlay" aria-label="关闭详情">${icon('close')}</button></div><div class="drawer-body">${o.type === 'device' ? deviceDetail(o.id) : o.type === 'batch' ? batchDetail(o.id) : orderDetail(o.id)}</div></section></div>`;
}
function closeOverlay() { const focus = state.returnFocus; state.overlay = null; renderOverlay(); if (focus?.isConnected) focus.focus(); }
function changeCustomer(c) { state.customer = c; state.upload = initialUpload(); state.filters = initialFilters(); state.currentPage = 1; state.overlay = null; renderOverlay(); render(); toast(`已切换至${c.name}`); }
function navigate(page) { state.page = page; state.currentPage = 1; closeOverlay(); render(); window.scrollTo({ top:0, behavior:'instant' }); }
let toastTimer;
function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000); }

const deviceColumns = [{key:'sn',label:'SN 设备号'},{key:'productId',label:'商品ID'},{key:'productName',label:'商品名称'},{key:'benefitName',label:'权益名称'},{key:'claimStatus',label:'领取状态'},{key:'benefitStatus',label:'权益状态'},{key:'startAt',label:'权益开始时间'},{key:'endAt',label:'权益结束时间'},{key:'userId',label:'领取用户ID'},{key:'remainingClaims',label:'当前可领取次数'},{key:'createdAt',label:'首次导入时间'}];
function downloadCsv(rows, columns, name) {
  if (!rows.length) { toast('没有可导出的记录'); return; }
  const csv = toCsv(rows,columns);
  const url = URL.createObjectURL(new Blob([csv],{ type:'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `${name}_20261015.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000); toast(`已导出 ${rows.length} 条记录`);
}
function exportRows(batch = false) {
  if (batch && state.overlay?.type === 'batch') {
    const rows = batchItems.filter(i => i.tenantId === state.customer.id && i.batchId === state.overlay.id && (!state.batchFilter || i.result === state.batchFilter)).map(i => ({ ...i,result:resultNames[i.result],beforeStatus:snapshotName(i.beforeStatus),afterStatus:snapshotName(i.afterStatus) }));
    downloadCsv(rows,[{key:'batchId',label:'导入批次'},{key:'sn',label:'SN'},{key:'result',label:'处理结果'},{key:'beforeStatus',label:'处理前状态'},{key:'afterStatus',label:'处理后状态'},{key:'quotaUsed',label:'扣减商品额度'},{key:'reason',label:'结果说明'},{key:'processedAt',label:'处理时间'}],`${state.customer.name}_${state.overlay.id}`); return;
  }
  if (state.page === 'devices') { const rows = queryDevices({ ...state.filters.devices,tenantId:state.customer.id,exactMatch:state.queryMode === 'batch' }).map(d => ({ ...d,claimStatus:claimNames[d.claimStatus],benefitStatus:benefitNames[d.benefitStatus] })); downloadCsv(rows,deviceColumns,`${state.customer.name}_SN权益`); }
  else if (state.page === 'batches') { const rows = filteredBatches().map(b => ({ ...b,...getBatchSummary(b.id,state.customer.id),status:b.status === 'completed' ? '全部完成' : '部分失败' })); downloadCsv(rows,[{key:'id',label:'批次号'},{key:'fileName',label:'文件名'},{key:'createdAt',label:'导入时间'},{key:'total',label:'设备条数'},{key:'added',label:'新增成功'},{key:'skipped',label:'跳过'},{key:'restored',label:'退权益成功'},{key:'failed',label:'处理失败'},{key:'quotaUsed',label:'额度扣减'},{key:'status',label:'批次状态'}],`${state.customer.name}_导入批次`); }
  else if (state.page === 'orders') { const rows = queryOrders({ ...state.filters.orders,tenantId:state.customer.id }).map(o => ({ ...o,status:o.status === 'success' ? '下单成功' : '已关闭',refundStatus:{ none:'无退款',success:'退款成功',processing:'退款处理中' }[o.refundStatus] })); downloadCsv(rows,[{key:'sn',label:'SN'},{key:'thirdPartyOrderId',label:'第三方订单号'},{key:'platformOrderId',label:'喜马拉雅订单号'},{key:'userId',label:'用户ID'},{key:'activityCode',label:'活动码'},{key:'benefitName',label:'权益名称'},{key:'status',label:'订单状态'},{key:'refundStatus',label:'资金退款状态'},{key:'createdAt',label:'下单时间'},{key:'shareRatio',label:'分成比例'}],`${state.customer.name}_订单记录`); }
}

document.addEventListener('click', async event => {
  const el = event.target.closest('button, a, [data-backdrop]');
  if (!el) return;
  if (el.matches('a[href="#"]')) event.preventDefault();
  if (el.dataset.backdrop && event.target === el) { closeOverlay(); return; }
  if (el.dataset.page) { navigate(el.dataset.page); return; }
  if (el.dataset.customer) { const c = customers.find(c => c.id === el.dataset.customer); if (c) { changeCustomer(c); navigate('devices'); } return; }
  if (el.dataset.sampleKey) { document.getElementById('appkey').value = el.dataset.sampleKey; document.getElementById('key-error').hidden = true; return; }
  if (el.dataset.copy) { try { await navigator.clipboard.writeText(el.dataset.copy); toast('已复制到剪贴板'); } catch { toast('当前环境无法复制，请手动选择文本'); } return; }
  if (el.dataset.device) { showOverlay('device',el.dataset.device); return; }
  if (el.dataset.batch) { showOverlay('batch',el.dataset.batch); return; }
  if (el.dataset.order) { showOverlay('order',el.dataset.order); return; }
  if (el.dataset.ordersFor) { state.filters.orders = { ...initialFilters().orders,query:el.dataset.ordersFor }; navigate('orders'); return; }
  if (el.dataset.queryMode) { state.upload = initialUpload(); state.queryMode = el.dataset.queryMode; state.filters.devices.query = ''; state.currentPage = 1; render(); return; }
  if ('stat' in el.dataset) { state.queryMode = 'single'; state.upload = initialUpload(); state.filters.devices = { ...initialFilters().devices,claimStatus:el.dataset.stat === 'all' ? '' : el.dataset.stat }; state.currentPage = 1; render(); return; }
  if ('batchFilter' in el.dataset) { state.batchFilter = el.dataset.batchFilter; renderOverlay(); document.querySelector(`[data-batch-filter="${state.batchFilter}"]`)?.focus(); return; }
  if (el.dataset.pagination) { state.currentPage = Number(el.dataset.pagination); render(); return; }
  if (el.dataset.action === 'select-file') document.getElementById('sn-file')?.click();
  if (el.dataset.action === 'clear-upload') { state.upload = initialUpload(); state.filters.devices.query = ''; state.currentPage = 1; render(); }
  if (el.dataset.action === 'switch-key') showOverlay('key');
  if (el.dataset.action === 'close-overlay') closeOverlay();
  if (el.dataset.action === 'reset-filters') { if (state.page === 'devices') state.upload = initialUpload(); state.filters[state.page] = initialFilters()[state.page]; state.currentPage = 1; render(); }
  if (el.dataset.action === 'export') exportRows();
  if (el.dataset.action === 'export-batch') exportRows(true);
});

document.addEventListener('submit', event => {
  if (event.target.id === 'key-form') {
    event.preventDefault();
    const key = new FormData(event.target).get('appkey').trim();
    const c = resolveCustomer(key);
    if (!c) { const error = document.getElementById('key-error'); error.textContent = key ? '未找到该 appkey。演示版请使用下方提供的模拟 appkey。' : '请输入客户 appkey。'; error.hidden = false; return; }
    changeCustomer(c); return;
  }
  if (event.target.id !== 'query-form') return;
  event.preventDefault();
  const f = Object.fromEntries(new FormData(event.target));
  const error = document.getElementById('query-error');
  if (f.from && f.to && f.from > f.to) { error.textContent = '起始日期不能晚于结束日期。'; error.hidden = false; return; }
  if (state.page === 'devices' && state.queryMode === 'batch') {
    if (state.upload.status !== 'ready') { error.textContent = '请先上传填写好的 SN 查询表格。'; error.hidden = false; return; }
    const tokens = [...new Set(f.query.split(/[\s,，;；]+/).filter(Boolean))];
    if (tokens.length > 100) { error.textContent = '每次最多查询 100 个 SN，请减少数量后重试。'; error.hidden = false; return; }
    f.query = tokens.join('\n');
  }
  state.filters[state.page] = f; state.currentPage = 1; render();
});
document.addEventListener('change', event => { if (event.target.id === 'sn-file') { handleSnFile(event.target.files[0]); return; } if (event.target.id === 'page-size') { state.pageSize = Number(event.target.value); state.currentPage = 1; render(); } });
document.addEventListener('dragover', event => { if (event.target.closest('#upload-zone')) { event.preventDefault(); event.target.closest('#upload-zone').classList.add('dragover'); } });
document.addEventListener('dragleave', event => { const zone = event.target.closest('#upload-zone'); if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('dragover'); });
document.addEventListener('drop', event => { const zone = event.target.closest('#upload-zone'); if (!zone) return; event.preventDefault(); zone.classList.remove('dragover'); if (event.dataTransfer.files.length !== 1) { toast('每次请选择一个表格文件'); return; } handleSnFile(event.dataTransfer.files[0]); });
document.addEventListener('keydown', event => {
  if (!state.overlay) return;
  if (event.key === 'Escape') { closeOverlay(); return; }
  if (event.key === 'Tab') {
    const focusables = [...document.querySelectorAll('#overlay-root button:not([disabled]), #overlay-root input, #overlay-root a[href], #overlay-root select')].filter(el => el.getClientRects().length);
    const first = focusables[0], last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
render();
