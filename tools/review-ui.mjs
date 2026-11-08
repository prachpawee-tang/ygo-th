// หน้าตรวจคำแปลบนเครื่องผู้ดูแล — ดับเบิลคลิก tools\review-ui.bat  (หรือ node tools/review-ui.mjs [cards-en.json])
// - เปิด server ที่ 127.0.0.1 เท่านั้น + token สุ่มทุกครั้ง (กันเว็บอื่นในเครื่องแอบสั่งบันทึก) + ตรวจ Host (กัน DNS rebinding)
// - อ่านภาษาอังกฤษจาก batch\cards-en.json ในเครื่อง (repo ไม่เก็บข้อความอังกฤษ)
// - บันทึกลง data/cards/{id}.json ทันที: status → reviewed, ลบ note · ตรวจเสร็จแล้วรัน update-data.bat เพื่อ commit + push
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { ROOT, CARDS_DIR, loadCards, ruleCheck, checkCardSchema, unsafeText, cardJson, enHash, MAX_TH } from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
// คำแก้จาก Google Form: ดาวน์โหลดจาก Sheet (ไฟล์ → ดาวน์โหลด → CSV) มาวางที่นี่ หรือระบุด้วย --form
const FORM_CSV = flag("--form") || "E:\\YGO-Translator\\form-responses.csv";
const FORM_DONE = FORM_CSV.replace(/\.csv$/i, "") + ".handled.json"; // คำตอบที่จัดการแล้ว (ใช้/ไม่ใช้) จะไม่ขึ้นซ้ำ
const EN_FILE = argv[0] || "E:\\YGO-Translator\\batch\\cards-en.json";
const PORT = +(process.env.REVIEW_PORT || 8787);
const TOKEN = randomBytes(24).toString("hex");

if (!existsSync(EN_FILE)) { console.error(`ไม่พบ ${EN_FILE} — ระบุ path ของ cards-en.json เป็นอาร์กิวเมนต์แรก`); process.exit(1); }

// ---- ข้อมูลภาษาอังกฤษ (id และ alt passcode ทุกตัว) ----
console.log("อ่านข้อมูลภาษาอังกฤษ…");
const enRaw = JSON.parse(readFileSync(EN_FILE, "utf8"));
const EN = new Map();
for (const c of enRaw.data || enRaw) {
  const rec = { en: c.desc || "", views: c.misc_info?.[0]?.views || 0, type: c.type || "" };
  EN.set(String(c.id), rec);
  for (const im of c.card_images || []) EN.set(String(im.id), rec);
}

const today = () => new Date().toISOString().slice(0, 10);
const cardPath = id => join(CARDS_DIR, `${id}.json`);

function problemKind(p) {
  if (/banish/.test(p)) return "banish";
  if (/face-(up|down)/.test(p)) return "face";
  if (/numbers missing/.test(p)) return "number";
  if (/fewer ":"/.test(p)) return "colon";
  if (/fewer ";"/.test(p)) return "semicolon";
  if (/quotes/.test(p)) return "name";
  if (/bullet/.test(p)) return "bullet";
  return "other";
}

// อ่านการ์ดทั้งหมดครั้งเดียวตอนเปิด (14,000+ ไฟล์บน HDD ใช้เวลาเป็นนาที) แล้วเก็บในหน่วยความจำ · บันทึกแล้วอัปเดตเฉพาะใบนั้น
console.log("อ่านไฟล์การ์ดทั้งหมด… (บน HDD ครั้งแรกอาจใช้ 1–2 นาที ครั้งต่อไปจะเร็วขึ้น)");
const t0 = Date.now();
const CARDS = new Map(loadCards().map(({ card }) => [card.id, card]));
console.log(`อ่านแล้ว ${CARDS.size} ใบ (${((Date.now() - t0) / 1000).toFixed(0)} วินาที)`);

const ALT = new Map(); // passcode อื่นของการ์ดใบเดียวกัน → passcode หลัก
for (const c of CARDS.values()) for (const a of c.alt || []) ALT.set(a, c.id);

// ---- Google Form (CSV จาก Sheet) ----
/** RFC 4180 CSV: เครื่องหมายคำพูดครอบ, "" แทน ", ขึ้นบรรทัดใหม่ในช่องได้ */
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = String(text).replace(/^﻿/, "");
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

const readDone = () => { try { return JSON.parse(readFileSync(FORM_DONE, "utf8")); } catch { return {}; } };
const markDone = (key, result) => { const d = readDone(); d[key] = { result, at: new Date().toISOString() }; writeFileSync(FORM_DONE, JSON.stringify(d, null, 1)); };

/** คำแก้จากฟอร์มที่ยังไม่ได้จัดการ — ข้อความทุกช่องมาจากคนทั่วไป ถือว่าไว้ใจไม่ได้ (ตรวจแบบเดียวกับ issue) */
function formQueue() {
  if (!existsSync(FORM_CSV)) return { items: [], note: `ยังไม่มีไฟล์ ${FORM_CSV} — ดาวน์โหลด CSV จาก Google Sheet ของฟอร์มมาวางที่นี่` };
  const [head, ...rows] = parseCsv(readFileSync(FORM_CSV, "utf8"));
  const col = re => head.findIndex(h => re.test(h.trim()));
  const C = { time: 0, id: col(/passcode/i), proposed: col(/คำแปลที่เสนอ/), reason: col(/เหตุผล/), source: col(/แหล่งอ้างอิง/), credit: col(/เครดิต/) };
  if (C.id < 0 || C.proposed < 0) return { items: [], note: "CSV ไม่มีคอลัมน์ passcode / คำแปลที่เสนอ — เป็นไฟล์ของฟอร์มนี้หรือเปล่า?" };
  const done = readDone(), items = [];
  for (const r of rows) {
    const get = i => (i >= 0 ? String(r[i] ?? "") : "").replace(/\r\n?/g, "\n").trim();
    const raw = get(C.id).replace(/\D/g, ""), proposed = get(C.proposed);
    const key = `${get(C.time)}|${raw}`;
    if (done[key]) continue;
    const id = CARDS.has(raw) ? raw : ALT.get(raw) || raw;
    const card = CARDS.get(id), e = EN.get(id);
    const problems = [];
    if (!/^\d{3,10}$/.test(raw)) problems.push("passcode ไม่ใช่ตัวเลข");
    else if (!card) problems.push("ไม่พบการ์ดนี้ในฐาน");
    if (!proposed) problems.push("ไม่มีคำแปลที่เสนอ");
    if (proposed.length > MAX_TH) problems.push(`คำแปลยาวเกิน ${MAX_TH} ตัวอักษร`);
    if (card && proposed === card.th.trim()) problems.push("เหมือนคำแปลเดิม (ไม่ได้แก้อะไร)");
    // ruleCheck already includes the unsafe-text checks; without English we still need them
    if (e && proposed) problems.push(...ruleCheck(e.en, proposed).problems);
    else problems.push(...unsafeText(proposed));
    items.push({ formKey: key, id, name: card?.name || "(ไม่พบการ์ด)", th: card?.th || "", proposed: proposed.slice(0, MAX_TH),
      reason: get(C.reason).slice(0, 2000), source: get(C.source).slice(0, 500), credit: get(C.credit).slice(0, 100),
      submitted: get(C.time), en: e?.en || "", views: e?.views || 0, type: e?.type || "", status: card?.status || "-",
      stale: false, problems, kinds: [...new Set(problems.map(problemKind))] });
  }
  return { items };
}

/** คิวงาน: mode=notes → ใบที่มี note · mode=ai → ทุกใบที่ยังเป็น ai (ยอดนิยมก่อน) */
function queue(mode) {
  const out = [];
  for (const card of CARDS.values()) {
    if (card.status === "reviewed") continue;
    if (mode === "notes" ? !card.note : card.status !== "ai") continue;
    const e = EN.get(card.id);
    if (!e) continue;
    const problems = ruleCheck(e.en, card.th).problems;
    out.push({ id: card.id, name: card.name, th: card.th, en: e.en, views: e.views, type: e.type, status: card.status,
      stale: !!card.en_sha256 && card.en_sha256 !== enHash(e.en), problems, kinds: [...new Set(problems.map(problemKind))] });
  }
  return out.sort((a, b) => b.views - a.views);
}

function save({ id, th, action, formKey }) {
  if (formKey !== undefined && typeof formKey !== "string") return { ok: false, error: "formKey ไม่ถูกต้อง" };
  // คำแก้จากฟอร์มที่ไม่ใช้ — จำไว้ว่าจัดการแล้ว ไม่แตะการ์ด
  if (action === "dismiss") {
    if (!formKey) return { ok: false, error: "ไม่มี formKey" };
    markDone(formKey, "dismissed");
    return { ok: true, card: { id, name: CARDS.get(id)?.name || id }, rule: [] };
  }
  if (typeof id !== "string" || !/^\d{3,10}$/.test(id) || !existsSync(cardPath(id))) return { ok: false, error: "ไม่พบการ์ด" };
  const card = JSON.parse(readFileSync(cardPath(id), "utf8"));
  if (action === "edit") {
    if (typeof th !== "string") return { ok: false, error: "ไม่มีคำแปล" };
    th = th.replace(/\r\n?/g, "\n").split("\n").map(l => l.trim()).filter(Boolean).join("\n");
    if (!th || th.length > MAX_TH) return { ok: false, error: "คำแปลว่างหรือยาวเกิน" };
    const bad = unsafeText(th);
    if (bad.length) return { ok: false, error: "คำแปลมี " + bad.join(", ") };
    card.th = th;
  } else if (action !== "accept") return { ok: false, error: "action ไม่ถูกต้อง" };
  const e = EN.get(id);
  // คำแก้จากคนนอกที่ผู้ดูแลรับแล้ว = community (เหมือน PR จาก issue) · ผู้ดูแลตรวจเอง = reviewed
  card.status = formKey ? "community" : "reviewed";
  card.updated = today();
  if (e) card.en_sha256 = enHash(e.en); // ตรวจเทียบกับข้อความอังกฤษเวอร์ชันนี้
  delete card.note;
  const problems = checkCardSchema(card);
  if (problems.length) return { ok: false, error: problems.join("; ") };
  writeFileSync(cardPath(id), cardJson(card));
  CARDS.set(id, card);
  if (formKey) markDone(formKey, "used");
  return { ok: true, card, rule: e ? ruleCheck(e.en, card.th).problems : [] };
}

// ---- HTTP ----
const PAGE = () => readFileSync(join(ROOT, "tools", "review-ui.html"), "utf8");
const FORMAT_JS = () => readFileSync(join(ROOT, "extension", "format.js"), "utf8");
const okToken = t => { const a = Buffer.from(String(t || "")), b = Buffer.from(TOKEN); return a.length === b.length && timingSafeEqual(a, b); };
const send = (res, code, type, body) => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer" });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));

const server = createServer((req, res) => {
  // อนุญาตเฉพาะ Host ของเราเอง (กัน DNS rebinding)
  if (req.headers.host !== `127.0.0.1:${PORT}` && req.headers.host !== `localhost:${PORT}`) return send(res, 403, "text/plain", "forbidden host");
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && url.pathname === "/") {
    if (!okToken(url.searchParams.get("t"))) return send(res, 403, "text/plain; charset=utf-8", "ต้องเปิดจากลิงก์ที่ review-ui แสดง (มี token)");
    return send(res, 200, "text/html; charset=utf-8", PAGE());
  }
  if (req.method === "GET" && url.pathname === "/format.js") return send(res, 200, "text/javascript; charset=utf-8", FORMAT_JS());
  if (!url.pathname.startsWith("/api/")) return send(res, 404, "text/plain", "not found");
  // API ทุกตัวต้องมี token ใน header (เว็บอื่นใส่ header นี้ข้าม origin ไม่ได้ถ้าไม่ผ่าน CORS ซึ่งเราไม่เปิด)
  if (!okToken(req.headers["x-review-token"])) return json(res, 403, { ok: false, error: "token ไม่ถูกต้อง" });
  if (req.method === "GET" && url.pathname === "/api/queue") {
    const mode = url.searchParams.get("mode");
    if (mode === "form") { const f = formQueue(); return json(res, 200, { ok: true, items: f.items, note: f.note }); }
    return json(res, 200, { ok: true, items: queue(mode === "ai" ? "ai" : "notes") });
  }
  if (req.method === "POST" && url.pathname === "/api/save") {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { ok: false, error: "ต้องเป็น JSON" });
    let body = "";
    req.on("data", d => { body += d; if (body.length > 64 * 1024) req.destroy(); });
    req.on("end", () => {
      let r;
      try { r = save(JSON.parse(body)); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
      if (r.ok) console.log(`✓ ${r.card.id} ${r.card.name}`);
      json(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  const link = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
  const n = queue("notes").length;
  const f = formQueue();
  console.log(`\nหน้าตรวจคำแปล: ${link}\nใบที่มี note รอตรวจ: ${n} · คำแก้จากฟอร์มที่ยังไม่จัดการ: ${f.note ? "(ไม่มีไฟล์ CSV)" : f.items.length}` +
    `\nปิดหน้าต่างนี้เมื่อเสร็จ แล้วรัน tools\\update-data.bat เพื่อส่งขึ้น GitHub\n`);
  if (!process.env.NO_OPEN) spawn("cmd", ["/c", "start", "", link], { detached: true, stdio: "ignore" }).unref();
});
server.on("error", e => { console.error(e.code === "EADDRINUSE" ? `พอร์ต ${PORT} ถูกใช้อยู่ — ปิดหน้าตรวจเดิมก่อน หรือตั้ง REVIEW_PORT` : e.message); process.exit(1); });
