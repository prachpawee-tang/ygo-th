// "การ์ดใบอื่นที่อาจผิดแบบเดียวกัน" — หลังตรวจคำแก้ (Google Form / GitHub issue) ด้วย AI
// 1. ai-review.mjs mistakePattern() สรุปว่าคำแก้นี้แก้ความผิดแบบไหน → { en: "face-up", wrong: "คว่ำ", right: "หงาย" }
// 2. findSimilar() หาใบอื่นที่ยังผิดแบบนั้น (ไม่ใช้ AI: นับคำเหมือน rule-check) จาก batch\cards-th.jsonl (ไฟล์เดียว อ่านเร็วกว่า 14,000 ไฟล์บน HDD)
// 3. เก็บไว้ใน batch\similar.json สถานะ pending → ผู้ดูแลดูใน review-ui โหมด "อาจผิดแบบเดียวกัน" แล้วกด "ส่งให้ ai-fix" (sent) หรือ "ไม่ส่ง" (ignored)
// 4. batch\ai-fix.bat แก้ใบในรายการที่ sent ทีละใบ (แก้เฉพาะจุด + ตรวจซ้ำ)
// ไฟล์ทั้งหมดอยู่นอก repo (อยู่ในเครื่องผู้ดูแลเท่านั้น)
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ROOT, CARDS_DIR, cleanPattern, patternFits, hasPatternMistake } from "./lib.mjs";

export const BATCH = process.env.YGOTH_BATCH || join(ROOT, "..", "batch");
export const JSONL = join(BATCH, "cards-th.jsonl");
export const SIMILAR_FILE = join(BATCH, "similar.json");
export const AI_FIX_FILE = join(BATCH, "ai-fix-results.json");
const MAX_IDS = 2000; // shortcut: a pattern matching more cards than this is probably too broad — kept capped, raise if a real one needs it

/** ผลแปลล่าสุดของแต่ละใบจาก batch (บรรทัดหลังสุดชนะ เหมือน import-batch) → Map id → { id, name, en, th, … } */
let latestCache = null;
export function loadLatest(file = JSONL) {
  if (latestCache) return latestCache;
  const m = new Map();
  if (existsSync(file)) for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); m.set(String(r.id), r); } catch {} // บรรทัดที่ batch กำลังเขียนค้างอยู่
  }
  return (latestCache = m);
}

const cardStatus = id => { try { return JSON.parse(readFileSync(join(CARDS_DIR, `${id}.json`), "utf8")); } catch { return null; } };

/** ใบอื่นที่ยังเป็นคำแปลของ AI และยังผิดแบบเดียวกัน (เรียงยอดนิยมก่อนไม่ได้ เพราะ jsonl ไม่มียอดดู — review-ui เรียงเอง) */
export function findSimilar(pattern, excludeId) {
  const out = [];
  for (const r of loadLatest().values()) {
    if (String(r.id) === String(excludeId) || !hasPatternMistake(r.en, r.th, pattern)) continue;
    const c = cardStatus(r.id); // ใบที่คนตรวจ/แก้แล้วไม่แตะ และใช้คำแปลปัจจุบันจากไฟล์การ์ด (อาจแก้ใน review-ui แล้ว)
    if (!c || c.status !== "ai" || !hasPatternMistake(r.en, c.th, pattern)) continue;
    out.push({ id: String(r.id), name: r.name });
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

/** AI สรุปรูปแบบ → ตรวจว่าตรงกับข้อความจริง → หาใบอื่น · null ถ้าไม่ใช่ความผิดที่ซ้ำได้ */
export async function similarFor(mistakePattern, { en, id, currentTh, proposed }) {
  const p = cleanPattern(await mistakePattern(en, currentTh, proposed));
  if (!p || !patternFits(en, currentTh, proposed, p)) return null; // AI ตอบไม่ตรงกับสิ่งที่แก้จริง → ไม่ใช้
  return { pattern: p, cards: findSimilar(p, id) };
}

// ---- batch\similar.json: { key: { source, card, name, pattern, cards: [{id,name}], status, at } } ----
const readJson = f => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; } };
const writeJson = (f, o) => { writeFileSync(f + ".tmp", JSON.stringify(o, null, 1)); renameSync(f + ".tmp", f); };
export const readSimilar = () => readJson(SIMILAR_FILE);
/** เพิ่ม/อัปเดตรายการ — ถ้าผู้ดูแลตัดสินไปแล้ว (sent/ignored) และรูปแบบเดิม คงสถานะไว้ */
export function putSimilar(key, entry) {
  const all = readSimilar(), old = all[key];
  const same = old && JSON.stringify(old.pattern) === JSON.stringify(entry.pattern);
  all[key] = { ...entry, status: same ? old.status : "pending", at: new Date().toISOString() };
  writeJson(SIMILAR_FILE, all);
}
export function setSimilarStatus(key, status) {
  const all = readSimilar();
  if (!all[key]) return false;
  all[key].status = status; all[key].decided = new Date().toISOString();
  writeJson(SIMILAR_FILE, all);
  return true;
}

// ---- batch\ai-fix-results.json: { id: { verdict, checks, th_sha, at, keys } } (เขียนโดย ai-fix, review-ui อ่าน) ----
export const readAiFix = () => readJson(AI_FIX_FILE);
export const writeAiFix = o => writeJson(AI_FIX_FILE, o);
