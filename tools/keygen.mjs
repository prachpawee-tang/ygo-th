// Create the Ed25519 key pair that signs the API manifest.
// Run ONCE on the maintainer's PC:  node tools/keygen.mjs "E:\YGO-Translator\keys"
// - private key → <dir>/ygo-th-signing.pem  (KEEP SECRET: paste into GitHub secret YGOTH_SIGNING_KEY, back it up offline)
// - public key  → keys/ygo-th.pub.pem in this repo (commit it; the extension embeds it)
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ROOT } from "./lib.mjs";

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/keygen.mjs "<folder OUTSIDE the repo>"'); process.exit(2); }
// resolve(): a relative path like "keys" must count as inside the repo · case-insensitive for Windows drive letters
if ((resolve(dir) + sep).toLowerCase().startsWith((resolve(ROOT) + sep).toLowerCase())) { console.error("refusing: private key folder must be outside the repository"); process.exit(2); }
const priv = join(dir, "ygo-th-signing.pem");
if (existsSync(priv)) { console.error(`refusing: ${priv} already exists (rotate keys deliberately)`); process.exit(2); }
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
mkdirSync(dir, { recursive: true });
writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
mkdirSync(join(ROOT, "keys"), { recursive: true });
writeFileSync(join(ROOT, "keys", "ygo-th.pub.pem"), publicKey.export({ type: "spki", format: "pem" }));
console.log(`private key: ${priv}\npublic key:  keys/ygo-th.pub.pem`);
