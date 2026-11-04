// ygo-th extension v2 — no AI. Downloads the signed translation database from GitHub Pages and answers lookups.
import { getCard, getMeta, replaceAll } from "./db.js";

const API = "https://prachpawee-tang.github.io/ygo-th/v1/";
// keys/ygo-th.pub.pem (Ed25519, SPKI) — rotate together with the signing key
const PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAgECgk6Xzw3I/BvX2vC+TPzWK7XKFiuns9DczVpZkLKQ=";
const FORMAT = "ygo-th/v1";
const MAX_MANIFEST = 64 * 1024;
const MAX_GZ = 30 * 1024 * 1024;
const MAX_TH = 6000;
const STATUSES = new Set(["ai", "community", "reviewed"]);
const CHECK_EVERY_MIN = 12 * 60;

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();
const sha256 = async data => hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data));

let pubKey = null;
async function publicKey() {
  return (pubKey ??= await crypto.subtle.importKey("spki", b64(PUBLIC_KEY_B64), { name: "Ed25519" }, false, ["verify"]));
}

async function fetchLimited(url, max) {
  const res = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "error" });
  if (!res.ok) throw new Error(`ดาวน์โหลด ${url.slice(API.length)} ไม่ได้ (HTTP ${res.status})`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > max) throw new Error("ไฟล์ใหญ่ผิดปกติ");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > max) throw new Error("ไฟล์ใหญ่ผิดปกติ");
  return buf;
}

async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function cleanCards(all) {
  if (!all || typeof all !== "object" || Array.isArray(all)) throw new Error("รูปแบบฐานข้อมูลไม่ถูกต้อง");
  const out = {};
  for (const [id, c] of Object.entries(all)) {
    if (!/^\d{3,10}$/.test(id) || !c || typeof c.th !== "string" || !c.th.trim() || c.th.length > MAX_TH) continue;
    out[id] = {
      name: typeof c.name === "string" ? c.name.slice(0, 200) : "",
      th: c.th,
      status: STATUSES.has(c.status) ? c.status : "ai",
      en_sha256: /^[0-9a-f]{64}$/.test(c.en_sha256 ?? "") ? c.en_sha256 : null
    };
  }
  return out;
}

async function setState(patch) {
  const { sync = {} } = await chrome.storage.local.get("sync");
  await chrome.storage.local.set({ sync: { ...sync, ...patch } });
}

let syncing = null;
/** Check for a newer database. Returns { updated, version }. Never replaces data unless every check passes. */
function sync() {
  return (syncing ??= doSync().finally(() => { syncing = null; }));
}

async function doSync() {
  const checked = new Date().toISOString();
  try {
    const raw = new TextDecoder().decode(await fetchLimited(API + "manifest.json", MAX_MANIFEST));
    const { manifest, signature } = JSON.parse(raw);
    if (!manifest || typeof signature !== "string") throw new Error("manifest ไม่มีลายเซ็น");
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, await publicKey(), b64(signature),
      new TextEncoder().encode(JSON.stringify(manifest)));
    if (!ok) throw new Error("ลายเซ็น manifest ไม่ถูกต้อง — ไม่อัปเดต");
    if (manifest.format !== FORMAT) throw new Error(`รูปแบบ ${manifest.format} ไม่รองรับ — อัปเดต extension`);
    if (!Number.isSafeInteger(manifest.version)) throw new Error("เวอร์ชันไม่ถูกต้อง");

    const meta = await getMeta();
    if (meta && manifest.version <= meta.version) {
      await setState({ checked, error: null });
      return { updated: false, version: meta.version };
    }

    const a = manifest.all || {};
    if (a.path !== "all.json.gz" || !/^[0-9a-f]{64}$/.test(a.sha256 ?? "")) throw new Error("manifest ไม่ถูกต้อง");
    const gz = await fetchLimited(API + a.path, MAX_GZ);
    if (gz.byteLength !== a.bytes) throw new Error("ขนาดไฟล์ไม่ตรงกับ manifest");
    if (await sha256(gz) !== a.sha256) throw new Error("sha256 ไม่ตรงกับ manifest — ไม่อัปเดต");

    const cards = cleanCards(JSON.parse(await gunzip(gz)));
    const count = Object.keys(cards).length;
    await replaceAll(cards, { version: manifest.version, built: manifest.built, passcodes: count, counts: manifest.counts });
    memo.clear();
    await setState({ checked, error: null });
    return { updated: true, version: manifest.version };
  } catch (e) {
    await setState({ checked, error: String(e?.message || e) });
    throw e;
  }
}

// ---------- lookup ----------
const memo = new Map(); // passcode → card | null (small LRU-ish cache; the SW restarts often anyway)
async function lookup(id, en) {
  if (typeof id !== "string" || !/^\d{3,10}$/.test(id)) return { ok: true, found: false };
  let card = memo.get(id);
  if (card === undefined) {
    card = await getCard(id);
    if (memo.size > 500) memo.clear();
    memo.set(id, card);
  }
  if (!card) {
    const meta = await getMeta();
    return { ok: true, found: false, empty: !meta };
  }
  const stale = !!(card.en_sha256 && typeof en === "string" && en && (await sha256(norm(en))) !== card.en_sha256);
  return { ok: true, found: true, th: card.th, status: card.status, stale };
}

// ---------- messages ----------
// content scripts may only look up; sync / status come from the popup (an extension page)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL("")) && !sender.tab;
  const run = async () => {
    switch (msg?.type) {
      case "lookup":
        if (typeof msg.en === "string" && msg.en.length > 20000) return { ok: false, error: "ข้อความยาวเกิน" };
        return lookup(msg.id, msg.en);
      case "status":
        if (!fromExtensionPage) break;
        return { ok: true, meta: await getMeta(), sync: (await chrome.storage.local.get("sync")).sync || {} };
      case "sync":
        if (!fromExtensionPage) break;
        return { ok: true, ...(await sync()) };
    }
    return { ok: false, error: "ไม่อนุญาต" };
  };
  run().then(reply, e => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});

// ---------- schedule ----------
const ensureAlarm = async () => {
  if (!(await chrome.alarms.get("sync"))) chrome.alarms.create("sync", { periodInMinutes: CHECK_EVERY_MIN, delayInMinutes: 1 });
};
chrome.alarms.onAlarm.addListener(a => { if (a.name === "sync") sync().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); sync().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); sync().catch(() => {}); });
