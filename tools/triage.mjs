// Runs in GitHub Actions on issues opened/edited. No AI here — only deterministic checks.
// Reads the event from GITHUB_EVENT_PATH (never from the shell, so issue text cannot inject commands).
// Result: a comment + one of the labels  needs-ai-review | invalid | rate-limited
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CARDS_DIR, isPasscode, ruleCheck, unsafeText, MAX_TH, loadCards } from "./lib.mjs";
import { gh, REPO, parseForm, fetchEnglish } from "./github.mjs";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = event.issue;
const labels = new Set(issue.labels.map(l => l.name));
if (!labels.has("fix-translation")) { console.log("not a fix-translation issue"); process.exit(0); }

const MAX_PER_DAY = 5;
const MIN_ACCOUNT_DAYS = 30;
const form = parseForm(issue.body);
const passcode = (form["Passcode"] || "").replace(/\D/g, "");
const proposed = (form["คำแปลที่เสนอ"] || "").trim();
const problems = [];

// ---- passcode → card file (also alt passcodes) ----
let card = null;
if (!isPasscode(passcode)) problems.push("Passcode ต้องเป็นตัวเลข");
else if (existsSync(join(CARDS_DIR, `${passcode}.json`))) card = JSON.parse(readFileSync(join(CARDS_DIR, `${passcode}.json`), "utf8"));
else card = loadCards().map(x => x.card).find(c => (c.alt || []).includes(passcode)) || null;

if (!proposed) problems.push("ไม่มีคำแปลที่เสนอ");
if (proposed.length > MAX_TH) problems.push(`คำแปลยาวเกิน ${MAX_TH} ตัวอักษร`);
problems.push(...unsafeText(proposed).map(p => `คำแปล ${p}`));
if (card && proposed.trim() === card.th.trim()) problems.push("คำแปลที่เสนอเหมือนของเดิม");
if (card?.status === "reviewed") problems.push("การ์ดใบนี้ผ่านการตรวจโดยผู้ดูแลแล้ว — จะไม่ถูกแก้อัตโนมัติ ผู้ดูแลจะอ่านเอง");

// ---- English text + rule check ----
let en = null, rule = null;
if (isPasscode(passcode)) {
  en = await fetchEnglish(passcode);
  if (!en) problems.push("หา passcode นี้ใน YGOPRODeck ไม่เจอ");
  else if (proposed) rule = ruleCheck(en.en, proposed);
}

// ---- abuse limits ----
const author = issue.user.login;
const since = new Date(Date.now() - 864e5).toISOString();
const recent = await gh(`/search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue author:${author} label:fix-translation created:>=${since}`)}`);
const rateLimited = recent.total_count > MAX_PER_DAY;
const user = await gh(`/users/${author}`);
const accountDays = (Date.now() - Date.parse(user.created_at)) / 864e5;

// ---- verdict ----
// ai-* = AI's verdict on the OLD text — an edit makes it stale, so it goes too (review.bat labels the new text)
const add = [], remove = ["needs-ai-review", "invalid", "rate-limited", "rule-check-failed", "ai-accept", "ai-reject", "ai-needs-human"];
let msg;
if (rateLimited) {
  add.push("rate-limited");
  msg = `เปิดหัวข้อแก้คำแปลเกิน ${MAX_PER_DAY} หัวข้อใน 24 ชั่วโมง — หัวข้อนี้รอผู้ดูแล`;
} else if (problems.length) {
  add.push("invalid");
  msg = "ยังรับหัวข้อนี้ไม่ได้:\n" + problems.map(p => `- ${p}`).join("\n") + "\n\nแก้ไขหัวข้อ (Edit) แล้วระบบจะตรวจใหม่อัตโนมัติ";
} else {
  add.push("needs-ai-review");
  if (rule && !rule.ok) add.push("rule-check-failed");
  msg = [
    `รูปแบบถูกต้อง ✅ การ์ด **${en.name.replace(/[*_`[\]<>@]/g, "")}** (${passcode}) · สถานะเดิม: \`${card ? card.status : "ไม่มีคำแปล"}\``,
    rule && !rule.ok ? "ตรวจกฎตายตัวพบจุดที่ต้องดู:\n" + rule.problems.map(p => `- ${p}`).join("\n") : "ตรวจกฎตายตัว (ตัวเลข ชื่อการ์ด เครื่องหมาย : ;) ผ่าน",
    "ขั้นต่อไป: AI ตรวจความหมาย แล้วผู้ดูแลตัดสิน",
    accountDays < MIN_ACCOUNT_DAYS ? `หมายเหตุ: บัญชีอายุน้อยกว่า ${MIN_ACCOUNT_DAYS} วัน — จะไม่เข้าเกณฑ์ merge อัตโนมัติในอนาคต` : ""
  ].filter(Boolean).join("\n\n");
}

for (const l of remove) if (labels.has(l) && !add.includes(l)) await gh(`/repos/${REPO}/issues/${issue.number}/labels/${encodeURIComponent(l)}`, { method: "DELETE" }).catch(() => {});
await gh(`/repos/${REPO}/issues/${issue.number}/labels`, { method: "POST", body: { labels: add } });
// one bot comment per issue: an edit updates it instead of adding another (only OUR comment — anyone can copy the header)
const HEAD = "🤖 **ตรวจอัตโนมัติ**";
const comments = await gh(`/repos/${REPO}/issues/${issue.number}/comments?per_page=100`);
const mine = comments.find(c => c.user?.login === "github-actions[bot]" && c.body?.startsWith(HEAD));
const body = `${HEAD}\n\n${msg}${mine ? `\n\n_ตรวจใหม่หลังแก้ไข · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC_` : ""}`;
if (mine) await gh(`/repos/${REPO}/issues/comments/${mine.id}`, { method: "PATCH", body: { body } });
else await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: "POST", body: { body } });
console.log(`#${issue.number}: ${add.join(", ")}`);
