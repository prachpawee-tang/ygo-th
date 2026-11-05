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
  const allowed = new Set(["id", "name", "th", "status", "en_sha256", "model", "updated", "alt", "note"]);
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
  return p;
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
  const missing = a.filter(n => { const i = b.indexOf(n); if (i < 0) return true; b.splice(i, 1); return false; });
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

export function loadCards() {
  if (!existsSync(CARDS_DIR)) return [];
  return readdirSync(CARDS_DIR).filter(f => f.endsWith(".json")).sort()
    .map(f => ({ file: f, card: JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")) }));
}

export const cardJson = c => JSON.stringify(c, ["id", "name", "th", "status", "en_sha256", "model", "updated", "alt", "note"], 2) + "\n";
