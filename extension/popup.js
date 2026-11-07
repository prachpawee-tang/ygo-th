const $ = id => document.getElementById(id);
const fmt = iso => iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "–";
const send = msg => chrome.runtime.sendMessage(msg);

function msg(text, error = false) { $("msg").textContent = text; $("msg").className = error ? "err" : ""; }

async function refresh() {
  const r = await send({ type: "status" });
  if (!r?.ok) return;
  const m = r.meta;
  $("version").textContent = m ? `${m.version} (${fmt(m.built)})` : "ยังไม่ได้โหลด";
  $("count").textContent = m
    ? `${m.passcodes.toLocaleString()} passcode · ตรวจแล้ว ${m.counts?.reviewed ?? 0} · ชุมชน ${m.counts?.community ?? 0} · AI ${m.counts?.ai ?? 0}`
    : "–";
  $("checked").textContent = fmt(r.sync.checked);
  if (r.sync.error) msg("เช็กล่าสุดไม่สำเร็จ: " + r.sync.error, true);
  showUpdate(r.update);
}

// ป้ายมีเวอร์ชันใหม่ — สร้างด้วย textContent, ลิงก์ต้องเป็นหน้า Release ของ repo เรา (background ตรวจแล้ว ตรวจซ้ำอีกชั้น)
function showUpdate(u) {
  $("ext").textContent = chrome.runtime.getManifest().version;
  const box = $("update");
  box.textContent = "";
  const ok = u?.available && typeof u.url === "string" && u.url.startsWith("https://github.com/prachpawee-tang/ygo-th/releases/");
  box.classList.toggle("show", !!ok);
  if (!ok) return;
  box.append(`มี extension เวอร์ชันใหม่ ${u.latest} (ตอนนี้ ${u.current}) → `);
  const a = Object.assign(document.createElement("a"), { href: u.url, target: "_blank", rel: "noopener noreferrer", textContent: "ดาวน์โหลด" });
  box.append(a, document.createElement("br"), "แตก zip ทับโฟลเดอร์เดิม แล้วกดรีโหลด (↻) ที่ edge://extensions");
}

async function loadSettings() {
  const { settings: s = {} } = await chrome.storage.local.get("settings");
  $("enabled").checked = s.enabled !== false;
  $("displayMode").value = s.displayMode === "below" ? "below" : "replace";
}
async function saveSettings() {
  const { settings: s = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...s, enabled: $("enabled").checked, displayMode: $("displayMode").value } });
}
$("enabled").addEventListener("change", saveSettings);
$("displayMode").addEventListener("change", saveSettings);

$("sync").addEventListener("click", async () => {
  $("sync").disabled = true;
  msg("กำลังเช็ก…");
  const r = await send({ type: "sync" });
  $("sync").disabled = false;
  if (!r?.ok) { msg(r?.error || "ผิดพลาด", true); return; }
  msg(r.updated ? `อัปเดตเป็นเวอร์ชัน ${r.version} แล้ว — รีเฟรชหน้า Dueling Nexus` : "ฐานคำแปลเป็นเวอร์ชันล่าสุดแล้ว");
  showUpdate(r.update);
  refresh();
});

// background refreshes the update info without making the popup wait — show it when it lands
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.update) showUpdate(ch.update.newValue); });

loadSettings();
refresh();
