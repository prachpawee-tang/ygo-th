// Turn a Thai card text into styled blocks, in the same visual language Dueling Nexus uses for English:
//   condition (before ":")  → yellow · cost (between ":" and ";") → pink · summoning condition → cyan
//   "card names" → italic · use limits (1 ครั้งต่อเทิร์น…) → underline · Quick Effect → bold
//   each sentence / effect on its own block with a small gap
// Pure function → [{ segs: [{ text, cls: ["cond" | "cost" | "summon" | "name" | "limit" | "quick" ...] }] }]
// The caller builds DOM with textContent only.
(() => {
  const QUOTES = new Set(['"', "“", "”"]);

  // a new effect usually starts with one of these (used only when the AI dropped the periods)
  const STARTERS = /^(?:ถ้า|หาก|เมื่อ|ในช่วง|ระหว่าง|ตอนที่|ตอน|ขณะที่|1 ครั้งต่อเทิร์น|ครั้งเดียวต่อเทิร์น|คุณสามารถ|ในเทิร์นที่|ในขณะที่|ในระหว่าง|ใน(?:Main|Battle|Standby|End|Draw) Phase)/;
  // "(Quick Effect)" ไม่ใช่จุดเริ่มเอฟเฟกต์ — มันอยู่ท้ายเงื่อนไข ("เมื่อ … (Quick Effect):") เหมือนที่เว็บแสดงภาษาอังกฤษ

  /** index of `ch` in s at or after `from`, outside "quotes" */
  function findOutsideQuotes(s, ch, from = 0) {
    let q = false;
    for (let i = 0; i < s.length; i++) {
      if (QUOTES.has(s[i])) q = !q;
      else if (!q && i >= from && s[i] === ch) return i;
    }
    return -1;
  }

  /** split at ". " (outside quotes and brackets), like the site does for English */
  function splitPeriods(line) {
    const out = [];
    let cur = "", q = false, depth = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      cur += c;
      if (QUOTES.has(c)) q = !q;
      else if (!q && c === "(") depth++;
      else if (!q && c === ")") depth = Math.max(0, depth - 1);
      else if (!q && depth === 0 && c === "." && (i === line.length - 1 || line[i + 1] === " ")) { out.push(cur); cur = ""; }
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  /** ":" and ";" outside quotes, in order */
  function punctuation(s) {
    const out = [];
    let q = false;
    for (let i = 0; i < s.length; i++) {
      if (QUOTES.has(s[i])) q = !q;
      else if (!q && (s[i] === ":" || s[i] === ";")) out.push({ i, ch: s[i] });
    }
    return out;
  }

  // "จากนั้น ถ้า…" / "และ ถ้า…" continue the same effect — not a new one
  const CONTINUES = /(?:จากนั้น|และ|แล้ว|หรือ|แต่)\s*$/;
  const SECONDARY = /^(?:ในขณะที่|ขณะที่|ตอนที่)/;          // "while …" inside a condition
  const PRIMARY = /^(?:ถ้า|หาก|เมื่อ)/;                       // what such a condition starts with
  const startsHere = (s, i) => s[i] === " " && STARTERS.test(s.slice(i + 1)) && !CONTINUES.test(s.slice(0, i));

  /** where does the condition/cost that ends at `p` start? latest starter in (from, p), extended over "A, B, C:" chains */
  function clauseStart(s, from, p) {
    let j = -1;
    for (let i = p - 1; i > from; i--) if (startsHere(s, i)) { j = i; break; }
    if (j < 0) return -1;
    for (;;) {
      // "เมื่อ … ในขณะที่ …:" / "ถ้า … ระหว่าง …:" — the 2nd word is part of the same condition
      const inner = SECONDARY.test(s.slice(j + 1));
      if (!inner && !/,\s*$/.test(s.slice(from, j))) break;
      let k = -1;
      for (let i = j - 1; i > from; i--) if (startsHere(s, i) && (!inner || PRIMARY.test(s.slice(i + 1)))) { k = i; break; }
      // the sentence itself starts with the 1st word ("เมื่อ … ในขณะที่ …:") → whole thing is one condition, no cut
      if (k < 0 && inner && STARTERS.test(s.slice(from).trimStart()) && !/[:;]/.test(s.slice(from, j))) return -1;
      if (k < 0 || /[:;]/.test(s.slice(k, j))) break;
      j = k;
    }
    return j;
  }

  // "คุณสามารถใช้เอฟเฟกต์ … ได้ 1 ครั้งต่อเทิร์น" / "คุณสามารถเปิดใช้ … ได้เพียง 1 ใบต่อเทิร์น"
  const LIMIT = / (?:คุณ)?สามารถ(?:ใช้|เปิดใช้)[^:;]*?ต่อ(?:เทิร์น|การดวล)(?:เท่านั้น)?/g;

  /** one sentence that may hold several effects without periods → cut points (spaces) between effects */
  function splitMergedEffects(s) {
    const cuts = new Set();
    let from = 0, open = false, colon = -1; // open = current block already has its ":" or a cost ";"
    for (const { i, ch } of punctuation(s)) {
      if (ch === ":" || !open) {
        const j = clauseStart(s, from, i);
        if (j > 0) cuts.add(j);
        open = true;
        colon = ch === ":" ? i : -1;
      } else if (ch === ";" && colon >= 0) {
        // "…: effect text … คุณสามารถจ่าย LP 1000; …" → that "คุณสามารถ…;" is the cost of a NEW effect
        // (a cost right after the colon — ": คุณสามารถทิ้ง…;" — stays in the same block)
        for (let k = i - 1; k > colon + 2; k--) {
          if (startsHere(s, k) && s.startsWith("คุณสามารถ", k + 1)) { cuts.add(k); break; }
        }
        colon = -1;
      }
      from = i + 1;
    }
    for (const m of s.matchAll(LIMIT)) {
      const start = m.index, end = m.index + m[0].length;
      if (start > 0 && !/[:;]/.test(s.slice(end))) cuts.add(start);
      // "…ต่อเทิร์น และเพียงครั้งเดียว…" continues the same limit — don't cut
      if (end < s.length - 1 && s[end] === " " && !/^(?:และ|หรือ|แต่|โดย)/.test(s.slice(end + 1))) cuts.add(end);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    const parts = [];
    let last = 0;
    for (const c of sorted) { parts.push(s.slice(last, c)); last = c + 1; }
    parts.push(s.slice(last));
    return parts;
  }

  const isSummonCondition = b =>
    findOutsideQuotes(b, ":") < 0 && findOutsideQuotes(b, ";") < 0 &&
    /^(?:ต้อง|ไม่สามารถอัญเชิญ(?:ปกติ|พิเศษ)|ไม่สามารถถูกอัญเชิญ|อัญเชิญพิเศษได้เฉพาะ|การ์ดใบนี้ต้อง)/.test(b.trim()) && /อัญเชิญ/.test(b);

  const isUseLimit = b =>
    findOutsideQuotes(b, ":") < 0 && findOutsideQuotes(b, ";") < 0 &&
    /^(?:คุณ)?(?:สามารถ)?(?:ใช้|เปิดใช้|อัญเชิญพิเศษ)/.test(b.trim()) && /(?:ต่อเทิร์น|ต่อการดวล)/.test(b);

  // inline marks inside a piece of text: "names", (Quick Effect), 1 ครั้งต่อเทิร์น
  const INLINE = /("[^"]*"|“[^”]*”|\(Quick Effect\)|Quick Effects?|1 ครั้งต่อเทิร์น|ครั้งเดียวต่อเทิร์น)/g;
  function inline(text, base) {
    const segs = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) segs.push({ text: text.slice(last, m.index), cls: base });
      const t = m[0];
      const extra = t.startsWith('"') || t.startsWith("“") ? "name" : /Quick/.test(t) ? "quick" : "limit";
      segs.push({ text: t, cls: [...base, extra] });
      last = m.index + t.length;
    }
    if (last < text.length) segs.push({ text: text.slice(last), cls: base });
    return segs;
  }

  function styleBlock(b) {
    if (isSummonCondition(b)) return inline(b, ["summon"]);
    if (isUseLimit(b)) return inline(b, ["limit"]);
    let c = findOutsideQuotes(b, ":");
    const first = findOutsideQuotes(b, ";");
    if (first >= 0 && (c < 0 || first < c)) c = -1; // "cost; effect" with no condition (a later ":" is just text)
    const s = findOutsideQuotes(b, ";", c + 1);
    const segs = [];
    if (c >= 0) segs.push(...inline(b.slice(0, c + 1), ["cond"]));
    if (s >= 0) segs.push(...inline(b.slice(c + 1, s + 1), ["cost"]));
    segs.push(...inline(b.slice(Math.max(c, s) + 1), []));
    return segs.filter(x => x.text);
  }

  function formatThai(th) {
    const blocks = [];
    for (const line of String(th).replace(/ /g, " ").split(/\r?\n/)) {
      if (!line.trim()) continue;
      for (const sentence of splitPeriods(line)) {
        for (const b of splitMergedEffects(sentence.trim())) {
          if (b.trim()) blocks.push({ segs: styleBlock(b.trim()) });
        }
      }
    }
    return blocks;
  }

  globalThis.ygotFormatThai = formatThai;
  if (typeof module !== "undefined") module.exports = { formatThai };
})();
