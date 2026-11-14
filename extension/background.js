// ygo-th extension v2 — no AI. Downloads the signed translation database from GitHub Pages and answers lookups.
import { getCard, getMeta, replaceAll, nameIndex } from "./db.js";

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
      en_sha256: /^[0-9a-f]{64}$/.test(c.en_sha256 ?? "") ? c.en_sha256 : null,
      // contributor name — same rule as tools/lib.mjs cleanCredit (short, no links/mentions/markup)
      credit: typeof c.credit === "string" && c.credit.length <= 40 && !/[<>@#*_`[\]()|\\]|https?:\/\/|www\./i.test(c.credit) ? c.credit : ""
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
    memo.clear(); names = null;
    await setState({ checked, error: null });
    return { updated: true, version: manifest.version };
  } catch (e) {
    await setState({ checked, error: String(e?.message || e) });
    throw e;
  }
}

// ---------- lookup ----------
const memo = new Map(); // passcode → card | null (small LRU-ish cache; the SW restarts often anyway)
async function cardById(id) {
  let card = memo.get(id);
  if (card === undefined) {
    card = await getCard(id);
    if (memo.size > 500) memo.clear();
    memo.set(id, card);
  }
  return card;
}

// Dueling Nexus gives some alternate artworks its own number, not the official passcode
// (Brain Control shows 87910998, real 87910978) → not found by number, so try the English card name it shows.
let names = null; // card name (lower case) → passcode · built once per service-worker life, dropped on sync
async function idByName(name) {
  if (typeof name !== "string" || !name.trim() || name.length > 200) return null;
  names ??= await nameIndex();
  return names.get(name.trim().toLowerCase()) ?? null;
}

async function lookup(id, en, name) {
  if (typeof id !== "string" || !/^\d{3,10}$/.test(id)) id = null;
  let card = id ? await cardById(id) : null;
  if (!card) {
    const byName = await idByName(name);
    if (byName) { id = byName; card = await cardById(byName); }
  }
  if (!card) {
    const meta = await getMeta();
    return { ok: true, found: false, empty: !meta };
  }
  // the English text check still guards a name match: a different card text shows "อาจเก่า"
  const stale = !!(card.en_sha256 && typeof en === "string" && en && (await sha256(norm(en))) !== card.en_sha256);
  return { ok: true, found: true, id, th: card.th, status: card.status, credit: card.credit || "", stale };
}

// ---------- extension updates (GitHub Releases) ----------
// extension ที่โหลดแบบ unpacked อัปเดตตัวเองไม่ได้ → เช็กว่ามี Release ใหม่ไหม แล้วบอกใน popup
// GitHub API ส่ง CORS "*" มาให้ จึงไม่ต้องขอสิทธิ์ api.github.com เพิ่ม · จำกัด 60 ครั้ง/ชม./IP เราเรียกไม่เกินชั่วโมงละครั้ง
const RELEASES = "https://api.github.com/repos/prachpawee-tang/ygo-th/releases?per_page=10";
const RELEASE_PAGE = "https://github.com/prachpawee-tang/ygo-th/releases/";

/** "2.10.0" > "2.9.3" */
export function newerVersion(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkUpdate(force = false) {
  const { update = {} } = await chrome.storage.local.get("update");
  if (!force && update.checked && Date.now() - Date.parse(update.checked) < 60 * 60 * 1000) return update;
  const current = chrome.runtime.getManifest().version;
  const next = { checked: new Date().toISOString(), current, latest: null, url: null };
  try {
    const res = await fetch(RELEASES, { cache: "no-store", credentials: "omit", headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      for (const r of await res.json()) {
        const m = /^ext-v(\d+\.\d+\.\d+)$/.exec(r?.tag_name || "");
        if (!m || r.draft || r.prerelease) continue;
        // ลิงก์ที่จะให้ผู้ใช้กด ต้องเป็นหน้า Release ของ repo เราเท่านั้น
        const url = RELEASE_PAGE + "tag/" + r.tag_name;
        if (!next.latest || newerVersion(m[1], next.latest)) { next.latest = m[1]; next.url = url; }
      }
    }
  } catch { /* ออฟไลน์ — ลองใหม่รอบหน้า */ }
  next.available = !!(next.latest && newerVersion(next.latest, current));
  await chrome.storage.local.set({ update: next });
  // ป้ายบนไอคอน extension ให้เห็นโดยไม่ต้องเปิด popup
  try {
    await chrome.action.setBadgeText({ text: next.available ? "NEW" : "" });
    if (next.available) await chrome.action.setBadgeBackgroundColor({ color: "#c9a227" });
  } catch {}
  return next;
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
        return lookup(msg.id, msg.en, msg.name);
      case "status": {
        if (!fromExtensionPage) break;
        // answer at once with the last known update info; refresh it in the background (popup listens to storage.onChanged)
        checkUpdate().catch(() => {});
        const { sync = {}, update = null } = await chrome.storage.local.get(["sync", "update"]);
        return { ok: true, meta: await getMeta(), sync, update };
      }
      case "sync": {
        if (!fromExtensionPage) break;
        const [r, update] = await Promise.all([sync(), checkUpdate(true)]);
        return { ok: true, ...r, update };
      }
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
chrome.alarms.onAlarm.addListener(a => { if (a.name === "sync") { sync().catch(() => {}); checkUpdate().catch(() => {}); } });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); sync().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); sync().catch(() => {}); });
