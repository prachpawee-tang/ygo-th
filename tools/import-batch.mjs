// Import the local batch output (cards-th.jsonl from translate-all.ps1) into data/cards/*.json
// Usage: node tools/import-batch.mjs path/to/cards-th.jsonl [path/to/verified.json]
// - never stores the English text (copyright) — only its sha256
// - never overwrites a card whose status is already community/reviewed
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CARDS_DIR, enHash, checkCardSchema, cardJson, ruleCheck } from "./lib.mjs";

const [, , jsonl, verifiedPath] = process.argv;
if (!jsonl) { console.error("usage: node tools/import-batch.mjs cards-th.jsonl [verified.json]"); process.exit(2); }
mkdirSync(CARDS_DIR, { recursive: true });

const verified = new Map();
if (verifiedPath && existsSync(verifiedPath)) {
  for (const v of JSON.parse(readFileSync(verifiedPath, "utf8")).cards || []) if (v.id) verified.set(String(v.id), v);
}

let added = 0, kept = 0, flagged = 0, invalid = 0;
const today = new Date().toISOString().slice(0, 10);
for (const line of readFileSync(jsonl, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const file = join(CARDS_DIR, `${r.id}.json`);
  if (existsSync(file)) {
    const cur = JSON.parse(readFileSync(file, "utf8"));
    if (cur.status !== "ai") { kept++; continue; }
  }
  const v = verified.get(String(r.id));
  const card = {
    id: String(r.id),
    name: r.name,
    th: (v?.th ?? r.th).trim(),
    status: v ? "reviewed" : "ai",
    en_sha256: enHash(r.en),
    model: v ? undefined : r.model,
    updated: today,
    alt: (r.alt || []).map(String).filter(a => a !== String(r.id))
  };
  if (!card.alt.length) delete card.alt;
  const rc = ruleCheck(r.en, card.th);
  if (!rc.ok && !v) { card.note = "rule-check: " + rc.problems.join("; "); flagged++; }
  const problems = checkCardSchema(card);
  if (problems.length) { invalid++; console.warn(`skip ${r.id} ${r.name}: ${problems.join("; ")}`); continue; }
  writeFileSync(file, cardJson(card));
  added++;
}
console.log(`imported ${added} · kept (community/reviewed) ${kept} · flagged by rule-check ${flagged} · invalid ${invalid}`);
