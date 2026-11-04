// Import the batch output into data/cards and validate — one command, clear errors.
// Usage: node tools/update-data.mjs [cards-th.jsonl] [verified.json]    (or double-click tools\update-data.bat)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadCards } from "./lib.mjs";

const JSONL = process.argv[2] || "E:\\YGO-Translator\\batch\\cards-th.jsonl";
const VERIFIED = process.argv[3] || "E:\\YGO-Translator\\extension\\verified.json";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RESET = "\x1b[0m";

function fail(step, why) {
  console.error(`\n${RED}${"*".repeat(60)}\n [ผิดพลาด] ขั้น: ${step}\n ${why}\n${"*".repeat(60)}${RESET}\n`);
  process.exit(1);
}

function run(step, script, args, why) {
  const r = spawnSync(process.execPath, [join(ROOT, "tools", script), ...args], { cwd: ROOT, stdio: "inherit" });
  if (r.error) fail(step, String(r.error.message || r.error));
  if (r.status !== 0) fail(step, why);
}

console.log("=== ygo-th: อัปเดตฐานคำแปลจาก batch ===\n");

if (!existsSync(JSONL)) fail("เตรียมไฟล์", `ไม่พบไฟล์ผล batch: ${JSONL}`);
const args = [JSONL];
if (existsSync(VERIFIED)) args.push(VERIFIED);
else console.warn(`${YELLOW}[คำเตือน] ไม่พบ ${VERIFIED} — นำเข้าโดยไม่มีคำแปลที่ตรวจแล้ว${RESET}`);

console.log(`[1/2] นำเข้า ${JSONL}`);
run("import-batch", "import-batch.mjs", args,
  "มีการ์ดที่รูปแบบไม่ผ่าน หรือไฟล์ jsonl เสียหลายบรรทัด — ดูบรรทัด skip ด้านบน");

console.log("\n[2/2] ตรวจรูปแบบ data/");
run("validate", "validate.mjs", [],
  "มีไฟล์ใน data/ ที่ไม่ผ่าน — ดูรายชื่อไฟล์ด้านบน แก้แล้วรันใหม่ (อย่า push จนกว่าจะผ่าน)");

const git = spawnSync("git", ["status", "--porcelain", "--", "data"], { cwd: ROOT, encoding: "utf8" });
const changed = git.status === 0 ? git.stdout.split("\n").filter(Boolean).length : null;
const notes = loadCards().filter(x => x.card.note).length;

console.log(`\n${GREEN}=== สำเร็จ ===${RESET}`);
console.log(`ไฟล์ใน data/ ที่เปลี่ยน (ยังไม่ commit): ${changed ?? "? (อ่าน git ไม่ได้)"}`);
console.log(`การ์ดที่มี note รอตรวจทั้งหมด: ${notes}`);
if (changed === 0) console.log("ไม่มีอะไรใหม่ ไม่ต้อง push");
else console.log('ขั้นต่อไป: git add data  →  git commit -m "data: import batch YYYY-MM-DD"  →  git push');
