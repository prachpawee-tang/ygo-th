// Review every pending translation fix in one go — GitHub issues AND Google Form suggestions.
// Double-click tools\review-all.bat  (or node tools/review-all.mjs [--dry-run] [--open-pr] [--recheck])
//   1. GitHub: runs review-issues.mjs (needs YGOTH_GITHUB_TOKEN) — comment + ai-* label on each issue.
//   2. Google Form: fetches the latest responses (published Sheet link / local CSV), rule-check + 2 AI passes,
//      stores the verdict next to the CSV (form-responses.ai.json) so review-ui shows it.
// Nothing is merged or written to data/cards: the maintainer still decides in review-ui (no auto-merge until phase 5).
//   --recheck  review form suggestions again even if they already have an AI result
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, CARDS_DIR, isPasscode, unsafeText, MAX_TH } from "./lib.mjs";
import { formConfig, fetchFormText, readSuggestions, readDone, readAi, writeAi, isMissingReport, resolveCard } from "./form.mjs";
import { reviewSuggestion, mistakePattern, ollamaReady, MODEL, OLLAMA } from "./ai-review.mjs";
import { similarFor, putSimilar } from "./similar.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run"), RECHECK = args.includes("--recheck");
const EN_FILE = "E:\\YGO-Translator\\batch\\cards-en.json";
const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RESET = "\x1b[0m";
const log = m => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);
const LABEL = { "ai-accept": `${GREEN}AI ผ่าน${RESET}`, "ai-reject": `${RED}AI ไม่ผ่าน${RESET}`, "ai-needs-human": `${YELLOW}ให้คนดู${RESET}`, invalid: `${RED}รูปแบบใช้ไม่ได้${RESET}`, missing: `${YELLOW}แจ้งว่าไม่มีคำแปล${RESET}` };

console.log("=== ygo-th: ตรวจคำแก้ทั้งหมด (GitHub + Google Form) ===\n");
if (!(await ollamaReady())) {
  console.error(`${RED}[ผิดพลาด] ติดต่อ Ollama ที่ ${OLLAMA} ไม่ได้ — ใช้ review-all.bat ซึ่งเปิด Ollama ให้เอง${RESET}`);
  process.exit(1);
}

// ---------- 1) GitHub issues ----------
let ghResult = "ข้าม";
if (!process.env.GITHUB_TOKEN) {
  log(`${YELLOW}GitHub: ข้าม (ยังไม่ได้ตั้ง token — ทำครั้งเดียว: review-all.bat --set-token ดูวิธีสร้าง token ใน MAINTAINING.md)${RESET}`);
} else {
  log("GitHub: ตรวจ issue ที่ติด needs-ai-review");
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "review-issues.mjs"), ...args.filter(a => a === "--dry-run" || a === "--open-pr")],
    { cwd: ROOT, stdio: "inherit", env: process.env });
  ghResult = r.status === 0 ? "เสร็จ" : `${RED}ผิดพลาด (exit ${r.status})${RESET}`;
}

// ---------- 2) Google Form ----------
const flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
let FORM;
try { FORM = formConfig({ csv: flag("--form"), url: flag("--form-url") }); } catch (e) { console.error(e.message); process.exit(1); }
const got = await fetchFormText(FORM);
let formCounts = {};
if (got.text === null) {
  log(`${YELLOW}Google Form: ${got.note}${RESET}`);
} else {
  const { rows, note } = readSuggestions(got.text);
  if (note) log(`${RED}Google Form: ${note}${RESET}`);
  // passcode → main card id (alt artworks share one card file) + English text
  const en = new Map(), main = new Map(), byName = new Map();
  for (const c of (j => j.data || j)(JSON.parse(readFileSync(EN_FILE, "utf8")))) {
    for (const im of c.card_images || [{ id: c.id }]) main.set(String(im.id), String(c.id));
    main.set(String(c.id), String(c.id)); en.set(String(c.id), c.desc || "");
    byName.set(String(c.name || "").trim().toLowerCase(), String(c.id));
  }
  const done = readDone(FORM), ai = readAi(FORM);
  // "invalid" never called the AI, so re-checking it is free — picks up rows fixed by matching the card name
  const todo = rows.filter(s => !done[s.formKey] && (RECHECK || ai[s.formKey]?.proposed !== s.proposed || ai[s.formKey]?.label === "invalid"));
  log(`Google Form: ${rows.length} คำตอบ (อ่านจาก ${got.from}) · ยังไม่จัดการ ${rows.filter(s => !done[s.formKey]).length} · ต้องตรวจรอบนี้ ${todo.length}`);
  for (const [i, s] of todo.entries()) {
    const hit = resolveCard(s.raw, s.name, { byId: x => main.get(x), byName: n => byName.get(n) });
    const id = hit.id || s.raw;
    const file = join(CARDS_DIR, `${id}.json`);
    const card = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const viaName = hit.via === "name" ? [`เลข ${s.raw} ไม่ใช่ passcode จริง (เลขของ Dueling Nexus) — จับคู่จากชื่อการ์ดเป็น ${id}`] : [];
    // "แจ้งการ์ดที่ไม่มีคำแปล" → a report, not a translation: tell the maintainer what it means, never run the AI on it
    if (isMissingReport(s.proposed)) {
      const what = !hit.id ? `ไม่พบการ์ด "${s.name || s.raw}" ในข้อมูลอังกฤษ — น่าจะเป็นการ์ดใหม่: โหลด cards-en.json ใหม่แล้วแปล`
        : card ? "การ์ดนี้มีคำแปลอยู่แล้ว — คนส่งใช้ extension รุ่นก่อน 2.3.1 ที่หาไม่เจอ · กด ไม่ใช้คำแก้นี้ ได้เลย"
        : "การ์ดนี้ยังไม่มีคำแปลจริง — ให้ batch แปล";
      const result = { label: "missing", proposed: s.proposed, rule: [...viaName, what], rounds: [], at: new Date().toISOString() };
      if (!DRY) writeAi(FORM, s.formKey, result);
      formCounts.missing = (formCounts.missing || 0) + 1;
      log(`  ${i + 1}/${todo.length}  ${card?.name || s.name || s.raw}  → ${LABEL.missing} · ${what}`);
      continue;
    }
    const bad = [];
    if (!hit.id) bad.push(isPasscode(s.raw) ? "ไม่พบการ์ดนี้ (ทั้งเลขและชื่อการ์ด)" : "passcode ไม่ใช่ตัวเลข");
    if (!s.proposed) bad.push("ไม่มีคำแปลที่เสนอ");
    if (s.proposed.length > MAX_TH) bad.push("คำแปลยาวเกิน");
    bad.push(...unsafeText(s.proposed));
    let result;
    if (bad.length) result = { label: "invalid", proposed: s.proposed, rule: bad, rounds: [], at: new Date().toISOString() };
    else {
      try {
        const r = await reviewSuggestion(en.get(id), card?.th, s.proposed, s.reason);
        result = { label: r.label, proposed: s.proposed, rule: [...viaName, ...r.rule.problems], model: r.model, at: new Date().toISOString(),
          rounds: r.rounds.map(x => ({ verdict: x.verdict, confidence: x.confidence, problems: x.problems, back_translation: x.back_translation })) };
      } catch (e) { log(`${RED}  ${s.raw}: AI ตรวจไม่สำเร็จ — ${e.message} (จะลองใหม่รอบหน้า)${RESET}`); continue; }
      // คำแก้ที่ AI ไม่ตีตก → หาการ์ดใบอื่นที่อาจผิดแบบเดียวกัน (ผู้ดูแลกดส่งให้ ai-fix ใน review-ui)
      if (result.label !== "ai-reject") {
        try {
          const sim = await similarFor(mistakePattern, { en: en.get(id), id, currentTh: card?.th, proposed: s.proposed });
          if (sim) {
            result.similar = { pattern: sim.pattern, count: sim.cards.length };
            if (!DRY && sim.cards.length) putSimilar(`form:${s.formKey}`, { source: "Google Form", card: id, name: card?.name || id, pattern: sim.pattern, cards: sim.cards });
          }
        } catch (e) { log(`${YELLOW}  ${s.raw}: หาใบที่ผิดแบบเดียวกันไม่สำเร็จ — ${e.message}${RESET}`); }
      }
    }
    if (!DRY) writeAi(FORM, s.formKey, result);
    formCounts[result.label] = (formCounts[result.label] || 0) + 1;
    const sim = result.similar ? ` · อาจผิดแบบเดียวกัน ${result.similar.count} ใบ ("${result.similar.pattern.en}" → ${result.similar.pattern.wrong})` : "";
    log(`  ${i + 1}/${todo.length}  ${card?.name || s.raw}  → ${LABEL[result.label] || result.label}${result.rule.length ? " · " + result.rule.slice(0, 2).join(" · ") : ""}${sim}`);
  }
}

console.log(`\n${GREEN}=== เสร็จ ===${RESET}`);
console.log(`GitHub: ${ghResult}`);
console.log(`Google Form: ${Object.entries(formCounts).map(([k, v]) => `${(LABEL[k] || k)} ${v}`).join(" · ") || "ไม่มีคำแก้ใหม่ให้ตรวจ"}${DRY ? " (dry-run: ไม่ได้บันทึกผล)" : ""}`);
console.log(`ขั้นต่อไป: เปิด tools\\review-ui.bat → โหมด "คำแก้จาก Google Form" → ดูผล AI แล้วกด ใช้ / ไม่ใช้ → update-data.bat`);
console.log(`ถ้ามีใบที่อาจผิดแบบเดียวกัน: review-ui โหมด "อาจผิดแบบเดียวกัน" → ส่งให้ ai-fix → ดับเบิลคลิก batch\\ai-fix.bat`);
console.log(`(AI ใช้ ${MODEL} บนเครื่อง · ผลเป็นคำแนะนำ ผู้ดูแลตัดสินเอง)`);
