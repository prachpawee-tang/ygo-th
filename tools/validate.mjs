// Validate every data/cards/*.json (schema + file name = id + no duplicates incl. alt ids)
// Exit code 1 on any problem. Used by CI on every PR and before build.
import { loadCards } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, checkCardSchema } from "./lib.mjs";

let bad = 0;
const seen = new Map();
for (const { file, card } of loadCards()) {
  const p = checkCardSchema(card);
  if (file !== `${card.id}.json`) p.push(`file name must be ${card.id}.json`);
  for (const id of [card.id, ...(card.alt || [])]) {
    if (seen.has(id) && seen.get(id) !== card.id) p.push(`passcode ${id} also used by ${seen.get(id)}`);
    seen.set(id, card.id);
  }
  if (p.length) { bad++; console.error(`${file}: ${p.join("; ")}`); }
}
const g = JSON.parse(readFileSync(join(ROOT, "data", "glossary.json"), "utf8"));
if (!Array.isArray(g.terms) || !g.terms.every(t => t.en && t.th)) { bad++; console.error("glossary.json: terms[] of {en, th} required"); }
console.log(bad ? `${bad} file(s) with problems` : `ok · ${seen.size} passcodes`);
process.exit(bad ? 1 : 0);
