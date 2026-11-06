// Import the batch output into data/cards, validate, commit and push — one command, clear errors.
// Usage: node tools/update-data.mjs [cards-th.jsonl] [verified.json] [--no-push]
//        (or double-click tools\update-data.bat)
//   --no-push   stop after validate (nothing is committed)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadCards } from "./lib.mjs";

const flags = new Set(process.argv.slice(2).filter(a => a.startsWith("--")));
const pos = process.argv.slice(2).filter(a => !a.startsWith("--"));
const JSONL = pos[0] || "E:\\YGO-Translator\\batch\\cards-th.jsonl";
const VERIFIED = pos[1] || "E:\\YGO-Translator\\extension\\verified.json";
const PUSH = !flags.has("--no-push");
const TOTAL = PUSH ? 5 : 3;

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RESET = "\x1b[0m";

function fail(step, why, detail = "") {
  if (detail.trim()) console.error(detail.trim());
  console.error(`\n${RED}${"*".repeat(60)}\n [ผิดพลาด] ขั้น: ${step}\n ${why}\n${"*".repeat(60)}${RESET}\n`);
  process.exit(1);
}

function node(step, script, args, why) {
  const r = spawnSync(process.execPath, [join(ROOT, "tools", script), ...args], { cwd: ROOT, stdio: "inherit" });
  if (r.error) fail(step, String(r.error.message || r.error));
  if (r.status !== 0) fail(step, why);
}

function git(args) {
  // core.safecrlf=false: ไม่ให้ git พิมพ์ "LF will be replaced by CRLF" ทีละไฟล์ (หลายพันไฟล์ = ข้อความหลาย MB)
  // maxBuffer ใหญ่: ผลลัพธ์ของ git กับหลายพันไฟล์เกิน 1MB ที่เป็นค่าเริ่มต้นได้
  const r = spawnSync("git", ["-c", "core.safecrlf=false", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error?.code === "ENOENT") fail("git", "ไม่พบ git — ติดตั้ง Git for Windows แล้วเปิดหน้าต่างใหม่");
  if (r.error) fail(`git ${args[0]}`, `git ทำงานไม่สำเร็จ: ${r.error.message}`);
  return r;
}

const today = new Date().toISOString().slice(0, 10);
console.log("=== ygo-th: อัปเดตฐานคำแปลจาก batch ===\n");

if (!existsSync(JSONL)) fail("เตรียมไฟล์", `ไม่พบไฟล์ผล batch: ${JSONL}`);
const args = [JSONL];
if (existsSync(VERIFIED)) args.push(VERIFIED);
else console.warn(`${YELLOW}[คำเตือน] ไม่พบ ${VERIFIED} — นำเข้าโดยไม่มีคำแปลที่ตรวจแล้ว${RESET}`);

let step = 1;
if (PUSH) {
  console.log(`[${step++}/${TOTAL}] ดึงของล่าสุดจาก GitHub`);
  const p = git(["pull", "--ff-only"]);
  if (p.status !== 0) fail("git pull", "ดึงของล่าสุดไม่ได้ — มีงานในเครื่องที่ยังไม่ commit ชนกับบน GitHub หรือ branch แยกทางกัน แก้ด้วย git status ก่อน", p.stderr + p.stdout);
  console.log(p.stdout.trim() || "ok");
}

console.log(`\n[${step++}/${TOTAL}] นำเข้า ${JSONL}`);
node("import-batch", "import-batch.mjs", args,
  "มีการ์ดที่รูปแบบไม่ผ่าน หรือไฟล์ jsonl เสียหลายบรรทัด — ดูบรรทัด skip ด้านบน");

console.log(`\n[${step++}/${TOTAL}] ตรวจรูปแบบ data/`);
node("validate", "validate.mjs", [],
  "มีไฟล์ใน data/ ที่ไม่ผ่าน — ดูรายชื่อไฟล์ด้านบน แก้แล้วรันใหม่ (ยังไม่ได้ push อะไร)");

const st = git(["status", "--porcelain", "--", "data"]);
const changed = st.status === 0 ? st.stdout.split("\n").filter(Boolean).length : null;
const notes = loadCards().filter(x => x.card.note).length;

if (!PUSH || changed === 0) {
  console.log(`\n${GREEN}=== สำเร็จ ===${RESET}`);
  console.log(`ไฟล์ใน data/ ที่เปลี่ยน: ${changed ?? "?"} · การ์ดที่มี note รอตรวจ: ${notes}`);
  if (changed === 0) console.log("ไม่มีอะไรใหม่ ไม่ต้อง push");
  else console.log("--no-push: ยังไม่ได้ commit · ถ้าจะส่งขึ้น รันใหม่โดยไม่ใส่ --no-push");
  process.exit(0);
}

console.log(`\n[${step++}/${TOTAL}] commit ${changed} ไฟล์`);
let r = git(["add", "-A", "--", "data"]);
if (r.status !== 0) fail("git add", "เพิ่มไฟล์ไม่ได้", r.stderr);
const msg = `data: import batch ${today} (${changed} files)`;
r = git(["commit", "-m", msg, "--", "data"]); // commit only data/, never other local edits
if (r.status !== 0) fail("git commit", "commit ไม่ได้ — ถ้าขึ้นว่าไม่รู้จักชื่อ/อีเมล ให้ตั้ง git config user.name / user.email", r.stderr + r.stdout);
console.log(msg);

console.log(`\n[${step++}/${TOTAL}] push ขึ้น GitHub`);
r = git(["push"]);
if (r.status !== 0) {
  const why = /protected|rule|GH013|pull request/i.test(r.stderr)
    ? "GitHub ไม่ให้ push ตรงเข้า main (ruleset) — commit อยู่ในเครื่องแล้ว ให้เปิด PR หรือตั้ง bypass ให้บัญชีผู้ดูแล"
    : /rejected|fetch first|non-fast-forward/i.test(r.stderr)
      ? "บน GitHub มี commit ใหม่กว่า — commit อยู่ในเครื่องแล้ว รัน git pull --rebase แล้ว git push"
      : "push ไม่สำเร็จ (เน็ต/สิทธิ์) — commit อยู่ในเครื่องแล้ว ลอง git push อีกครั้ง";
  fail("git push", why, r.stderr);
}

console.log(`\n${GREEN}=== สำเร็จ: ส่งขึ้น GitHub แล้ว ===${RESET}`);
console.log(`${changed} ไฟล์ · การ์ดที่มี note รอตรวจ: ${notes}`);
console.log("Actions จะ build + เซ็น API ให้เอง (~1–2 นาที) · extension ของเพื่อนได้รับภายใน 12 ชม.");
