// Build the static API into site/v1/
//   manifest.json  — version, counts, sha256 of all.json.gz, Ed25519 signature
//   all.json.gz    — every card (id → {th, status, en_sha256, name})
//   cards/{id}.json — one card (also written for each alt passcode)
//   glossary.json
// Signing: set YGOTH_SIGNING_KEY to an Ed25519 private key (PEM). Without it the manifest is unsigned
// and the extension will refuse it — fine for local previews only.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createPrivateKey, sign, createHash } from "node:crypto";
import { ROOT, loadCards } from "./lib.mjs";

const OUT = join(ROOT, "site", "v1");
rmSync(join(ROOT, "site"), { recursive: true, force: true });
mkdirSync(join(OUT, "cards"), { recursive: true });

const cards = loadCards().map(x => x.card);
const all = {};
const counts = { ai: 0, community: 0, reviewed: 0 };
for (const c of cards) {
  const entry = { name: c.name, th: c.th, status: c.status, en_sha256: c.en_sha256 };
  counts[c.status]++;
  for (const id of [c.id, ...(c.alt || [])]) {
    all[id] = entry;
    writeFileSync(join(OUT, "cards", `${id}.json`), JSON.stringify({ id, canonical: c.id, ...entry, updated: c.updated }) + "\n");
  }
}
const gz = gzipSync(Buffer.from(JSON.stringify(all), "utf8"), { level: 9 });
writeFileSync(join(OUT, "all.json.gz"), gz);
writeFileSync(join(OUT, "glossary.json"), readFileSync(join(ROOT, "data", "glossary.json")));

// version = UTC timestamp so it always increases (extension rejects rollbacks)
const now = new Date();
const manifest = {
  format: "ygo-th/v1",
  version: Number(now.toISOString().replace(/\D/g, "").slice(0, 12)), // YYYYMMDDHHMM
  built: now.toISOString(),
  cards: cards.length,
  passcodes: Object.keys(all).length,
  counts,
  all: { path: "all.json.gz", bytes: gz.length, sha256: createHash("sha256").update(gz).digest("hex") }
};
const payload = JSON.stringify(manifest);
let signature = null;
if (process.env.YGOTH_SIGNING_KEY) {
  const key = createPrivateKey(process.env.YGOTH_SIGNING_KEY);
  signature = sign(null, Buffer.from(payload, "utf8"), key).toString("base64");
}
// the signed bytes are `payload` exactly; the extension verifies JSON.stringify(manifest) the same way
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ manifest, signature }, null, 2) + "\n");
writeFileSync(join(ROOT, "site", "index.html"),
  `<!doctype html><meta charset="utf-8"><title>ygo-th API</title><p>ygo-th — คำแปลการ์ดภาษาไทย (โปรเจกต์แฟน ไม่เกี่ยวข้องกับ Konami). ` +
  `ดู <a href="v1/manifest.json">v1/manifest.json</a> และ <a href="https://github.com/prachpawee-tang/ygo-th">GitHub</a>.</p>\n`);
writeFileSync(join(ROOT, "site", ".nojekyll"), "");
console.log(`built v${manifest.version}: ${cards.length} cards, ${manifest.passcodes} passcodes, all.json.gz ${(gz.length / 1024).toFixed(0)} KB, ${signature ? "signed" : "UNSIGNED"}`);
