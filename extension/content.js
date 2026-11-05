(() => {
  // Dueling Nexus: #card-description = ข้อความการ์ด, #card-id = "26077387 (TCG/OCG)", #card-name
  const SELECTORS = ["#card-description", "#card-text", ".card-description", ".card-text"];
  const MIN_LEN = 8;
  const REPO = "https://github.com/prachpawee-tang/ygo-th";
  const STATUS_LABEL = { reviewed: "✓ ตรวจแล้ว", community: "👥 ชุมชน", ai: "🤖 AI (ยังไม่ตรวจ)" };

  let settings = { enabled: true, displayMode: "replace" }; // replace | below
  let lastKey = "";    // id + text ของการ์ดที่แสดงล่าสุด
  let lastRes = null;  // ผล lookup ของ lastKey (null = กำลังหา/หาไม่สำเร็จ)
  let timer = null;

  // ---------- settings ----------
  chrome.storage.local.get("settings").then(({ settings: s }) => {
    settings = { ...settings, ...(s || {}) };
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.settings || changes.sync)) {
      if (changes.settings) settings = { ...settings, ...(changes.settings.newValue || {}) };
      resetAll();
      schedule();
    }
  });

  const isOurs = node => {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return !!el?.closest?.(".ygot-panel, .ygot-badge");
  };

  function findTarget() {
    for (const sel of SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (isOurs(el) || el.offsetParent === null) continue;
        if (textOf(el).length >= MIN_LEN) return el;
      }
    }
    return null;
  }

  function cardId() {
    const t = document.querySelector("#card-id")?.textContent || "";
    return (t.match(/\d{3,10}/) || [null])[0];
  }

  // ---------- เขียนทับ + คลิกสลับ TH/EN ----------
  const replaced = new WeakMap(); // el → { th, origHTML, showing }
  const bound = new WeakSet();
  let lastTarget = null;

  // ข้อความภาษาอังกฤษจริงของช่อง (ถ้าเราเขียนทับอยู่ ใช้ต้นฉบับที่เก็บไว้)
  function textOf(el) {
    const st = replaced.get(el);
    if (st && isOurWrite(el)) {
      const tmp = document.createElement("template"); // inert: ไม่โหลดรูป/ไม่รันอะไร
      tmp.innerHTML = st.origHTML; // HTML เดิมของเว็บเอง ไม่ใช่ข้อมูลจากฐานคำแปล
      return (tmp.content.textContent || "").trim();
    }
    return (el.innerText || "").trim();
  }

  function isOurWrite(el) {
    const st = replaced.get(el);
    if (!st) return false;
    return st.showing === "th" ? el.textContent === st.text : el.innerHTML === st.origHTML;
  }

  // คำแปล → บล็อกมีเว้นวรรค + สี แบบเดียวกับที่เว็บจัดภาษาอังกฤษ (format.js)
  // สร้างด้วย createElement + textContent เท่านั้น — ห้าม innerHTML กับคำแปล
  const SEG_CLASS = { cond: "ygot-cond", cost: "ygot-cost", summon: "ygot-summon", name: "ygot-name", limit: "ygot-limit", quick: "ygot-quick" };
  function renderThai(el, th) {
    el.textContent = "";
    let blocks;
    try { blocks = globalThis.ygotFormatThai(th); } catch { blocks = null; }
    if (!blocks?.length) { el.textContent = th; return el.textContent; }
    for (const b of blocks) {
      const div = document.createElement("span");
      div.className = "ygot-block";
      for (const s of b.segs) {
        if (!s.cls.length) { div.append(document.createTextNode(s.text)); continue; }
        const span = document.createElement("span");
        span.className = s.cls.map(c => SEG_CLASS[c]).filter(Boolean).join(" ");
        span.textContent = s.text;
        div.append(span);
      }
      el.append(div);
    }
    return el.textContent;
  }

  function writeThai(el, th) {
    const prev = replaced.get(el);
    const origHTML = prev && isOurWrite(el) ? prev.origHTML : el.innerHTML;
    el.classList.add("ygot-replaced");
    const text = renderThai(el, th);
    replaced.set(el, { th, text, origHTML, showing: "th" });
    el.title = "คลิกเพื่อสลับ ไทย / English";
    if (!bound.has(el)) {
      bound.add(el);
      el.addEventListener("click", () => {
        const st = replaced.get(el);
        if (!st || !isOurWrite(el)) return;
        if (st.showing === "th") { st.showing = "en"; el.classList.remove("ygot-replaced"); el.innerHTML = st.origHTML; }
        else { st.showing = "th"; el.classList.add("ygot-replaced"); st.text = renderThai(el, st.th); }
      });
    }
  }

  function restore(el) {
    const st = replaced.get(el);
    if (st && isOurWrite(el) && st.showing === "th") el.innerHTML = st.origHTML;
    replaced.delete(el);
    el.classList.remove("ygot-replaced");
    el.removeAttribute("title");
  }

  // ---------- แผง (โหมดใต้ต้นฉบับ) + ป้าย ----------
  let panel = null, badge = null;
  function removeExtras() { panel?.remove(); panel = null; badge?.remove(); badge = null; }
  function resetAll() {
    if (lastTarget) restore(lastTarget);
    removeExtras();
    lastKey = ""; lastRes = null;
  }

  const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

  function issueLink(kind, id) {
    const url = new URL(REPO + "/issues/new");
    url.searchParams.set("template", kind === "fix" ? "fix-translation.yml" : "errata.yml");
    if (id) url.searchParams.set("passcode", id);
    const a = el("a", { href: url.href, target: "_blank", rel: "noopener noreferrer",
      textContent: kind === "fix" ? "แจ้งแก้คำแปล" : "แจ้งการ์ดที่ไม่มีคำแปล" });
    a.addEventListener("click", e => e.stopPropagation());
    return a;
  }

  function showBadge(target, id, res) {
    if (!badge) {
      badge = el("span", { className: "ygot-badge" });
      badge.addEventListener("click", e => e.stopPropagation());
    }
    const anchor = panel || target;
    if (badge.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", badge);
    badge.textContent = "";
    if (!res.found) {
      badge.append(el("span", { textContent: res.empty ? "ยังไม่ได้โหลดฐานคำแปล — เปิด popup แล้วกด “อัปเดตตอนนี้”" : "ยังไม่มีคำแปล" }));
      if (!res.empty) badge.append(issueLink("errata", id));
      return;
    }
    badge.append(el("span", { className: "ygot-st-" + res.status, textContent: STATUS_LABEL[res.status] || res.status }));
    if (res.stale) badge.append(el("span", { className: "ygot-stale", textContent: "⚠ อาจเก่า",
      title: "ข้อความภาษาอังกฤษบนเว็บไม่ตรงกับตอนที่แปล (อาจโดน errata) — เทียบกับต้นฉบับอีกที" }));
    badge.append(issueLink("fix", id));
  }

  function showPanel(target, th) {
    if (!panel) {
      panel = el("div", { className: "ygot-panel" });
      panel.append(el("div", { className: "ygot-head", textContent: "🇹🇭 แปลไทย" }), el("div", { className: "ygot-body" }));
    }
    if (panel.previousElementSibling !== target) target.insertAdjacentElement("afterend", panel);
    renderThai(panel.querySelector(".ygot-body"), th);
  }

  function apply(target, id, res) {
    if (res.found && settings.displayMode === "replace") { panel?.remove(); panel = null; writeThai(target, res.th); }
    else if (res.found) showPanel(target, res.th);
    else { panel?.remove(); panel = null; }
    showBadge(target, id, res);
  }

  // ---------- ตรวจจับ ----------
  // throttle (ไม่ใช่ debounce): หน้า Duel แก้ DOM ทุก ~200ms (นาฬิกาเทิร์น) debounce จะไม่เคยได้รัน
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; check(); }, 150);
  }

  function check() {
    if (!settings.enabled) { resetAll(); return; }
    const target = findTarget();
    if (!target) return;
    if (isOurWrite(target)) return; // การเปลี่ยนแปลงนี้มาจากเราเอง
    const id = cardId();
    const text = textOf(target);
    const key = id + "\n" + text;
    if (lastTarget && lastTarget !== target) restore(lastTarget);
    lastTarget = target;
    if (key === lastKey) {
      // การ์ดใบเดิมถูกวาดใหม่ — ใช้ผลเดิมทันที ไม่ถามซ้ำ (ถ้ายังไม่ได้ผลก็รอ ไม่ยิงรัว)
      if (lastRes) apply(target, id, lastRes);
      return;
    }
    replaced.delete(target);
    target.classList.remove("ygot-replaced");
    removeExtras();
    lastKey = key; lastRes = null;
    try {
      chrome.runtime.sendMessage({ type: "lookup", id, en: text }, res => {
        if (chrome.runtime.lastError || !res?.ok) return;
        if (key !== lastKey) return; // ผู้ใช้เปลี่ยนการ์ดไปแล้ว
        lastRes = res;
        if (target.isConnected && textOf(target) === text) apply(target, id, res);
      });
    } catch { /* extension ถูกรีโหลด — รีเฟรชหน้าเว็บ */ }
  }

  new MutationObserver(muts => {
    if (muts.every(m => isOurs(m.target))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
