# Production WO Status Tracker — Web App

Web UI untuk tracker WO (Work Order) production — boleh filter by **Date / Line / Model**,
tengok semua detail column, dan key-in update (Qty Produced, Production Status, dll) terus
dari browser, sync ke Google Sheet.

**3 tab:**
- **WO Tracker** — filter & key-in data (per WO)
- **Daily Summary** — ringkasan harian per Line (sama macam sheet "ALL LINES - Daily Summary" dalam Excel): cumulative backlog, % completed, flag
- **Qty Trend** — chart Actual vs Target qty harian (boleh pilih Line atau "Semua Line combined"), guna [Chart.js](https://www.chartjs.org/) (load terus dari CDN, takyah install apa-apa)

```
site/
├── index.html              ← page utama
├── apps_script_backend.gs.txt   ← code untuk paste dalam Google Apps Script
└── assets/
    ├── style.css
    ├── app.js               ← logic utama (CONFIG.APPS_SCRIPT_URL letak sini)
    └── demo-data.js         ← data demo (snapshot JULY'26), dipakai bila belum connect Sheet
```

## 1. Test dulu (takyah setup apa-apa)

Buka `site/index.html` terus dalam browser (double-click pun jadi), atau lepas deploy ke
GitHub Pages (Step 5). Dia akan jalan dalam **DEMO MODE** — guna data snapshot JULY'26,
filter/edit semua boleh test, tapi apa-apa "Save" **tak disimpan** kekal (refresh balik, hilang).

Bila dah okay dengan design/flow, sambung Step 2–4 untuk connect data sebenar.

## 2. Setup Google Sheet

1. Pergi [sheets.google.com](https://sheets.google.com) → buat Sheet baru, namakan
   contoh **"Production WO Status Tracker - DATA"**
2. Buang sheet tab kosong default, atau biar je
3. Import data starter: **File > Import > Upload** → upload fail `tracker_data.csv`
   (sekali dengan deliverable ni) → pilih **"Insert new sheet(s)"** atau **"Replace current sheet"**
4. **Penting**: pastikan nama tab sheet tu sama dengan `SHEET_NAME` dalam Apps Script
   (default `"Sheet1"` — boleh rename tab, just match je kat code Step 3)
5. Row 1 mesti header (ID, Line, Customer, dst — dah ada dalam CSV)

> Data CSV ni cuma **snapshot starter** dari Excel tracker JULY'26 (55 WO, 5 line).
> Lepas ni semua update jadi terus dalam Sheet ni — bukan dalam Excel lagi.

## 3. Setup Apps Script (backend API)

1. Dalam Google Sheet tu — **Extensions > Apps Script**
2. Padam code default, **copy-paste semua** isi `apps_script_backend.gs.txt`
3. Check baris `const SHEET_NAME = "Sheet1";` — tukar kalau tab Sheet awak nama lain
4. Save (Ctrl+S / ikon disket), boleh namakan project apa-apa
5. **Deploy > New deployment**
   - Klik ikon gear sebelah "Select type" → pilih **Web app**
   - Description: apa-apa
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Klik **Deploy**
6. Google akan minta **Authorize access** — pilih akaun Google awak, klik "Advanced" →
   "Go to [project name] (unsafe)" kalau ada warning (ni normal untuk script sendiri)
7. Lepas deploy, Google bagi **Web app URL** macam:
   `https://script.google.com/macros/s/AKfycb......................./exec`
   — **copy URL ni**

> Setiap kali awak edit code Apps Script lepas ni, kena **Deploy > Manage deployments >
> edit (pensel icon) > New version > Deploy** untuk update — bukan auto-update.

## 4. Connect web app ke Apps Script

Buka `assets/app.js`, cari baris ni kat atas sekali:

```js
const CONFIG = {
  APPS_SCRIPT_URL: "", // <-- paste URL Step 3 sini
};
```

Paste URL tadi:

```js
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycb..../exec",
};
```

Save. Refresh `index.html` — indicator kat top-right kena tukar jadi **"LIVE — connected ke
Google Sheet"** (dot hijau). Kalau still demo mode / dot kuning, check URL betul ke tak, atau
deployment access "Anyone" ke tak.

## 5. Deploy ke GitHub Pages (free hosting)

Takyah tau `git` command — boleh terus drag & drop kat web GitHub:

1. Pergi [github.com](https://github.com) → login / sign up (free)
2. Klik **"+"** kat top-right → **New repository**
   - Repository name: contoh `wo-status-tracker`
   - Public (kena public untuk GitHub Pages free tier)
   - Klik **Create repository**
3. Dalam repo baru tu, klik **"uploading an existing file"**
4. Drag semua isi dalam folder `site/` (index.html, folder assets/, dst) — **letak terus
   kat root repo**, bukan dalam sub-folder
5. Klik **Commit changes**
6. Pergi tab **Settings** (repo tu) → sidebar **Pages**
7. Bawah "Build and deployment" → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → **Save**
8. Tunggu 1–2 minit, refresh page tu — link website awak akan muncul kat atas:
   `https://<username>.github.io/wo-status-tracker/`

Itu je — boleh share link tu kat sesiapa untuk akses (Line leader, planner, dll), semua orang
yang ada link boleh filter & key-in data terus, semua sync ke Google Sheet yang sama.

## 6. Lain-lain nota

- **Tambah line baru** (contoh kalau ada line baru lain dari DM/OH/SENSOR/PT-SW/DM-CORD GR):
  cuma tambah row baru dalam Google Sheet dengan `Line` value baru — dropdown filter dalam
  web app auto-detect, takyah edit code.
- **Tambah column baru**: tambah column dalam Google Sheet + dalam `EDITABLE_FIELDS`
  (kat Apps Script) kalau nak boleh edit dari web, + tambah paparan dalam `cardHTML()`
  function kat `app.js` kalau nak nampak dalam card.
- **Security**: deployment "Anyone" access bermaksud sesiapa ada link Apps Script boleh
  baca/tulis Sheet. Sesuai untuk internal tool dalam network terhad/private link. Kalau
  perlu proper login, boleh tambah Google Sign-In kemudian (bukan dalam scope sekarang).
- Web app ni **vanilla HTML/CSS/JS** — takda build step (npm/webpack), so edit file terus
  dalam GitHub (pensel icon kat file tu) pun jadi, takyah install apa-apa kat laptop.
