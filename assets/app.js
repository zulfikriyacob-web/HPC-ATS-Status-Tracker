/* ===========================================================
   Production WO Status Tracker — app logic
   =========================================================== */

// ----------------------------------------------------------------
// CONFIG — paste your Google Apps Script Web App URL here once
// deployed (see README.md, Step 3). Leave blank to stay in DEMO MODE
// (reads/writes only affect this browser tab, nothing is saved).
// ----------------------------------------------------------------
const CONFIG = {
  APPS_SCRIPT_URL: "", // e.g. "https://script.google.com/macros/s/AKfycb.../exec"
};

const PROD_STATUS_OPTIONS = [
  "Not Started", "In Progress", "Completed",
  "Delayed - Part Shortage", "Delayed - Late Incoming Parts",
  "Delayed - Machine/Jig", "Delayed - Manpower", "Delayed - Other"
];
const DELIVERY_STATUS_OPTIONS = ["Pending", "On Time", "Delayed", "Delivered"];

let RECORDS = [];
let LIVE_MODE = false;

// ----------------------------------------------------------------
// Boot
// ----------------------------------------------------------------
async function boot(){
  if (CONFIG.APPS_SCRIPT_URL) {
    try {
      const res = await fetch(CONFIG.APPS_SCRIPT_URL + "?action=list");
      const json = await res.json();
      RECORDS = json.data || json;
      LIVE_MODE = true;
    } catch (err) {
      console.error("Gagal connect Google Sheet, fallback ke demo data.", err);
      RECORDS = DEMO_DATA.slice();
      LIVE_MODE = false;
    }
  } else {
    RECORDS = DEMO_DATA.slice();
    LIVE_MODE = false;
  }
  updateConnIndicator();
  populateFilters();
  populateTrendLineFilter();
  bindEvents();
  bindTabs();
  render();
}

function bindTabs(){
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.hidden = true);
      document.getElementById(`view-${view}`).hidden = false;
      if (view === 'summary') renderSummary();
      if (view === 'trend') renderTrend();
    });
  });
}

function updateConnIndicator(){
  const dot = document.getElementById('connDot');
  const lbl = document.getElementById('connLabel');
  if (LIVE_MODE){
    dot.className = 'conn-dot live';
    lbl.textContent = 'LIVE — connected ke Google Sheet';
  } else {
    dot.className = 'conn-dot demo';
    lbl.textContent = "DEMO MODE — data dari snapshot JULY'26 (edit tak disimpan)";
  }
}

// ----------------------------------------------------------------
// Derived field calculations (mirrors the Excel formulas)
// ----------------------------------------------------------------
function todayISO(){
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseDate(s){
  if (!s || s === 'TBA' || s === 'NO PLAN') return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d) ? null : d;
}
function daysBetween(a, b){
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}
function fmtDate(s){
  const d = parseDate(s);
  if (!d) return s || '—';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' });
}

function deriveRow(r){
  const wo = Number(r.WOQty) || 0;
  const so = r.SOQty === '' || r.SOQty == null ? null : Number(r.SOQty);
  const produced = r.QtyProduced === '' || r.QtyProduced == null ? null : Number(r.QtyProduced);
  const prodDate = parseDate(r.ProdDate);
  const diDate = parseDate(r.DIDate);
  const today = todayISO();

  const qtyNotReleased = so === null ? null : (so - wo);
  const bufferDays = (prodDate && diDate) ? daysBetween(diDate, prodDate) : null;
  const carryFwd = produced === null ? wo : Math.max(wo - produced, 0);
  const daysToDI = diDate ? daysBetween(diDate, today) : null;
  const isOverdue = (daysToDI !== null && daysToDI < 0 && r.ProductionStatus !== 'Completed');

  return { ...r, _qtyNotReleased: qtyNotReleased, _bufferDays: bufferDays,
           _carryFwd: carryFwd, _daysToDI: daysToDI, _overdue: isOverdue };
}

function statusTone(r){
  if (r._overdue) return 'bad';
  const s = r.ProductionStatus || '';
  if (s === 'Completed') return 'ok';
  if (s === 'In Progress') return 'warn';
  if (s.startsWith('Delayed')) return 'bad';
  return 'idle';
}

// ----------------------------------------------------------------
// Filters
// ----------------------------------------------------------------
function populateFilters(){
  const lines = [...new Set(RECORDS.map(r => r.Line))].sort();
  const selLine = document.getElementById('fLine');
  lines.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l; opt.textContent = l;
    selLine.appendChild(opt);
  });
  refreshModelOptions();
}

function refreshModelOptions(){
  const lineVal = document.getElementById('fLine').value;
  const pool = lineVal ? RECORDS.filter(r => r.Line === lineVal) : RECORDS;
  const models = [...new Set(pool.map(r => r.Model))].sort();
  const selModel = document.getElementById('fModel');
  const prev = selModel.value;
  selModel.innerHTML = '<option value="">Semua Model</option>';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    selModel.appendChild(opt);
  });
  if (models.includes(prev)) selModel.value = prev;
}

function bindEvents(){
  document.getElementById('fLine').addEventListener('change', () => { refreshModelOptions(); render(); });
  document.getElementById('fDate').addEventListener('change', render);
  document.getElementById('fModel').addEventListener('change', render);
  document.getElementById('fSearch').addEventListener('input', debounce(render, 200));
  document.getElementById('btnReset').addEventListener('click', () => {
    document.getElementById('fLine').value = '';
    document.getElementById('fDate').value = '';
    document.getElementById('fSearch').value = '';
    refreshModelOptions();
    render();
  });
}

function debounce(fn, ms){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function getFiltered(){
  const line = document.getElementById('fLine').value;
  const date = document.getElementById('fDate').value;
  const model = document.getElementById('fModel').value;
  const search = document.getElementById('fSearch').value.trim().toLowerCase();

  return RECORDS.map(deriveRow).filter(r => {
    if (line && r.Line !== line) return false;
    if (model && r.Model !== model) return false;
    if (date && r.ProdDate !== date) return false;
    if (search){
      const hay = `${r.ItemNo} ${r.DocumentNumber} ${r.ItemDescription} ${r.CustomerRefNo}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

// ----------------------------------------------------------------
// Render
// ----------------------------------------------------------------
function render(){
  const rows = getFiltered();
  renderKPIs(rows);
  renderMeta(rows);
  renderList(rows);
}

function renderMeta(rows){
  const line = document.getElementById('fLine').value || 'semua line';
  const date = document.getElementById('fDate').value;
  const model = document.getElementById('fModel').value;
  let bits = [`${rows.length} WO`, line];
  if (date) bits.push(`Prod Date ${fmtDate(date)}`);
  if (model) bits.push(`Model ${model}`);
  document.getElementById('resultsMeta').textContent = bits.join(' · ');
}

function renderKPIs(rows){
  const totalWO = rows.length;
  const totalQty = rows.reduce((a,r) => a + (Number(r.WOQty)||0), 0);
  const totalOutstanding = rows.reduce((a,r) => a + r._carryFwd, 0);
  const overdueCount = rows.filter(r => r._overdue).length;

  const el = document.getElementById('kpiStrip');
  el.innerHTML = `
    <div class="kpi"><div class="num">${totalWO}</div><div class="lbl">Total WO</div></div>
    <div class="kpi"><div class="num">${totalQty}</div><div class="lbl">Total Qty Plan</div></div>
    <div class="kpi"><div class="num">${totalOutstanding}</div><div class="lbl">Outstanding</div></div>
    <div class="kpi ${overdueCount>0?'bad':'ok'}"><div class="num">${overdueCount}</div><div class="lbl">Overdue</div></div>
  `;
}

function renderList(rows){
  const el = document.getElementById('resultsList');
  if (rows.length === 0){
    el.innerHTML = `<div class="empty-state"><span class="big">Takda WO jumpa</span>Cuba tukar filter Date / Line / Model kat atas.</div>`;
    return;
  }
  el.innerHTML = rows.map(cardHTML).join('');
  rows.forEach(r => {
    const head = document.getElementById(`head-${r.ID}`);
    head.addEventListener('click', () => {
      document.getElementById(`card-${r.ID}`).classList.toggle('open');
    });
    const saveBtn = document.getElementById(`save-${r.ID}`);
    if (saveBtn) saveBtn.addEventListener('click', () => saveRow(r.ID));
  });
}

function dl(label, value, mono){
  const cls = 'dv' + (mono ? ' mono' : '') + (value === '' || value == null ? ' empty' : '');
  return `<div><div class="dl">${label}</div><div class="${cls}">${value === '' || value == null ? '—' : value}</div></div>`;
}

function cardHTML(r){
  const tone = statusTone(r);
  const dueTone = r._daysToDI === null ? '' : (r._daysToDI < 0 ? 'bad' : (r._daysToDI <= 2 ? 'warn' : ''));
  const dueLabel = r._daysToDI === null ? '—' : (r._daysToDI < 0 ? `${Math.abs(r._daysToDI)}h lewat` : `${r._daysToDI}h lagi`);

  return `
  <article class="wo-card" id="card-${r.ID}" data-status-tone="${tone}">
    <div class="wo-head" id="head-${r.ID}">
      <div>
        <div class="wo-id">ID ${r.ID} &middot; ${r.ItemNo}${r.RHside ? ' &middot; ' + r.RHside : ''}</div>
        <div class="wo-sub">
          <span>Model <b>${r.Model}</b></span>
          <span>WO Qty <b>${r.WOQty}</b></span>
          <span>Prod <b>${fmtDate(r.ProdDate)}</b></span>
          <span>DI <b>${fmtDate(r.DIDate)}</b></span>
        </div>
        <p class="wo-title">${r.ItemDescription}</p>
      </div>
      <div class="wo-right">
        <span class="line-chip">${r.Line}</span>
        <span class="status-pill ${tone}">${r.ProductionStatus}</span>
        <span class="wo-days ${dueTone}">DI: <b>${dueLabel}</b></span>
      </div>
    </div>

    <div class="wo-detail">
      <div class="detail-grid">
        ${dl('Customer', r.Customer)}
        ${dl('Document No.', r.DocumentNumber, true)}
        ${dl('Customer Ref No.', r.CustomerRefNo, true)}
        ${dl('Camera', r.Camera)}
        ${dl('Variant', r.Variant)}
        ${dl('SO Qty', r.SOQty, true)}
        ${dl('WO Qty', r.WOQty, true)}
        ${dl('Qty Not Released', r._qtyNotReleased, true)}
        ${dl('Buffer (days)', r._bufferDays, true)}
        ${dl('ETA Demand', fmtDate(r.ETADemand), true)}
        ${dl('Carry Fwd Qty', r._carryFwd, true)}
        ${dl('Delivery Status', r.DeliveryStatus)}
      </div>

      <div class="edit-section">
        <div class="section-lbl">Key-in / Update</div>
        <div class="edit-grid">
          <div class="field">
            <label>Actual Prod Date</label>
            <input type="date" id="actprod-${r.ID}" value="${r.ActualProdDate||''}">
          </div>
          <div class="field">
            <label>Qty Produced</label>
            <input type="number" min="0" id="qtyprod-${r.ID}" value="${r.QtyProduced||''}">
          </div>
          <div class="field">
            <label>Production Status</label>
            <select id="status-${r.ID}">
              ${PROD_STATUS_OPTIONS.map(o => `<option value="${o}" ${o===r.ProductionStatus?'selected':''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Date Adjustment</label>
            <input type="date" id="dateadj-${r.ID}" value="${r.DateAdjustment||''}">
          </div>
          <div class="field">
            <label>Delivery Status</label>
            <select id="delstatus-${r.ID}">
              ${DELIVERY_STATUS_OPTIONS.map(o => `<option value="${o}" ${o===r.DeliveryStatus?'selected':''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="grid-column: span 2;">
            <label>Remarks / Delay Reason</label>
            <input type="text" id="remarks-${r.ID}" value="${(r.Remarks||'').replace(/"/g,'&quot;')}" placeholder="cth: part shortage cord GR">
          </div>
        </div>
        <div class="edit-actions">
          <button class="btn" id="save-${r.ID}">Save</button>
          <span class="save-msg" id="msg-${r.ID}">Disimpan ✓</span>
        </div>
      </div>
    </div>
  </article>`;
}

// ----------------------------------------------------------------
// Save (write-back)
// ----------------------------------------------------------------
async function saveRow(id){
  const payload = {
    ID: id,
    ActualProdDate: document.getElementById(`actprod-${id}`).value,
    QtyProduced: document.getElementById(`qtyprod-${id}`).value,
    ProductionStatus: document.getElementById(`status-${id}`).value,
    DateAdjustment: document.getElementById(`dateadj-${id}`).value,
    DeliveryStatus: document.getElementById(`delstatus-${id}`).value,
    Remarks: document.getElementById(`remarks-${id}`).value,
  };

  // update local copy immediately (optimistic UI)
  const idx = RECORDS.findIndex(r => r.ID === id);
  if (idx > -1) RECORDS[idx] = { ...RECORDS[idx], ...payload };

  if (LIVE_MODE){
    try {
      await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight on Apps Script
        body: JSON.stringify({ action: 'update', ...payload }),
      });
    } catch (err){
      console.error('Gagal save ke Google Sheet:', err);
      alert('Gagal simpan ke Google Sheet — check sambungan internet / Apps Script URL.');
      return;
    }
  }

  const msg = document.getElementById(`msg-${id}`);
  msg.textContent = LIVE_MODE ? 'Disimpan ke Google Sheet ✓' : 'Disimpan (demo, tak persist) ✓';
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2500);
  render();
}

boot();

// ==================================================================
// DAILY SUMMARY VIEW — mirrors the Excel "ALL LINES - Daily Summary"
// sheet: one section per Line, grouped by Prod Date.
// ==================================================================
function computeLineSummary(lineRecords){
  const derived = lineRecords.map(deriveRow);
  const scheduled = derived.filter(r => r.ProdDate !== 'TBA' && r.ProdDate !== 'NO PLAN');
  const unscheduled = derived.filter(r => r.ProdDate === 'TBA' || r.ProdDate === 'NO PLAN');

  const dates = [...new Set(scheduled.map(r => r.ProdDate))].sort();
  let cumBacklog = 0;
  const dateRows = dates.map(d => {
    const group = scheduled.filter(r => r.ProdDate === d);
    const totalQty = group.reduce((a,r) => a + (Number(r.WOQty)||0), 0);
    const produced = group.reduce((a,r) => a + (Number(r.QtyProduced)||0), 0);
    const carryFwd = group.reduce((a,r) => a + r._carryFwd, 0);
    cumBacklog += carryFwd;
    const diDates = group.map(r => parseDate(r.DIDate)).filter(Boolean);
    const nearestDI = diDates.length ? new Date(Math.min(...diDates)) : null;
    const pct = totalQty === 0 ? null : produced / totalQty;
    return { date: d, count: group.length, totalQty, produced, carryFwd, cumBacklog, nearestDI, pct };
  });

  const unschedCount = unscheduled.length;
  const unschedQty = unscheduled.reduce((a,r) => a + (Number(r.WOQty)||0), 0);

  const kpi = {
    totalWO: derived.length,
    totalQty: derived.reduce((a,r) => a + (Number(r.WOQty)||0), 0),
    produced: derived.reduce((a,r) => a + (Number(r.QtyProduced)||0), 0),
    outstanding: derived.reduce((a,r) => a + r._carryFwd, 0),
  };

  return { dateRows, unschedCount, unschedQty, kpi };
}

function renderSummary(){
  const lines = [...new Set(RECORDS.map(r => r.Line))].sort();
  const root = document.getElementById('summaryRoot');
  root.innerHTML = lines.map(line => {
    const lineRecords = RECORDS.filter(r => r.Line === line);
    const s = computeLineSummary(lineRecords);
    return summarySectionHTML(line, s);
  }).join('');
}

function summarySectionHTML(line, s){
  const rowsHTML = s.dateRows.map(r => {
    const cls = r.carryFwd > 0 ? 'row-warn' : 'row-ok';
    const flag = r.carryFwd > 0
      ? `<span class="flag-bad">&#9888; Ada backlog ${r.carryFwd} unit</span>`
      : `<span class="flag-ok">OK</span>`;
    return `<tr class="${cls}">
      <td class="left">${fmtDate(r.date)} <span style="color:#9a9382;">(${new Date(r.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short'})})</span></td>
      <td>${r.count}</td>
      <td>${r.totalQty}</td>
      <td>${r.produced}</td>
      <td>${r.carryFwd}</td>
      <td>${r.cumBacklog}</td>
      <td>${r.nearestDI ? fmtDate(r.nearestDI.toISOString().slice(0,10)) : '—'}</td>
      <td>${r.pct === null ? '—' : Math.round(r.pct*100)+'%'}</td>
      <td class="left">${flag}</td>
    </tr>`;
  }).join('');

  const unschedHTML = `<tr class="unsched">
    <td class="left">BELUM DIJADUALKAN</td>
    <td>${s.unschedCount}</td>
    <td>${s.unschedQty}</td>
    <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
    <td class="left">${s.unschedCount > 0 ? '<span class="flag-bad">&#9888; Belum ada Prod Date</span>' : ''}</td>
  </tr>`;

  const totalHTML = `<tr class="total-row">
    <td class="left">JUMLAH KESELURUHAN</td>
    <td>${s.kpi.totalWO}</td>
    <td>${s.kpi.totalQty}</td>
    <td>${s.kpi.produced}</td>
    <td>${s.kpi.outstanding}</td>
    <td>—</td><td>—</td>
    <td>${s.kpi.totalQty===0?'—':Math.round(s.kpi.produced/s.kpi.totalQty*100)+'%'}</td>
    <td></td>
  </tr>`;

  return `
  <div class="summary-section">
    <h2>${line} Line</h2>
    <div class="summary-kpis">
      <div class="kpi"><div class="num">${s.kpi.totalWO}</div><div class="lbl">Total WO</div></div>
      <div class="kpi"><div class="num">${s.kpi.totalQty}</div><div class="lbl">Total Qty Plan</div></div>
      <div class="kpi"><div class="num">${s.kpi.produced}</div><div class="lbl">Qty Produced</div></div>
      <div class="kpi ${s.kpi.outstanding>0?'bad':'ok'}"><div class="num">${s.kpi.outstanding}</div><div class="lbl">Outstanding</div></div>
    </div>
    <table class="dtable">
      <thead><tr>
        <th>Prod Date</th><th>No. WO</th><th>Total Qty Plan</th><th>Qty Produced</th>
        <th>Carry Fwd</th><th>Cumulative Backlog</th><th>Nearest DI</th><th>% Completed</th><th>Flag</th>
      </tr></thead>
      <tbody>${rowsHTML}${unschedHTML}${totalHTML}</tbody>
    </table>
  </div>`;
}

// ==================================================================
// QTY TREND VIEW — Actual vs Target over time, optional Line filter
// ==================================================================

function populateTrendLineFilter(){
  const lines = [...new Set(RECORDS.map(r => r.Line))].sort();
  const sel = document.getElementById('tLine');
  lines.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l; opt.textContent = l;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', renderTrend);
}

function computeTrendData(){
  const lineVal = document.getElementById('tLine').value;
  const pool = (lineVal ? RECORDS.filter(r => r.Line === lineVal) : RECORDS).map(deriveRow);
  const scheduled = pool.filter(r => r.ProdDate !== 'TBA' && r.ProdDate !== 'NO PLAN');
  const dates = [...new Set(scheduled.map(r => r.ProdDate))].sort();

  let cum = 0;
  return dates.map(d => {
    const group = scheduled.filter(r => r.ProdDate === d);
    const target = group.reduce((a,r) => a + (Number(r.WOQty)||0), 0);
    const actual = group.reduce((a,r) => a + (Number(r.QtyProduced)||0), 0);
    cum += (target - actual);
    return { date: d, target, actual, variance: actual - target, cumBacklog: cum };
  });
}

function renderTrend(){
  const data = computeTrendData();
  const chartRoot = document.getElementById('trendChart');
  try {
    chartRoot.innerHTML = buildTrendSVG(data);
  } catch (err) {
    console.error('Gagal bina chart:', err);
    chartRoot.innerHTML = `<p style="font-family:var(--mono);font-size:12px;color:var(--bad-ink);">Tak boleh bina chart — ${err.message}</p>`;
  }

  const root = document.getElementById('trendTableRoot');
  const rowsHTML = data.map(d => `
    <tr class="${d.variance < 0 ? 'row-warn' : 'row-ok'}">
      <td class="left">${fmtDate(d.date)}</td>
      <td>${d.target}</td>
      <td>${d.actual}</td>
      <td>${d.variance}</td>
      <td>${d.cumBacklog}</td>
    </tr>`).join('');
  root.innerHTML = `
    <table class="dtable">
      <thead><tr><th>Prod Date</th><th>Target Qty</th><th>Actual Qty</th><th>Variance</th><th>Cumulative Backlog</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    <p style="font-family:var(--mono);font-size:11px;color:#847d6e;margin-top:8px;">
      Nota: "Actual" tarik dari Qty Produced — masih 0 sehingga di key-in dalam tab "WO Tracker".
    </p>`;
}

// Self-contained SVG combo chart (grouped bars + line, dual axis) — no external library.
function buildTrendSVG(data){
  if (!data || data.length === 0){
    return `<p style="font-family:var(--mono);font-size:12px;color:#847d6e;padding:20px;">Takda data berjadual untuk dipaparkan.</p>`;
  }
  const W = 900, H = 380;
  const ML = 54, MR = 60, MT = 40, MB = 70;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const n = data.length;
  const slotW = plotW / n;

  const maxQty = Math.max(1, ...data.map(d => Math.max(d.target, d.actual))) * 1.15;
  const maxBacklog = Math.max(1, ...data.map(d => d.cumBacklog)) * 1.15;
  const minBacklog = Math.min(0, ...data.map(d => d.cumBacklog));

  const yQty = v => MT + plotH - (v / maxQty) * plotH;
  const yBack = v => MT + plotH - ((v - minBacklog) / (maxBacklog - minBacklog || 1)) * plotH;

  const barW = Math.min(22, slotW * 0.32);
  const gap = 4;

  let bars = '';
  let lineXY = [];
  data.forEach((d, i) => {
    const cx = ML + i * slotW + slotW / 2;
    const xt = cx - barW - gap/2;
    const xa = cx + gap/2;
    const ht = plotH - (yQty(d.target) - MT);
    const ha = plotH - (yQty(d.actual) - MT);
    bars += `<rect x="${xt}" y="${yQty(d.target)}" width="${barW}" height="${Math.max(ht,0)}" fill="#9DB6CE" rx="1.5"/>`;
    bars += `<rect x="${xa}" y="${yQty(d.actual)}" width="${barW}" height="${Math.max(ha,0)}" fill="#C4501C" rx="1.5"/>`;
    lineXY.push([cx, yBack(d.cumBacklog)]);
  });

  const linePath = lineXY.map((p,i) => (i===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const dots = lineXY.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#1F4E78"/>`).join('');

  // gridlines + qty axis labels (left)
  let grid = '', qtyLabels = '';
  const steps = 4;
  for (let s = 0; s <= steps; s++){
    const val = (maxQty / steps) * s;
    const y = yQty(val);
    grid += `<line x1="${ML}" y1="${y}" x2="${ML+plotW}" y2="${y}" stroke="#e8e4da" stroke-width="1"/>`;
    qtyLabels += `<text x="${ML-8}" y="${y+3}" text-anchor="end" font-size="10" font-family="var(--mono)" fill="#847d6e">${Math.round(val)}</text>`;
  }
  // backlog axis labels (right) — reuse same gridlines positions but label backlog scale
  let backLabels = '';
  for (let s = 0; s <= steps; s++){
    const val = minBacklog + ((maxBacklog - minBacklog) / steps) * s;
    const y = yBack(val);
    backLabels += `<text x="${ML+plotW+8}" y="${y+3}" text-anchor="start" font-size="10" font-family="var(--mono)" fill="#1F4E78">${Math.round(val)}</text>`;
  }

  // x-axis date labels (rotated if many)
  const rotate = n > 7;
  let xLabels = '';
  data.forEach((d,i) => {
    const cx = ML + i*slotW + slotW/2;
    const y = MT + plotH + 16;
    const label = fmtDate(d.date);
    if (rotate){
      xLabels += `<text x="${cx}" y="${y}" font-size="10" font-family="var(--mono)" fill="#6b6457" transform="rotate(-40 ${cx} ${y})" text-anchor="end">${label}</text>`;
    } else {
      xLabels += `<text x="${cx}" y="${y}" font-size="10.5" font-family="var(--mono)" fill="#6b6457" text-anchor="middle">${label}</text>`;
    }
  });

  const legendY = 16;
  const legend = `
    <rect x="${ML}" y="${legendY-9}" width="11" height="11" fill="#9DB6CE"/>
    <text x="${ML+16}" y="${legendY}" font-size="11" font-family="var(--body)" fill="#1a1d1f">Target</text>
    <rect x="${ML+78}" y="${legendY-9}" width="11" height="11" fill="#C4501C"/>
    <text x="${ML+94}" y="${legendY}" font-size="11" font-family="var(--body)" fill="#1a1d1f">Actual</text>
    <line x1="${ML+170}" y1="${legendY-4}" x2="${ML+186}" y2="${legendY-4}" stroke="#1F4E78" stroke-width="2.5"/>
    <circle cx="${ML+178}" cy="${legendY-4}" r="3" fill="#1F4E78"/>
    <text x="${ML+192}" y="${legendY}" font-size="11" font-family="var(--body)" fill="#1a1d1f">Cumulative Backlog</text>
  `;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    <line x1="${ML}" y1="${MT+plotH}" x2="${ML+plotW}" y2="${MT+plotH}" stroke="#d8d3c7" stroke-width="1.5"/>
    ${bars}
    <path d="${linePath}" fill="none" stroke="#1F4E78" stroke-width="2.5"/>
    ${dots}
    ${qtyLabels}
    ${backLabels}
    ${xLabels}
    ${legend}
  </svg>`;
}
