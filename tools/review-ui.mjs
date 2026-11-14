// หน้าตรวจคำแปลบนเครื่องผู้ดูแล — ดับเบิลคลิก tools\review-ui.bat  (หรือ node tools/review-ui.mjs [cards-en.json])
// - เปิด server ที่ 127.0.0.1 เท่านั้น + token สุ่มทุกครั้ง (กันเว็บอื่นในเครื่องแอบสั่งบันทึก) + ตรวจ Host (กัน DNS rebinding)
// - อ่านภาษาอังกฤษจาก batch\cards-en.json ในเครื่อง (repo ไม่เก็บข้อความอังกฤษ)
// - บันทึกลง data/cards/{id}.json ทันที: status → reviewed, ลบ note · ตรวจเสร็จแล้วรัน update-data.bat เพื่อ commit + push
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { ROOT, CARDS_DIR, isPasscode, loadCards, ruleCheck, checkCardSchema, unsafeText, cardJson, enHash, sha256, MAX_TH, cleanCredit, hasPatternMistake } from "./lib.mjs";
import { formConfig, fetchFormText, readSuggestions, readDone, markDone, readAi, isMissingReport, resolveCard } from "./form.mjs";
import { readSimilar, setSimilarStatus, readAiFix } from "./similar.mjs";

const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
// คำแก้จาก Google Form — ที่อยู่ไฟล์/ลิงก์ดู tools/form.mjs (--form <csv> / --form-url <ลิงก์>)
let FORM;
try { FORM = formConfig({ csv: flag("--form"), url: flag("--form-url") }); } catch (e) { console.error(e.message); process.exit(1); }
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
const BY_NAME = new Map(); // ชื่อการ์ดอังกฤษ (ตัวเล็ก) → passcode — ใช้เมื่อฟอร์มส่งเลขของ Dueling Nexus มา (ไม่ใช่ passcode จริง)
for (const c of CARDS.values()) BY_NAME.set(c.name.trim().toLowerCase(), c.id);

// ---- Google Form ----
/** คำแก้จากฟอร์มที่ยังไม่ได้จัดการ — ข้อความทุกช่องมาจากคนทั่วไป ถือว่าไว้ใจไม่ได้ (ตรวจแบบเดียวกับ issue) */
async function formQueue() {
  const got = await fetchFormText(FORM);
  if (got.text === null) return { items: [], note: got.note };
  const { rows, note } = readSuggestions(got.text);
  if (note) return { items: [], note };
  const done = readDone(FORM), ai = readAi(FORM), items = [];
  for (const s of rows) {
    if (done[s.formKey]) continue;
    const hit = resolveCard(s.raw, s.name, { byId: x => (CARDS.has(x) ? x : ALT.get(x)), byName: n => BY_NAME.get(n) });
    const id = hit.id || s.raw;
    const card = CARDS.get(id), e = EN.get(id), proposed = s.proposed;
    const report = isMissingReport(proposed); // "ไม่มีคำแปล" = แจ้งปัญหา ไม่ใช่คำแปล — บันทึกเป็นคำแปลไม่ได้
    const problems = [];
    if (hit.via === "name") problems.push(`เลข ${s.raw} ไม่ใช่ passcode จริง (เลขของ Dueling Nexus) — จับคู่จากชื่อการ์ดเป็น ${id}`);
    if (report) problems.push(card ? "แจ้งว่าไม่มีคำแปล — แต่การ์ดนี้มีคำแปลแล้ว (คนส่งใช้ extension รุ่นก่อน 2.3.1) · กด ไม่ใช้คำแก้นี้" : `แจ้งว่าไม่มีคำแปล — ไม่พบ "${s.name || s.raw}" ในฐาน น่าจะเป็นการ์ดใหม่ (โหลด cards-en.json ใหม่แล้วแปล) · กด ไม่ใช้คำแก้นี้`);
    else if (!hit.id) problems.push(isPasscode(s.raw) ? "ไม่พบการ์ดนี้ในฐาน (ทั้งเลขและชื่อการ์ด)" : "passcode ไม่ใช่ตัวเลข");
    if (!proposed) problems.push("ไม่มีคำแปลที่เสนอ");
    if (proposed.length > MAX_TH) problems.push(`คำแปลยาวเกิน ${MAX_TH} ตัวอักษร`);
    if (card && proposed === card.th.trim()) problems.push("เหมือนคำแปลเดิม (ไม่ได้แก้อะไร)");
    if (s.creditRaw && !cleanCredit(s.creditRaw)) problems.push("ชื่อเครดิตใช้ไม่ได้ (ยาวเกิน 40 หรือมีลิงก์/@/สัญลักษณ์) — จะไม่แสดงเครดิต");
    // ruleCheck already includes the unsafe-text checks; without English we still need them
    if (e && proposed && !report) problems.push(...ruleCheck(e.en, proposed).problems);
    else problems.push(...unsafeText(proposed));
    // ผล AI จาก review-all (คำแนะนำเท่านั้น) — ใช้ได้ถ้ายังเป็นข้อความเดียวกับที่ AI ตรวจ
    const a = ai[s.formKey];
    items.push({ formKey: s.formKey, id, report, name: card?.name || s.name || "(ไม่พบการ์ด)", th: card?.th || "", proposed: proposed.slice(0, MAX_TH),
      reason: s.reason, source: s.source, credit: cleanCredit(s.creditRaw), submitted: s.submitted,
      en: e?.en || "", views: e?.views || 0, type: e?.type || "", status: card?.status || "-", stale: false,
      ai: a && a.proposed === proposed ? a : null,
      problems, kinds: [...new Set(problems.map(problemKind)), ...(a && a.proposed === proposed ? [a.label] : ["ai-none"])] });
  }
  if (!items.length) return { items, note: `ไม่มีคำแก้ใหม่จากฟอร์ม (อ่านจาก ${got.from})` };
  return { items };
}

/** คิวงาน: mode=notes → ใบที่มี note · mode=ai → ทุกใบที่ยังเป็น ai (ยอดนิยมก่อน) */
function queue(mode) {
  const out = [], fix = readAiFix();
  for (const card of CARDS.values()) {
    if (card.status === "reviewed") continue;
    if (mode === "notes" ? !card.note : card.status !== "ai") continue;
    const e = EN.get(card.id);
    if (!e) continue;
    const problems = ruleCheck(e.en, card.th).problems;
    // ความเห็นของ batch/ai-fix (ใช้ได้เฉพาะถ้าคำแปลยังเป็นข้อความเดียวกับที่ AI ตรวจ)
    const f = fix[card.id]?.th_sha === sha256(card.th) ? fix[card.id] : null;
    const aiFix = f && { verdict: f.verdict, why: f.why, checks: f.checks, at: f.at };
    out.push({ id: card.id, name: card.name, th: card.th, en: e.en, views: e.views, type: e.type, status: card.status,
      stale: !!card.en_sha256 && card.en_sha256 !== enHash(e.en), problems, aiFix,
      kinds: [...new Set(problems.map(problemKind)), ...(f?.verdict === "false-alarm" ? ["ai-false-alarm"] : [])] });
  }
  return out.sort((a, b) => b.views - a.views);
}

function save({ id, th, action, formKey, credit }) {
  if (formKey !== undefined && typeof formKey !== "string") return { ok: false, error: "formKey ไม่ถูกต้อง" };
  // คำแก้จากฟอร์มที่ไม่ใช้ — จำไว้ว่าจัดการแล้ว ไม่แตะการ์ด
  if (action === "dismiss") {
    if (!formKey) return { ok: false, error: "ไม่มี formKey" };
    markDone(FORM, formKey, "dismissed");
    return { ok: true, card: { id, name: CARDS.get(id)?.name || id }, rule: [] };
  }
  if (!isPasscode(id) || !existsSync(cardPath(id))) return { ok: false, error: "ไม่พบการ์ด" };
  const card = JSON.parse(readFileSync(cardPath(id), "utf8"));
  if (action === "edit") {
    if (typeof th !== "string") return { ok: false, error: "ไม่มีคำแปล" };
    th = th.replace(/\r\n?/g, "\n").split("\n").map(l => l.trim()).filter(Boolean).join("\n");
    // "ไม่มีคำแปล" from the form is a report, not a translation — never store it as the card text
    if (isMissingReport(th)) return { ok: false, error: "ข้อความนี้เป็นการแจ้งว่าไม่มีคำแปล ไม่ใช่คำแปล — บันทึกเป็นคำแปลไม่ได้ (กด ไม่ใช้คำแก้นี้)" };
    if (!th || th.length > MAX_TH) return { ok: false, error: "คำแปลว่างหรือยาวเกิน" };
    const bad = unsafeText(th);
    if (bad.length) return { ok: false, error: "คำแปลมี " + bad.join(", ") };
    card.th = th;
  } else if (action !== "accept") return { ok: false, error: "action ไม่ถูกต้อง" };
  const e = EN.get(id);
  // คำแก้จากคนนอกที่ผู้ดูแลรับแล้ว = community (เหมือน PR จาก issue) · ผู้ดูแลตรวจเอง = reviewed
  card.status = formKey ? "community" : "reviewed";
  // ชื่อเครดิตจากฟอร์ม (สาธารณะ — แสดงใน extension) · ชื่อที่ไม่ผ่านการตรวจจะไม่ถูกเก็บ
  if (formKey) { const cr = cleanCredit(credit); if (cr) card.credit = cr; else delete card.credit; }
  card.updated = today();
  if (e) card.en_sha256 = enHash(e.en); // ตรวจเทียบกับข้อความอังกฤษเวอร์ชันนี้
  delete card.note;
  const problems = checkCardSchema(card);
  if (problems.length) return { ok: false, error: problems.join("; ") };
  writeFileSync(cardPath(id), cardJson(card));
  CARDS.set(id, card);
  if (formKey) markDone(FORM, formKey, "used");
  return { ok: true, card, rule: e ? ruleCheck(e.en, card.th).problems : [] };
}

/** รายการ "อาจผิดแบบเดียวกัน" (batch/similar.json) — นับใหม่จากคำแปลปัจจุบันในหน่วยความจำ (ใบที่แก้แล้วหายไปเอง) */
function similarList() {
  const order = { pending: 0, sent: 1, ignored: 2 };
  return Object.entries(readSimilar()).map(([key, s]) => {
    const cards = (s.cards || []).filter(c => {
      const card = CARDS.get(c.id), e = EN.get(c.id);
      return card && e && card.status === "ai" && hasPatternMistake(e.en, card.th, s.pattern);
    }).map(c => ({ id: c.id, name: CARDS.get(c.id).name, views: EN.get(c.id).views })).sort((a, b) => b.views - a.views);
    return { key, source: s.source, card: s.card, name: s.name, pattern: s.pattern, status: s.status, at: s.at, total: cards.length, cards: cards.slice(0, 40) };
  }).sort((a, b) => order[a.status] - order[b.status] || String(b.at).localeCompare(String(a.at)));
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
    if (mode === "form") { formQueue().then(f => json(res, 200, { ok: true, items: f.items, note: f.note }), e => json(res, 500, { ok: false, error: String(e.message || e) })); return; }
    return json(res, 200, { ok: true, items: queue(mode === "ai" ? "ai" : "notes") });
  }
  if (req.method === "GET" && url.pathname === "/api/similar") return json(res, 200, { ok: true, items: similarList() });
  if (req.method === "POST" && (url.pathname === "/api/save" || url.pathname === "/api/similar")) {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { ok: false, error: "ต้องเป็น JSON" });
    let body = "";
    req.on("data", d => { body += d; if (body.length > 64 * 1024) req.destroy(); });
    req.on("end", () => {
      let r;
      try {
        const b = JSON.parse(body);
        if (url.pathname === "/api/save") r = save(b);
        else {
          const status = { send: "sent", ignore: "ignored", undo: "pending" }[b.action];
          r = typeof b.key === "string" && status && setSimilarStatus(b.key, status) ? { ok: true, status } : { ok: false, error: "ไม่พบรายการนี้" };
        }
      } catch (e) { r = { ok: false, error: String(e.message || e) }; }
      if (r.ok && r.card) console.log(`✓ ${r.card.id} ${r.card.name}`);
      if (r.ok && r.status) console.log(`อาจผิดแบบเดียวกัน: ${r.status}`);
      json(res, r.ok ? 200 : 400, r);
    });
    return;
  }
  json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, "127.0.0.1", async () => {
  const link = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
  const n = queue("notes").length;
  const f = await formQueue();
  console.log(`\nหน้าตรวจคำแปล: ${link}\nใบที่มี note รอตรวจ: ${n} · คำแก้จากฟอร์มที่ยังไม่จัดการ: ${f.items.length}${f.note ? " (" + f.note + ")" : ""}` +
    `\nปิดหน้าต่างนี้เมื่อเสร็จ แล้วรัน tools\\update-data.bat เพื่อส่งขึ้น GitHub\n`);
  if (!process.env.NO_OPEN) spawn("cmd", ["/c", "start", "", link], { detached: true, stdio: "ignore" }).unref();
});
server.on("error", e => { console.error(e.code === "EADDRINUSE" ? `พอร์ต ${PORT} ถูกใช้อยู่ — ปิดหน้าตรวจเดิมก่อน หรือตั้ง REVIEW_PORT` : e.message); process.exit(1); });
