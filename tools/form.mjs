// Google Form suggestions (for people without a GitHub account) — shared by review-ui and review-all.
// Everything in a response was typed by a stranger: treat it as untrusted data (same checks as issues).
// Files live OUTSIDE the repo: the CSV and the AI results hold contributor names; the published link lets anyone read responses.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = "E:\\YGO-Translator\\";

/** Where things are. --form <csv> / --form-url <link> / env YGOTH_FORM_CSV_URL / form-csv-url.txt override the defaults. */
export function formConfig({ csv, url } = {}) {
  const CSV = csv || BASE + "form-responses.csv";
  const urlFile = BASE + "form-csv-url.txt";
  // an explicit --form <csv> means "use this file" — don't fetch the Sheet over it
  const URL_ = (url || (csv ? "" : process.env.YGOTH_FORM_CSV_URL || (existsSync(urlFile) ? readFileSync(urlFile, "utf8").split(/\r?\n/)[0] : ""))).trim();
  if (URL_ && !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(URL_)) throw new Error("ลิงก์ CSV ของฟอร์มต้องเป็น https://docs.google.com/spreadsheets/…");
  const stem = CSV.replace(/\.csv$/i, "");
  return { csv: CSV, url: URL_, urlFile, done: stem + ".handled.json", ai: stem + ".ai.json" };
}

/** RFC 4180 CSV: quoted cells, "" for ", line breaks inside cells. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

/** Latest responses: from the published Sheet link (keeps a local copy), else the local CSV. */
export async function fetchFormText(cfg) {
  if (cfg.url) {
    try {
      const r = await fetch(cfg.url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const text = await r.text();
      writeFileSync(cfg.csv, text); // copy for when the network is down
      return { text, from: "Google Sheet" };
    } catch (e) { console.warn("ดึงคำตอบจาก Sheet ไม่ได้: " + e.message + " — ใช้ไฟล์ในเครื่องแทน"); }
  }
  if (!existsSync(cfg.csv)) return { text: null, note: cfg.url ? "ดึงคำตอบจาก Google Sheet ไม่ได้ (เน็ต/ลิงก์?) และยังไม่มีไฟล์ในเครื่อง" : `ยังไม่ได้ตั้งลิงก์ CSV ของ Sheet (${cfg.urlFile}) และไม่มีไฟล์ ${cfg.csv}` };
  return { text: readFileSync(cfg.csv, "utf8"), from: cfg.url ? "ไฟล์ในเครื่อง (ดึงจาก Sheet ไม่ได้)" : "ไฟล์ในเครื่อง" };
}

/** CSV text → raw suggestions (not yet matched to cards). formKey = timestamp|passcode, stable across re-downloads. */
export function readSuggestions(text) {
  const [head = [], ...rows] = parseCsv(text);
  const col = re => head.findIndex(h => re.test(h.trim()));
  const C = { time: 0, id: col(/passcode/i), proposed: col(/คำแปลที่เสนอ/), reason: col(/เหตุผล/), source: col(/แหล่งอ้างอิง/), credit: col(/เครดิต/) };
  if (C.id < 0 || C.proposed < 0) return { rows: [], note: "CSV ไม่มีคอลัมน์ passcode / คำแปลที่เสนอ — เป็นไฟล์ของฟอร์มนี้หรือเปล่า?" };
  return {
    rows: rows.map(r => {
      const get = i => (i >= 0 ? String(r[i] ?? "") : "").replace(/\r\n?/g, "\n").trim();
      const raw = get(C.id).replace(/\D/g, "");
      return { formKey: `${get(C.time)}|${raw}`, raw, proposed: get(C.proposed), reason: get(C.reason).slice(0, 2000),
        source: get(C.source).slice(0, 500), creditRaw: get(C.credit), submitted: get(C.time) };
    })
  };
}

const readJson = f => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; } };
/** Suggestions the maintainer already used or dismissed. */
export const readDone = cfg => readJson(cfg.done);
export function markDone(cfg, key, result) { const d = readDone(cfg); d[key] = { result, at: new Date().toISOString() }; writeFileSync(cfg.done, JSON.stringify(d, null, 1)); }
/** AI review results (advice only). Keyed by formKey; re-reviewed only if the suggested text changed. */
export const readAi = cfg => readJson(cfg.ai);
export function writeAi(cfg, key, result) { const d = readAi(cfg); d[key] = result; writeFileSync(cfg.ai, JSON.stringify(d, null, 1)); }
