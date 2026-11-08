// ygo-th shared helpers — no dependencies (Node 20+)
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CARDS_DIR = join(ROOT, "data", "cards");
export const STATUSES = ["ai", "community", "reviewed"];
export const MAX_TH = 6000;

/** Normalise card text the same way the extension does before hashing/comparing. */
export const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
export const sha256 = s => createHash("sha256").update(s, "utf8").digest("hex");
export const enHash = en => sha256(norm(en));

export const isPasscode = id => typeof id === "string" && /^\d{3,10}$/.test(id);

/** Validate one card record. Returns a list of problems (empty = valid). */
export function checkCardSchema(c) {
  const p = [];
  const allowed = new Set(["id", "name", "th", "status", "en_sha256", "model", "updated", "alt", "note", "credit"]);
  for (const k of Object.keys(c)) if (!allowed.has(k)) p.push(`unknown field "${k}"`);
  if (!isPasscode(c.id)) p.push("id must be a numeric passcode");
  if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 200) p.push("name required (≤200 chars)");
  if (typeof c.th !== "string" || !c.th.trim()) p.push("th required");
  else {
    if (c.th.length > MAX_TH) p.push(`th too long (>${MAX_TH})`);
    p.push(...unsafeText(c.th));
  }
  if (!STATUSES.includes(c.status)) p.push(`status must be one of ${STATUSES.join("/")}`);
  if (!/^[0-9a-f]{64}$/.test(c.en_sha256 ?? "")) p.push("en_sha256 must be a sha256 hex");
  if (c.alt !== undefined && !(Array.isArray(c.alt) && c.alt.every(isPasscode))) p.push("alt must be passcodes");
  if (c.updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(c.updated)) p.push("updated must be YYYY-MM-DD");
  if (c.credit !== undefined && cleanCredit(c.credit) !== c.credit) p.push(`credit must be a short plain name (≤${MAX_CREDIT} chars)`);
  return p;
}

/** Contributor name shown publicly ("แก้โดย …") — public text from a stranger: short, plain, no links/mentions/HTML. "" = drop it. */
export const MAX_CREDIT = 40;
export function cleanCredit(s) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_CREDIT || unsafeText(t).length || /[@#*_`[\]()|\\]/.test(t)) return "";
  return t;
}

/** Text that must never appear in a translation (it is rendered as plain text, but we reject it anyway). */
export function unsafeText(th) {
  const p = [];
  if (/[<>]/.test(th)) p.push("contains < or >");
  if (/https?:\/\/|www\./i.test(th)) p.push("contains a URL");
  if (/```|\[[^\]]*\]\([^)]*\)/.test(th)) p.push("contains markdown");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/.test(th)) p.push("contains control/bidi characters");
  return p;
}

// ---------- deterministic rule checks (no AI) ----------
const numbersIn = s => (norm(s).match(/\d+/g) || []).sort();
const quotedIn = s => (String(s).match(/"[^"]+"|“[^”]+”/g) || []).map(q => q.replace(/[“”]/g, '"')).sort();
const count = (s, ch) => String(s).split(ch).length - 1;

/**
 * Compare a Thai translation with its English source.
 * Returns { ok, problems[] } — problems are things a human/AI must look at.
 */
export function ruleCheck(en, th) {
  const problems = [];
  const a = numbersIn(en), b = numbersIn(th);
  let missing = a.filter(n => { const i = b.indexOf(n); if (i < 0) return true; b.splice(i, 1); return false; });
  // "1" is often written as a word in natural Thai: "1 of these effects" → "เอฟเฟกต์ใดเอฟเฟกต์หนึ่ง",
  // "only once" → "ครั้งเดียว", "a single card" → "ใบเดียว" — each such word covers one missing "1"
  let ones = (String(th).replace(/"[^"]*"|“[^”]*”/g, "").match(/หนึ่ง|เดียว/g) || []).length;
  missing = missing.filter(n => !(n === "1" && ones-- > 0));
  if (missing.length) problems.push(`numbers missing in Thai: ${[...new Set(missing)].join(", ")}`);

  const qa = quotedIn(en), qb = new Set(quotedIn(th));
  const lost = qa.filter(q => !qb.has(q));
  if (lost.length) problems.push(`card names in quotes changed/missing: ${[...new Set(lost)].join(", ")}`);

  if (count(th, ";") < count(en, ";")) problems.push(`fewer ";" than English (${count(th, ";")} < ${count(en, ";")}) — cost/resolution split may be lost`);
  if (count(th, ":") < count(en, ":")) problems.push(`fewer ":" than English (${count(th, ":")} < ${count(en, ":")}) — activation condition may be lost`);
  if (count(en, "●") !== count(th, "●")) problems.push(`bullet (●) count differs`);

  // key game words whose Thai must appear at least as often (card names in quotes don't count)
  const enPlain = String(en).replace(/"[^"]*"|“[^”]*”/g, "");
  const thPlain = String(th).replace(/"[^"]*"|“[^”]*”/g, "");
  const n = (s, re) => (s.match(re) || []).length;
  const KEY = [
    // the English word kept as-is in the Thai text also counts
    [/\bbanish/gi, /ออกจากเกม|banish/gi, "banish", "ออกจากเกม"],
    [/\bface-up\b/gi, /หงาย|face-up/gi, "face-up", "หงาย"],
    [/\bface-down\b/gi, /คว่ำ|face-down/gi, "face-down", "คว่ำ"]
  ];
  for (const [reEn, reTh, w, t] of KEY) {
    const e = n(enPlain, reEn), x = n(thPlain, reTh);
    if (x < e) problems.push(`"${w}" ×${e} in English but "${t}" ×${x} in Thai — meaning may be wrong`);
  }
  if (!/[฀-๿]/.test(th) && /[a-z]{4,}\s+[a-z]{4,}/i.test(en.replace(/"[^"]+"/g, ""))) problems.push("no Thai text");
  problems.push(...unsafeText(th));
  return { ok: problems.length === 0, problems };
}

/** แบ่งข้อความอังกฤษเป็นประโยคแบบเดียวกับเว็บ (Engine.PSCT) และ Split-Sentences ใน batch\translate-all.ps1
 *  — batch โหมดบรรทัดแปล 1 ประโยค = 1 บรรทัดไทย จึงจับคู่ประโยคกับบรรทัดได้ (ใช้โดย retry-flagged และ ai-fix) */
const QUOTES = new Set(['"', "“", "”"]);
export function splitSentences(t) {
  const out = [];
  for (const line of String(t).replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    let cur = "", q = false, d = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]; cur += c;
      if (QUOTES.has(c)) q = !q;
      else if (!q && c === "(") d++;
      else if (!q && c === ")") d = Math.max(0, d - 1);
      else if (c === "." && !q && !d && (i === line.length - 1 || line[i + 1] === " ")) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

// ปัญหาจาก rule-check → วิธีแก้แบบเจาะจงให้โมเดล (12b ทำตามคำสั่งเจาะจงได้ดีกว่าคำเตือนกว้าง ๆ)
// ใช้ร่วมกันโดย batch/retry-flagged.mjs (แปลใหม่ทั้งใบ) และ batch/ai-fix.mjs (แก้เฉพาะจุด)
export const RULE_HINTS = [
  [/"face-up"/, 'English "face-up" MUST be translated as หงาย (face-up = หงาย, face-down = คว่ำ). Never write คว่ำ for face-up.'],
  [/"face-down"/, 'English "face-down" MUST be translated as คว่ำ (face-down = คว่ำ, face-up = หงาย).'],
  [/"banish"/, 'EVERY "banish" MUST be written as เอา … ออกจากเกม (banish from Y → เอา X ออกจากเกมจาก Y; e.g. banish 3 cards from your Extra Deck → เอาการ์ด 3 ใบออกจากเกมจากเอ็กซ์ตร้าเด็คของคุณ). เอา…ออกจากเด็ค/มือ/สุสาน without เกม is WRONG.'],
  [/numbers missing/, "Keep EVERY number from the English, including 1 (e.g. Tribute 1 monster → สังเวยมอนสเตอร์ 1 ตัว; 1 Level 1 Monster → มอนสเตอร์ Level 1 จำนวน 1 ตัว)."],
  [/fewer ":"/, 'Keep every ":" — the text before ":" is the condition (e.g. Once per Chain, when …: → 1 ครั้งต่อเชน, เมื่อ …:).'],
  [/fewer ";"/, 'Keep every ";" — the text before ";" is the cost/target, after it the effect.'],
  [/card names in quotes/, 'Copy every "card name" in double quotes exactly as in English.']
];
export const hintsFor = problems => [...new Set(problems.map(p => (RULE_HINTS.find(([re]) => re.test(p)) || [null, p])[1]))];

// ---------- "the same mistake" patterns (from accepted fixes) ----------
// { en: "face-up", wrong: "คว่ำ", right: "หงาย" } = English phrase en should be right, but was written wrong.
const unquote = s => String(s).replace(/"[^"]*"|“[^”]*”/g, "");
const countCI = (s, sub) => sub ? unquote(s).toLowerCase().split(sub.toLowerCase()).length - 1 : 0;
/** Clean an AI-proposed pattern; null if it is not a usable, checkable pattern. Text comes from an untrusted suggestion. */
export function cleanPattern(p) {
  if (!p || typeof p !== "object") return null;
  const t = s => String(s ?? "").replace(/[\r\n\t"“”<>]/g, " ").replace(/\s+/g, " ").trim();
  const out = { en: t(p.en), wrong: t(p.wrong), right: t(p.right) };
  if (out.en.length < 3 || out.en.length > 60 || !out.wrong || out.wrong.length > 40 || !out.right || out.right.length > 40) return null;
  if (out.wrong === out.right || out.right.includes(out.wrong) || unsafeText(out.en + out.wrong + out.right).length) return null;
  // the part of `right` that differs from `wrong`: "คว่ำอยู่" → "หงายอยู่" counts "หงาย", so a card that already says plain "หงาย" is not a match
  let a = 0, b = 0;
  while (a < out.wrong.length && a < out.right.length && out.wrong[a] === out.right[a]) a++;
  while (b < out.wrong.length - a && b < out.right.length - a && out.wrong.at(-1 - b) === out.right.at(-1 - b)) b++;
  const core = out.right.slice(a, out.right.length - b).trim();
  out.rightCore = core.length >= 2 ? core : out.right;
  return out;
}
/** Does this translation still make the pattern's mistake? (English has the phrase, Thai has the wrong words and too few right ones) */
export const hasPatternMistake = (en, th, p) => {
  const e = countCI(en, p.en);
  return e > 0 && countCI(th, p.wrong) > 0 && countCI(th, p.rightCore || p.right) < e;
};
/** The fix really is this pattern: the old Thai made the mistake and the new Thai does not. */
export const patternFits = (en, oldTh, newTh, p) => hasPatternMistake(en, oldTh, p) && !hasPatternMistake(en, newTh, p);

// ---------- how much a translation changed (word level, Thai-aware) ----------
const SEG = new Intl.Segmenter("th", { granularity: "word" });
const words = s => [...SEG.segment(String(s))].filter(x => x.isWordLike).map(x => x.segment);
/** { changed: deleted + inserted, deleted, inserted, total: words in both } — used to refuse "fixes" that rewrite the whole card. */
export function wordChange(a, b) {
  const x = words(a), y = words(b), n = x.length, m = y.length;
  let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[m];
  return { changed: n + m - 2 * lcs, deleted: n - lcs, inserted: m - lcs, total: n + m };
}

export function loadCards() {
  if (!existsSync(CARDS_DIR)) return [];
  return readdirSync(CARDS_DIR).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ file: f, card: JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")) }));
}

export const cardJson = c => JSON.stringify(c, ["id", "name", "th", "status", "en_sha256", "model", "updated", "alt", "credit", "note"], 2) + "\n";
