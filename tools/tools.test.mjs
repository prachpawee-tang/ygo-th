// Tests for the code that reads text from strangers and the checks that keep bad text out.
// Run: node --test tools/   (CI runs it in .github/workflows/validate.yml)
// No data/ files are read — these run in a second.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { ROOT, isPasscode, cleanCredit, unsafeText, ruleCheck, splitSentences, cleanPattern, hasPatternMistake, patternFits, wordChange, checkCardSchema } from "./lib.mjs";
import { parseCsv, readSuggestions } from "./form.mjs";
import { parseForm } from "./github.mjs";

test("isPasscode: digits only, 3–10 long", () => {
  for (const ok of ["123", "59438930", "1234567890"]) assert.equal(isPasscode(ok), true, ok);
  for (const bad of ["12", "12345678901", "abc", "d123", "59438930 ", "", 59438930, null]) assert.equal(isPasscode(bad), false, String(bad));
});

test("parseCsv: quoted cells, doubled quotes, line breaks inside a cell, CRLF, BOM", () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi""\nline 2"\r\n\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'he said "hi"\nline 2']]);
});

test("readSuggestions: finds columns by Thai header, keeps only digits of the passcode", () => {
  const csv = 'ประทับเวลา,passcode,ชื่อการ์ด,คำแปลที่เสนอ,เหตุผล,แหล่งอ้างอิง,ชื่อสำหรับเครดิต\n' +
    '8/11/2026 16:00:01, 5943-8930 ,X,"บรรทัด 1\r\nบรรทัด 2",เพราะ,,Nok\n';
  const { rows, note } = readSuggestions(csv);
  assert.equal(note, undefined);
  assert.equal(rows[0].raw, "59438930");
  assert.equal(rows[0].proposed, "บรรทัด 1\nบรรทัด 2");
  assert.equal(rows[0].creditRaw, "Nok");
  assert.equal(rows[0].formKey, "8/11/2026 16:00:01|59438930");
  assert.match(readSuggestions("a,b\n1,2").note, /ไม่มีคอลัมน์/);
});

test("parseForm: GitHub issue form → fields, \\r\\n normalised, _No response_ = empty", () => {
  const f = parseForm("### Passcode\r\n\r\n59438930\r\n\r\n### คำแปลที่เสนอ\r\n\r\nบรรทัด 1\r\nบรรทัด 2\r\n\r\n### เหตุผล\r\n\r\n_No response_");
  assert.deepEqual(f, { "Passcode": "59438930", "คำแปลที่เสนอ": "บรรทัด 1\nบรรทัด 2", "เหตุผล": "" });
});

test("unsafeText: blocks HTML, links, markdown links, control and bidi characters", () => {
  assert.deepEqual(unsafeText("คำแปลปกติ: ทำลาย 1 ใบ; จั่ว 2 ใบ"), []);
  for (const bad of ["<script>alert(1)</script>", "ดู https://evil.example", "www.evil.example", "[คลิก](http://x)", "a‮b", "a\u0007b"])
    assert.notDeepEqual(unsafeText(bad), [], bad);
});

test("cleanCredit: short plain names only (shown publicly in the extension)", () => {
  assert.equal(cleanCredit("  Nok  "), "Nok");
  for (const bad of ["@everyone", "Nok https://x.y", "<b>Nok</b>", "[Nok](x)", "a".repeat(41), "**Nok**"]) assert.equal(cleanCredit(bad), "", bad);
  // the stored credit must pass the schema check unchanged
  const card = { id: "123", name: "X", th: "ไทย", status: "community", en_sha256: "a".repeat(64), credit: "Nok" };
  assert.deepEqual(checkCardSchema(card), []);
  assert.notDeepEqual(checkCardSchema({ ...card, credit: "@x" }), []);
});

test("ruleCheck: catches lost numbers / keywords, accepts หนึ่ง/เดียว for 1, ignores names in quotes", () => {
  const p = (en, th) => ruleCheck(en, th).problems;
  assert.deepEqual(p("Draw 2 cards.", "จั่วการ์ด 2 ใบ"), []);
  assert.match(p("Send 1 monster to the GY.", "ส่งมอนสเตอร์ลงสุสาน").join(), /numbers missing in Thai: 1/);
  assert.deepEqual(p("Activate only 1 of these effects.", "เปิดใช้เอฟเฟกต์ใดเอฟเฟกต์หนึ่ง"), []);
  assert.match(p("Target 1 face-up monster.", "เลือกมอนสเตอร์ที่คว่ำอยู่ 1 ตัว").join(), /"face-up"/);
  assert.match(p("Banish 1 card from your Deck.", "เอาการ์ด 1 ใบออกจากเด็คของคุณ").join(), /"banish"/);
  assert.deepEqual(p('Add 1 "Banish Ball" to your hand.', 'เพิ่ม "Banish Ball" 1 ใบขึ้นมือ'), []);
  assert.match(p("Cost; effect.", "ค่าใช้จ่าย ผล").join(), /fewer ";"/);
});

test("splitSentences: splits at '. ' but not inside quotes or brackets (same as the site)", () => {
  assert.deepEqual(splitSentences('Draw 1 card. Then discard 1 card.'), ["Draw 1 card.", "Then discard 1 card."]);
  assert.deepEqual(splitSentences('Add 1 "Mr. Volcano" (Quick Effect. Yes) to hand.'), ['Add 1 "Mr. Volcano" (Quick Effect. Yes) to hand.']);
  assert.deepEqual(splitSentences("Line one\r\n● Bullet. Two"), ["Line one", "● Bullet.", "Two"]);
});

test("mistake patterns: clean, count only the differing part, fit the real fix", () => {
  const p = cleanPattern({ en: "face-up", wrong: "คว่ำอยู่", right: "หงายอยู่" });
  assert.equal(p.rightCore, "หงาย");
  const en = "Target 1 face-up card; destroy it.";
  assert.equal(hasPatternMistake(en, "เลือกการ์ดที่คว่ำอยู่ 1 ใบ", p), true);
  assert.equal(hasPatternMistake(en, "เลือกการ์ดที่หงาย 1 ใบ ที่คว่ำอยู่เดิม", p), false); // already says หงาย once
  assert.equal(patternFits(en, "การ์ดที่คว่ำอยู่", "การ์ดที่หงายอยู่", p), true);
  // patterns come from AI reading a stranger's text: refuse unusable or unsafe ones
  assert.equal(cleanPattern({ en: "ab", wrong: "x", right: "y" }), null);
  assert.equal(cleanPattern({ en: "banish", wrong: "เอา", right: "เอาออก" }), null);
  assert.equal(cleanPattern({ en: "banish", wrong: "x", right: "https://evil.example" }), null);
});

test("wordChange: counts deleted vs inserted Thai words", () => {
  assert.deepEqual(wordChange("เอาการ์ด 1 ใบออกจากเด็ค", "เอาการ์ด 1 ใบออกจากเกมจากเด็ค").deleted, 0);
  assert.ok(wordChange("มอนสเตอร์เอิร์ธ Machine เลเวล 4", "มอนสเตอร์ระดับ 4 1 ตัว").deleted >= 3);
});

test("signing: the extension's public key is keys/ygo-th.pub.pem, and the sign/verify scheme matches build.mjs", async () => {
  const pem = readFileSync(join(ROOT, "keys", "ygo-th.pub.pem"), "utf8").replace(/-----[^-]+-----|\s/g, "");
  const bg = readFileSync(join(ROOT, "extension", "background.js"), "utf8");
  assert.equal(bg.match(/PUBLIC_KEY_B64 = "([^"]+)"/)[1], pem, "rotate the key in extension/background.js too");
  // build.mjs signs JSON.stringify(manifest); the extension parses the file and verifies JSON.stringify(parsed manifest)
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = { format: "ygo-th/v1", version: 20261109120000, built: new Date().toISOString(), cards: 1, counts: { ai: 1 }, all: { path: "all.json.gz", bytes: 9, sha256: "a".repeat(64) } };
  const file = JSON.stringify({ manifest, signature: sign(null, Buffer.from(JSON.stringify(manifest)), privateKey).toString("base64") }, null, 2);
  const parsed = JSON.parse(file);
  const key = await webcrypto.subtle.importKey("spki", publicKey.export({ type: "spki", format: "der" }), { name: "Ed25519" }, false, ["verify"]);
  const verify = m => webcrypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(parsed.signature, "base64"), new TextEncoder().encode(JSON.stringify(m)));
  assert.equal(await verify(parsed.manifest), true);
  assert.equal(await verify({ ...parsed.manifest, version: parsed.manifest.version + 1 }), false, "tampered manifest must fail");
});
