/* ===========================================================
   Production WO Status Tracker — app logic
   =========================================================== */

// ----------------------------------------------------------------
// CONFIG — paste your Google Apps Script Web App URL here once
// deployed (see README.md, Step 3). Leave blank to stay in DEMO MODE
// (reads/writes only affect this browser tab, nothing is saved).
// ----------------------------------------------------------------
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzKrUFc0P3OAi4vwhAfbCvzHdOrAFOC1fnnHca1JHKNQVLLeT_fAal0ZjpszVxPvzzRqQ/exec", // e.g. "https://script.google.com/macros/s/AKfycb.../exec"
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
  bindEvents();
  render();
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
        <p class="wo-title">${r.ItemDescription}</p>
        <div class="wo-sub">
          <span>Model <b>${r.Model}</b></span>
          <span>WO Qty <b>${r.WOQty}</b></span>
          <span>Prod <b>${fmtDate(r.ProdDate)}</b></span>
          <span>DI <b>${fmtDate(r.DIDate)}</b></span>
        </div>
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
