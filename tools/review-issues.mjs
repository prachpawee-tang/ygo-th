// Local AI reviewer — runs on the maintainer's PC with Ollama (option B in the plan).
// For every open issue labelled `needs-ai-review`: fetch the English text, run the rule check and
// two independent AI reviews, then comment the result and label ai-accept / ai-reject / ai-needs-human.
//   --open-pr   also open a pull request when both reviews accept (phase 4). Never merges.
//   --dry-run   print what would happen, change nothing on GitHub.
// Env: GITHUB_TOKEN  fine-grained token for THIS repo only (Issues + Pull requests + Contents: read/write)
//      OLLAMA_URL    default http://127.0.0.1:11434      OLLAMA_MODEL  default gemma3:12b
//
// Safety: the issue text is untrusted. The model gets it only as quoted JSON data, has no tools, and must
// answer with a fixed JSON schema. Whatever it says, this script can only (a) comment, (b) set our labels,
// (c) with --open-pr, replace the `th` of the ONE card named in the form with the contributor's text.
import { isPasscode, cardJson, MAX_TH, unsafeText } from "./lib.mjs";
import { gh, REPO, parseForm, fetchEnglish, fence } from "./github.mjs";
import { reviewSuggestion, mistakePattern, MODEL } from "./ai-review.mjs";
import { similarFor, putSimilar } from "./similar.mjs";

const args = new Set(process.argv.slice(2));
const OPEN_PR = args.has("--open-pr"), DRY = args.has("--dry-run");

async function readCard(passcode) {
  try {
    const f = await gh(`/repos/${REPO}/contents/data/cards/${passcode}.json?ref=main`);
    return { card: JSON.parse(Buffer.from(f.content, "base64").toString("utf8")), sha: f.sha };
  } catch { return { card: null, sha: null }; }
}

async function openPr(issue, passcode, card, sha, proposed, name) {
  const main = await gh(`/repos/${REPO}/git/ref/heads/main`);
  const branch = `fix/${passcode}-issue-${issue.number}`;
  await gh(`/repos/${REPO}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: main.object.sha } });
  const next = { ...card, th: proposed, status: "community", updated: new Date().toISOString().slice(0, 10) };
  delete next.model; delete next.note;
  await gh(`/repos/${REPO}/contents/data/cards/${passcode}.json`, {
    method: "PUT",
    body: { message: `แก้คำแปล ${name} (${passcode}) — #${issue.number}`, content: Buffer.from(cardJson(next)).toString("base64"), sha, branch }
  });
  const pr = await gh(`/repos/${REPO}/pulls`, {
    method: "POST",
    body: { title: `แก้คำแปล ${name} (${passcode})`, head: branch, base: "main", body: `Closes #${issue.number}\n\nเปิดโดย AI reviewer หลังตรวจผ่าน 2 รอบ — ผู้ดูแลต้องตรวจและ merge เอง` }
  });
  return pr.html_url;
}

const issues = await gh(`/repos/${REPO}/issues?state=open&labels=needs-ai-review&per_page=50`);
console.log(`${issues.length} issue(s) waiting for AI review · model ${MODEL}${DRY ? " · DRY RUN" : ""}`);

for (const issue of issues) {
  const form = parseForm(issue.body);
  const passcode = (form["Passcode"] || "").replace(/\D/g, "");
  const proposed = (form["คำแปลที่เสนอ"] || "").trim();
  const reason = (form["เหตุผล"] || "").slice(0, 1000);
  if (!isPasscode(passcode) || !proposed || proposed.length > MAX_TH || unsafeText(proposed).length) {
    console.log(`#${issue.number}: form no longer valid — skipped (triage will relabel on edit)`); continue;
  }
  const en = await fetchEnglish(passcode);
  if (!en) { console.log(`#${issue.number}: passcode not found — skipped`); continue; }
  const { card, sha } = await readCard(passcode);
  const { label, rule, rounds: r } = await reviewSuggestion(en.en, card?.th, proposed, reason);

  const lines = [
    `🤖 **AI ตรวจความหมาย** (${MODEL}, 2 รอบ) → **${label}**`,
    rule.ok ? "กฎตายตัว: ผ่าน" : "กฎตายตัว: ไม่ผ่าน\n" + rule.problems.map(p => `- ${p}`).join("\n"),
    ...r.map((x, i) => `**รอบ ${i + 1}:** ${x.verdict} (มั่นใจ ${(x.confidence * 100).toFixed(0)}%)` +
      // AI text can be steered by the untrusted issue — strip markdown that renders links, images, mentions or HTML
      (x.problems.length ? "\n" + x.problems.map(p => `- ${p.replace(/[@<>[\]()!`*_#|]/g, "").replace(/https?:\/\/\S+/g, "(ลิงก์ถูกตัด)")}`).join("\n") : "")),
    "<details><summary>คำแปลกลับเป็นภาษาอังกฤษ (รอบ 1)</summary>\n\n" + fence(r[0].back_translation) + "\n</details>",
    card?.status === "reviewed" ? "การ์ดนี้สถานะ reviewed — ผู้ดูแลตัดสินเองเสมอ" : ""
  ].filter(Boolean);

  // คำแก้ที่ AI ไม่ตีตก → หาการ์ดใบอื่นที่อาจผิดแบบเดียวกัน (ค้นในเครื่องผู้ดูแล · ผู้ดูแลกดส่งให้ ai-fix ใน review-ui)
  if (label !== "ai-reject") {
    try {
      const sim = await similarFor(mistakePattern, { en: en.en, id: passcode, currentTh: card?.th, proposed });
      if (sim?.cards.length) {
        const safe = s => String(s).replace(/[@<>[\]()!`*_#|]/g, "");
        const { pattern: p, cards } = sim;
        lines.push(`**อาจผิดแบบเดียวกันอีก ${cards.length} ใบ** ("${safe(p.en)}" แปลเป็น "${safe(p.wrong)}" แทน "${safe(p.right)}"):\n` +
          cards.slice(0, 10).map(c => `- ${safe(c.name)} (${c.id})`).join("\n") + (cards.length > 10 ? `\n- … อีก ${cards.length - 10} ใบ` : "") +
          "\n\nผู้ดูแลจะตรวจรูปแบบนี้ก่อนให้ AI แก้ใบเหล่านั้น");
        if (!DRY) putSimilar(`issue:${issue.number}`, { source: `GitHub #${issue.number}`, card: passcode, name: en.name, pattern: p, cards });
      }
    } catch (e) { console.warn(`#${issue.number}: similar-card search failed — ${e.message}`); }
  }

  let prUrl = null;
  if (!DRY && OPEN_PR && label === "ai-accept" && card && card.status !== "reviewed") {
    // e.g. the branch already exists because this issue was reviewed before — don't stop the whole queue
    try {
      prUrl = await openPr(issue, passcode, card, sha, proposed, en.name);
      lines.push(`เปิด PR แล้ว: ${prUrl}`);
    } catch (e) {
      console.warn(`#${issue.number}: open PR failed — ${e.message}`);
      lines.push("เปิด PR อัตโนมัติไม่สำเร็จ (อาจมี branch/PR ของหัวข้อนี้อยู่แล้ว) — ผู้ดูแลจะดูเอง");
    }
  }
  console.log(`#${issue.number} ${en.name}: ${label}${prUrl ? " → " + prUrl : ""}`);
  if (DRY) { console.log(lines.join("\n\n") + "\n"); continue; }

  // one AI verdict per issue: drop the previous one (e.g. reviewed again after an edit)
  for (const l of ["needs-ai-review", "ai-accept", "ai-reject", "ai-needs-human"].filter(l => l !== label && issue.labels.some(x => x.name === l)))
    await gh(`/repos/${REPO}/issues/${issue.number}/labels/${l}`, { method: "DELETE" }).catch(() => {});
  await gh(`/repos/${REPO}/issues/${issue.number}/labels`, { method: "POST", body: { labels: [label] } });
  await gh(`/repos/${REPO}/issues/${issue.number}/comments`, { method: "POST", body: { body: lines.join("\n\n") } });
}
