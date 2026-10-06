/* ============================================================
   記帳系統・主程式（PWA 版）
   資料唯一來源是 localStorage（LS_KEY）。首次啟動若本機沒有資料，
   就從空白帳本開始（舊資料用「匯入 JSON」帶入），之後每次異動都即時
   寫回 localStorage，不需要手動存檔或下載覆蓋檔案。
   ============================================================ */

const LS_KEY    = "ledger-v1";
const DRAFT_KEY = "ledger-draft-v1"; // 舊版殘留 key，啟動時順手清掉

const fmt  = n => "NT$ " + Math.round(n).toLocaleString("zh-TW");
const sfmt = n => (n < 0 ? "− " : "") + fmt(Math.abs(n));
const pad2 = n => String(n).padStart(2, "0");
const esc  = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const $    = id => document.getElementById(id);

/* ---------- 薪資週期：每月 25 日發薪，25 日起算為新一期，以發薪月命名 ---------- */
const PAYDAY = 25;

function periodOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let py = y, pm = m;
  if (d < PAYDAY) { pm -= 1; if (pm === 0) { pm = 12; py -= 1; } }
  return py + "-" + pad2(pm);
}
const monthOf = r => periodOf(r.date);

function periodLabel(p) {
  const [y, m] = p.split("-").map(Number);
  const em = m === 12 ? 1 : m + 1;
  return y + " 年 " + m + " 月期（" + pad2(m) + "/" + PAYDAY + " – " + pad2(em) + "/" + (PAYDAY - 1) + "）";
}

const todayStr = () => {
  const n = new Date();
  return n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate());
};
const currentPeriod = () => periodOf(todayStr());

/* ---------- 分類 ---------- */
const CAT_COLOR = {
  "餐飲":    "var(--c-food)",
  "交通":    "var(--c-trans)",
  "醫療":    "var(--c-med)",
  "訂閱軟體": "var(--c-subs)",
  "購物":    "var(--c-shop)",
  "興趣娛樂": "var(--c-fun)",
  "儲蓄投資": "var(--c-save)",
  "保險":    "var(--c-ins)",
  "其他":    "var(--c-other)",
  "收入":    "var(--c-income)",
};
const EXPENSE_CATS = Object.keys(CAT_COLOR).filter(c => c !== "收入");
const VALID_CATS   = Object.keys(CAT_COLOR);
const catColor = c => CAT_COLOR[c] || CAT_COLOR["其他"];

/* ---------- 狀態與持久化 ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.records)) {
        return {
          records:  d.records.map(r => ({ date: r.date, item: r.item, type: r.type, amount: r.amount, cat: r.cat })),
          cashBase: Number.isFinite(d.cashBase) ? d.cashBase : 0,
          cashNote: typeof d.cashNote === "string" ? d.cashNote : "",
        };
      }
    }
  } catch (e) { /* 壞資料就回退到空白帳本 */ }
  return {
    records:  [],
    cashBase: 0,
    cashNote: "",
  };
}

const state = loadState();

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      records: state.records, cashBase: state.cashBase, cashNote: state.cashNote,
    }));
  } catch (e) {
    toast("儲存失敗：" + e.message);
  }
}

function cashOf(records, base) {
  return base + records.reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0);
}

/* ---------- 渲染 ---------- */
/* 首次載入一律顯示當月期（今天所屬的薪資期）；之後重繪才沿用使用者選的期別。
   當月期即使還沒有記錄也列入選單，避免剛過 25 日時跳到上一期或全部期間。 */
let monthsReady = false;
function initMonths(keep) {
  const sel = $("monthSelect");
  const cur = currentPeriod();
  const prev = keep !== undefined ? keep : (monthsReady ? sel.value : cur);
  monthsReady = true;
  const months = [...new Set(state.records.map(monthOf).concat(cur))].sort().reverse();
  sel.innerHTML = '<option value="all">全部期間</option>';
  for (const m of months) {
    const o = document.createElement("option");
    o.value = m; o.textContent = periodLabel(m);
    sel.appendChild(o);
  }
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : cur;
}

function render() {
  const sel = $("monthSelect").value;
  const q   = $("search").value.trim().toLowerCase();

  const inPeriod = state.records.filter(r => sel === "all" || monthOf(r) === sel);
  const rows = inPeriod
    .filter(r => !q || r.item.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || state.records.indexOf(b) - state.records.indexOf(a));

  let income = 0, expense = 0;
  for (const r of inPeriod) {
    if (r.type === "income") income += r.amount; else expense += r.amount;
  }

  const body = $("recordBody");
  body.innerHTML = "";
  for (const r of rows) {
    const i = state.records.indexOf(r);
    const tr = document.createElement("tr");
    const sign = r.type === "income" ? "+" : "−";
    tr.innerHTML =
      '<td class="num td-date">' + esc(r.date) + "</td>" +
      '<td class="td-item"><span class="item-name">' + esc(r.item) + "</span>" +
        '<span class="cat-inline"><span class="dot" style="background:' + catColor(r.cat) + '"></span>' +
          esc(r.cat) + "</span></td>" +
      '<td class="td-cat hide-sm"><span class="cat-tag"><span class="dot" style="background:' + catColor(r.cat) + '"></span>' +
          esc(r.cat) + "</span></td>" +
      '<td class="num r td-amt" style="color:' + (r.type === "income" ? "var(--income)" : "var(--expense)") + '">' +
        sign + " " + fmt(r.amount) + "</td>" +
      '<td class="td-ops no-print"><div class="ops">' +
        '<button class="btn btn-ghost" data-edit="' + i + '" title="編輯" aria-label="編輯">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg></button>' +
        '<button class="btn btn-ghost danger" data-del="' + i + '" title="刪除" aria-label="刪除">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>' +
      "</div></td>";
    body.appendChild(tr);
  }

  $("sumIncome").textContent  = fmt(income);
  $("sumExpense").textContent = fmt(expense);
  const bal = income - expense;
  const balEl = $("sumBalance");
  balEl.textContent = sfmt(bal);
  balEl.style.color = bal < 0 ? "var(--expense)" : "var(--ink)";

  $("recordCount").textContent = rows.length + " 筆" + (rows.length !== inPeriod.length ? "／" + inPeriod.length : "");
  const emptyEl = $("emptyState");
  emptyEl.hidden = rows.length > 0;
  if (rows.length === 0) {
    emptyEl.innerHTML = "";
    if (!q) {
      emptyEl.textContent = "本期尚無記錄。按右上角「新增」開始記帳。";
    } else {
      /* 搜尋只看當期，但舊記錄常在別期——直接告訴使用者並給一鍵切換 */
      const all = state.records.filter(r =>
        r.item.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q)).length;
      emptyEl.appendChild(document.createTextNode("本期沒有符合「" + q + "」的記錄。"));
      if (all > 0 && sel !== "all") {
        emptyEl.appendChild(document.createElement("br"));
        const b = document.createElement("button");
        b.className = "btn btn-soft";
        b.style.marginTop = "12px";
        b.textContent = "在全部期間搜尋（" + all + " 筆）";
        b.onclick = () => { $("monthSelect").value = "all"; render(); };
        emptyEl.appendChild(b);
      }
    }
  }

  renderCats(inPeriod, expense);

  const cash = cashOf(state.records, state.cashBase);
  const cashEl = $("sumCash");
  cashEl.textContent = sfmt(cash);
  cashEl.style.color = cash < 0 ? "var(--expense)" : "var(--ink)";
  $("cashNote").textContent = "共 " + state.records.length + " 筆";

  refreshSuggest();
}

function renderCats(rows, totalExpense) {
  const box = $("catBody");
  box.innerHTML = "";
  const sums = {};
  for (const r of rows) if (r.type === "expense") sums[r.cat] = (sums[r.cat] || 0) + r.amount;
  const entries = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  $("catEmpty").hidden = entries.length > 0;

  for (const [cat, amt] of entries) {
    const pct = totalExpense ? amt / totalExpense * 100 : 0;
    const row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML =
      '<div class="cat-line">' +
        '<span class="cat-name"><span class="dot" style="background:' + catColor(cat) + '"></span>' + esc(cat) + "</span>" +
        '<span><span class="cat-amt num">' + fmt(amt) + '</span><span class="cat-pct num">' + pct.toFixed(1) + "%</span></span>" +
      "</div>" +
      '<div class="bar"><i style="width:' + pct.toFixed(1) + "%;background:" + catColor(cat) + '"></i></div>';
    box.appendChild(row);
  }
}

function refreshSuggest() {
  const dl = $("itemSuggest");
  const names = [...new Set(state.records.map(r => r.item))].sort();
  dl.innerHTML = "";
  for (const n of names) {
    const o = document.createElement("option");
    o.value = n;
    dl.appendChild(o);
  }
}

function toast(msg) {
  const box = $("toast");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  box.appendChild(el);
  box.classList.add("show");
  setTimeout(() => {
    el.remove();
    if (!box.children.length) box.classList.remove("show");
  }, 2600);
}

function commit(msg) {
  persist();
  initMonths();
  render();
  if (msg) toast(msg);
}

/* ---------- 新增／編輯 ---------- */
let editIndex = -1;

/* 分類以展開按鈕呈現：#catPicker 放按鈕，實際值存在隱藏欄位 #fCat */
function fillCats(type, want) {
  const list = type === "income" ? ["收入"] : EXPENSE_CATS;
  const val  = want && list.includes(want) ? want : list[0];
  const box  = $("catPicker");
  box.innerHTML = "";
  box.classList.toggle("single", list.length === 1);
  for (const c of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cat-chip";
    b.dataset.cat = c;
    b.setAttribute("role", "radio");
    b.style.setProperty("--chip", catColor(c));
    b.innerHTML = '<span class="dot"></span>' + esc(c);
    if (list.length === 1) b.disabled = true;
    box.appendChild(b);
  }
  pickCat(val);
}

function pickCat(c) {
  $("fCat").value = c;
  $("catPicker").querySelectorAll(".cat-chip").forEach(b => {
    const on = b.dataset.cat === c;
    b.setAttribute("aria-pressed", on);
    b.setAttribute("aria-checked", on);
  });
}

function openRec(index) {
  editIndex = index === undefined ? -1 : index;
  const r = editIndex >= 0 ? state.records[editIndex] : null;
  $("recTitle").textContent  = r ? "編輯記錄" : "新增記錄";
  $("recSubmit").textContent = r ? "儲存變更" : "新增";
  $("recDelete").hidden = !r;
  $("fDate").value   = r ? r.date : todayStr();
  $("fItem").value   = r ? r.item : "";
  $("fAmount").value = r ? r.amount : "";
  const type = r ? r.type : "expense";
  (type === "income" ? $("tInc") : $("tExp")).checked = true;
  fillCats(type, r ? r.cat : null);
  $("recHint").textContent = "日期落在 25 日之前會歸到上一期。";
  $("recDlg").showModal();
  setTimeout(() => (r ? $("fAmount") : $("fItem")).focus(), 30);
}

function submitRec() {
  const type = document.querySelector('input[name="type"]:checked').value;
  const rec = {
    date:   $("fDate").value,
    item:   $("fItem").value.trim(),
    type,
    amount: Math.round(Number($("fAmount").value)),
    cat:    type === "income" ? "收入" : $("fCat").value,
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) { toast("日期格式不正確"); return false; }
  if (!rec.item) { toast("請填項目名稱"); return false; }
  if (!Number.isInteger(rec.amount) || rec.amount <= 0) { toast("金額需為正整數"); return false; }

  const msg = editIndex >= 0
    ? "已更新：" + rec.item
    : "已新增：" + rec.item + "　" + (type === "income" ? "+" : "−") + fmt(rec.amount);
  if (editIndex >= 0) state.records[editIndex] = rec;
  else state.records.push(rec);

  /* 跳到這筆所屬的期別，免得新增完在別期看不到 */
  persist();
  initMonths(monthOf(rec));
  render();
  toast(msg);
  return true;
}

function deleteRec() {
  if (editIndex < 0) return;
  const r = state.records[editIndex];
  if (!confirm("刪除這筆記錄？\n\n" + r.date + "　" + r.item + "　" + fmt(r.amount))) return;
  state.records.splice(editIndex, 1);
  editIndex = -1;
  $("recDlg").close();
  commit("已刪除：" + r.item);
}

/* ---------- JSON／CSV ---------- */
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportJson() {
  download("記帳系統-備份-" + todayStr() + ".json", JSON.stringify({
    version: 1, exportedAt: new Date().toISOString(),
    cashBase: state.cashBase, cashNote: state.cashNote, records: state.records,
  }, null, 2), "application/json");
  toast("已匯出 JSON 備份");
}

function importJson(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!Array.isArray(d.records)) throw new Error("檔案裡沒有 records 陣列");
      const bad = d.records.filter(r =>
        !r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.item ||
        (r.type !== "income" && r.type !== "expense") ||
        !Number.isInteger(r.amount) || r.amount <= 0 || !VALID_CATS.includes(r.cat));
      if (bad.length) throw new Error("有 " + bad.length + " 筆格式不合，未匯入");
      if (!confirm("匯入後會取代目前全部 " + state.records.length + " 筆記錄，改為檔案中的 " +
                   d.records.length + " 筆。要繼續嗎？")) return;
      state.records = d.records.map(r => ({ date: r.date, item: r.item, type: r.type, amount: r.amount, cat: r.cat }));
      if (Number.isFinite(d.cashBase)) state.cashBase = d.cashBase;
      if (typeof d.cashNote === "string") state.cashNote = d.cashNote;
      initMonths("all");
      commit("已匯入 " + state.records.length + " 筆");
    } catch (e) {
      toast("匯入失敗：" + e.message);
    }
  };
  fr.readAsText(file);
}

function exportCsv() {
  const sel = $("monthSelect").value;
  const rows = state.records
    .filter(r => sel === "all" || monthOf(r) === sel)
    .sort((a, b) => a.date.localeCompare(b.date));
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const csv = ["日期,項目,類型,金額,分類"]
    .concat(rows.map(r => [r.date, q(r.item), r.type === "income" ? "收入" : "支出", r.amount, r.cat].join(",")))
    .join("\r\n");
  download("記帳明細-" + (sel === "all" ? "全部" : sel) + ".csv", "﻿" + csv, "text/csv");
  toast("已匯出 " + rows.length + " 筆 CSV");
}

/* ---------- 校準現金 ---------- */
function openCash() {
  const cash = cashOf(state.records, state.cashBase);
  $("cashCurrent").textContent = fmt(cash);
  $("cashBaseNow").textContent = fmt(state.cashBase);
  $("fCashNow").value = cash;
  $("cashDlg").showModal();
  setTimeout(() => $("fCashNow").select(), 30);
}

function submitCash() {
  const want = Math.round(Number($("fCashNow").value));
  if (!Number.isFinite(want)) { toast("請輸入金額"); return false; }
  const delta = state.records.reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0);
  state.cashBase = want - delta;
  state.cashNote = "期初現金：" + todayStr() + " 校準，目前現金 " + fmt(want) + "。" +
                   "目前現金 = 期初現金 + 全部收入 − 全部支出（不受期別篩選影響）";
  commit("已校準：現金 " + fmt(want));
  return true;
}

/* ---------- 資料驗證（只寫 console，不影響畫面） ----------
   刻意「不」檢查的兩件事，加回去會誤報：
   - 未來日期：預先記錄已知的未來扣款是合法用法
   - 陣列排序：新記錄一律 append 到尾端，順序是輸入順序不是日期順序
*/
function validateRecords(records, cashBase) {
  const errors = [], warnings = [], seen = new Map();
  const at = i => "records[" + i + "]";
  const today = new Date(), DAY = 86400000;

  records.forEach((r, i) => {
    const where = at(i) + " " + JSON.stringify(r && r.item !== undefined ? r.item : "(無 item)");

    ["date", "item", "type", "amount", "cat"].forEach(k => {
      if (r[k] === undefined || r[k] === null || r[k] === "") errors.push(where + "：缺少 " + k);
    });

    if (typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      const [y, m, d] = r.date.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
        errors.push(where + "：日期不存在 " + r.date);
      } else {
        const diff = (dt - today) / DAY;
        if (diff > 180)  warnings.push(where + "：日期在 180 天之後（" + r.date + "），確認年份是否打錯");
        if (diff < -365) warnings.push(where + "：日期在一年前（" + r.date + "），確認年份是否打錯");
      }
    } else if (r.date !== undefined) {
      errors.push(where + "：日期格式應為 YYYY-MM-DD，實際為 " + JSON.stringify(r.date));
    }

    if (r.type !== "income" && r.type !== "expense")
      errors.push(where + "：type 應為 income 或 expense，實際為 " + JSON.stringify(r.type));
    if (!Number.isInteger(r.amount) || r.amount <= 0)
      errors.push(where + "：amount 應為正整數，實際為 " + JSON.stringify(r.amount));
    if (r.cat !== undefined && !VALID_CATS.includes(r.cat))
      errors.push(where + "：cat 不在合法分類內 " + JSON.stringify(r.cat));
    if (r.type === "income" && r.cat !== "收入")
      errors.push(where + "：收入記錄的 cat 應為「收入」，實際為 " + JSON.stringify(r.cat));
    if (r.cat === "收入" && r.type !== "income")
      errors.push(where + "：cat 為「收入」但 type 是 " + JSON.stringify(r.type));

    const key = [r.date, r.item, r.type, r.amount, r.cat].join("|");
    if (seen.has(key)) warnings.push(where + "：與 " + at(seen.get(key)) + " 完全重複");
    else seen.set(key, i);
  });

  if (!Number.isFinite(cashBase)) errors.push("cashBase 不是數字：" + JSON.stringify(cashBase));

  const TAG = "[記帳系統]";
  if (!errors.length && !warnings.length) {
    console.log(TAG + " 資料檢查通過，共 " + records.length + " 筆記錄。");
    return;
  }
  if (errors.length) {
    console.error(TAG + " 發現 " + errors.length + " 項錯誤：");
    errors.forEach(e => console.error("  " + e));
  }
  if (warnings.length) {
    console.warn(TAG + " 發現 " + warnings.length + " 項提醒：");
    warnings.forEach(w => console.warn("  " + w));
  }
}

/* ---------- 綁定 ---------- */
$("monthSelect").addEventListener("change", render);
$("search").addEventListener("input", render);

$("btnAdd").addEventListener("click", () => openRec());
$("recordBody").addEventListener("click", e => {
  const ed = e.target.closest("[data-edit]");
  if (ed) return openRec(Number(ed.dataset.edit));
  const dl = e.target.closest("[data-del]");
  if (dl) { editIndex = Number(dl.dataset.del); deleteRec(); }
});

$("recForm").addEventListener("submit", e => {
  if (!submitRec()) e.preventDefault();
});
$("recCancel").addEventListener("click", () => $("recDlg").close());
$("recDelete").addEventListener("click", deleteRec);
$("catPicker").addEventListener("click", e => {
  const b = e.target.closest(".cat-chip");
  if (b && !b.disabled) pickCat(b.dataset.cat);
});
document.querySelectorAll('input[name="type"]').forEach(el =>
  el.addEventListener("change", () => fillCats(el.value, null)));

$("cashForm").addEventListener("submit", e => {
  if (!submitCash()) e.preventDefault();
});
$("cashCancel").addEventListener("click", () => $("cashDlg").close());

const closeMenu = () => $("mainMenu").removeAttribute("open");
$("miCash").addEventListener("click", () => { closeMenu(); openCash(); });
$("miExport").addEventListener("click", () => { closeMenu(); exportJson(); });
$("miCsv").addEventListener("click", () => { closeMenu(); exportCsv(); });
$("miImport").addEventListener("click", () => { closeMenu(); $("fileInput").click(); });
$("fileInput").addEventListener("change", e => {
  const f = e.target.files[0];
  if (f) importJson(f);
  e.target.value = "";   /* 允許連續匯入同一個檔名 */
});

document.addEventListener("click", e => {
  const m = $("mainMenu");
  if (m.hasAttribute("open") && !m.contains(e.target)) m.removeAttribute("open");
});

document.addEventListener("keydown", e => {
  if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
      !document.querySelector("dialog[open]")) {
    e.preventDefault(); openRec();
  }
});

/* ---------- PWA：安裝提示 + Service Worker ---------- */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstall = e;
  $("bannerText").textContent = "可以把記帳系統安裝到主畫面，像 App 一樣開啟。";
  $("bannerAction").hidden = false;
  $("banner").hidden = false;
});
$("bannerAction").addEventListener("click", async () => {
  if (!deferredInstall) return;
  $("banner").hidden = true;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
});
window.addEventListener("appinstalled", () => {
  $("banner").hidden = true;
  toast("已安裝到主畫面");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 離線快取非必要功能，失敗不影響記帳 */ });
  });
}

try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}

/* ---------- 除錯掛鉤 ----------
   正常使用不需要理它。開 console 打 ledger.state.records 可看目前資料。 */
window.ledger = {
  state, persist, periodOf, periodLabel, cashOf, fmt,
  render, initMonths, fillCats, pickCat,
  openRec, submitRec, deleteRec, openCash, submitCash,
  exportJson, exportCsv, importJson,
  validateRecords,
};

/* ---------- 啟動 ---------- */
try { validateRecords(state.records, state.cashBase); }
catch (e) { console.warn("[記帳系統] 驗證程序本身出錯，已略過，不影響顯示：", e); }

persist(); // 首次啟動先落地一份空白帳本，之後都是本機資料
initMonths();
render();
