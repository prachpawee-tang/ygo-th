# tools/ — เครื่องมือของผู้ดูแล

ทุกตัวต้องใช้ Node 20 ขึ้นไป ไม่ต้องติดตั้ง package เพิ่ม และต้องรันจากโฟลเดอร์ `ygo-th`
(ยกเว้นไฟล์ `.bat` ซึ่ง `cd` ไปที่โฟลเดอร์นั้นให้เอง)

## สรุปเร็ว

| เครื่องมือ | ทำอะไร | ใช้ตอนไหน | รันที่ไหน |
| --- | --- | --- | --- |
| [`update-data.bat`](#update-data) | pull + import + validate + commit + push ในคำสั่งเดียว | หลัง batch แปลการ์ดได้เพิ่ม | เครื่อง Tonk (ดับเบิลคลิก) |
| [`review-ui.bat`](#review-ui) | หน้าตรวจคำแปลใน browser (EN คู่ TH, ถูกแล้ว / แก้ / ข้าม, เดิม | ใหม่ ข้างกัน) | ไล่ตรวจใบที่มี note หรือใบยอดนิยม | เครื่อง Tonk (ดับเบิลคลิก) |
| [`import-batch.mjs`](#import-batch) | แปลงผล batch เป็น `data/cards/*.json` | ถูกเรียกจาก update-data | เครื่อง Tonk |
| [`validate.mjs`](#validate) | ตรวจรูปแบบไฟล์ใน `data/` | ก่อน push ทุกครั้ง · CI รันเองทุก PR/push | ทั้งสองที่ |
| [`build.mjs`](#build) | สร้าง API static `site/v1/` และเซ็น | Actions รันเองหลัง push เข้า main | Actions (ลองในเครื่องได้) |
| [`review-all.bat`](#review-all) | **ตรวจคำแก้ทั้งหมดในคำสั่งเดียว**: GitHub issue + Google Form (rule-check + AI 2 รอบ) + หาใบที่อาจผิดแบบเดียวกัน | เมื่อมีคำแก้ใหม่ | เครื่อง Tonk (เปิด Ollama ให้เอง) |
| [`batch\ai-fix.bat`](#ai-fix) | ให้ AI ตรวจใบที่ rule-check สงสัยอีกรอบ แล้ว**แก้เฉพาะจุด** (หงาย/คว่ำ, ออกจากเกม, เลขหาย …) + ใบที่ "อาจผิดแบบเดียวกัน" ที่ส่งมาจาก review-ui | หลัง batch แปลการ์ดใหม่ · หลังกด "ส่งให้ ai-fix" | เครื่อง Tonk (เปิด Ollama ให้เอง) |
| [`triage.mjs`](#triage) | ตรวจ issue แก้คำแปลแบบไม่ใช้ AI | Actions รันเองเมื่อมีคนเปิด/แก้ issue | Actions เท่านั้น |
| [`keygen.mjs`](#keygen) | สร้างกุญแจเซ็น manifest | ครั้งเดียว หรือตอนกุญแจหลุด | เครื่อง Tonk |
| [`tools.test.mjs`](#test) | test ของตัวอ่านข้อความจากคนนอกและตัวกันข้อความอันตราย | Actions รันเองทุก push · แก้ `lib`/`form`/`github` แล้วรันเอง | ทั้งสองที่ |
| [โค้ดกลาง](#lib) | `lib`, `github`, `form`, `ai-review`, `similar`, `review-issues` — ตัวอื่น import ไปใช้ | ไม่ได้รันเอง | — |

### ลำดับงานปกติ
```
batch แปลบนเครื่อง ──► update-data.bat (commit + push ให้เอง) ──► [Actions] validate + build ──► Pages ──► extension ของเพื่อน (ภายใน 12 ชม.)

เพื่อนเปิด issue ──► [Actions] triage ──► label needs-ai-review ──┐
                                                                 ├──► review-all.bat (AI บนเครื่อง) ──► Tonk ตัดสิน (merge PR / กดใช้ใน review-ui) ──► update-data.bat
เพื่อนส่ง Google Form ────────────────────────────────────────────┘
                     └─ คำแก้ที่ AI ไม่ตีตก → หาใบอื่นที่ผิดแบบเดียวกัน ──► review-ui "อาจผิดแบบเดียวกัน" ──► ส่งให้ ai-fix ──► batch\ai-fix.bat ──► update-data.bat

ใบที่ rule-check ยังเตือน ──► batch\ai-fix.bat (แก้เฉพาะจุด) ──► update-data.bat ──► ที่เหลือดูต่อใน review-ui (มีความเห็นของ AI)
```

---

<a id="update-data"></a>
## `update-data.bat` / `update-data.mjs`: อัปเดตฐานจาก batch

**ทำอะไร:** ทำครบ 5 ขั้นในคำสั่งเดียว
1. `git pull --ff-only` ดึงของล่าสุดจาก GitHub
2. `import-batch`
3. `validate`
4. commit **เฉพาะ `data/`** เป็น `data: import batch YYYY-MM-DD (N files)` ไฟล์อื่นที่แก้ค้างในเครื่องจะไม่ติดไปด้วย
5. `git push`

ถ้าขั้นไหนพัง จะขึ้นกรอบ **[ผิดพลาด]** บอกชื่อขั้นกับสาเหตุ แล้วหยุดทันที
ถ้า validate ไม่ผ่าน จะไม่มีการ commit หรือ push ใด ๆ · ถ้าไม่มีการ์ดใหม่ จะจบโดยไม่ commit

**ใช้ตอนไหน:** เมื่ออยากส่งการ์ดที่ batch แปลเสร็จขึ้น API รันระหว่างที่ batch ยังทำงานอยู่ก็ได้

**ใช้ยังไง:**
```bat
:: ดับเบิลคลิก tools\update-data.bat  หรือ
node tools/update-data.mjs
node tools/update-data.mjs --no-push          :: แค่ import + validate ไม่ commit/push
node tools/update-data.mjs "D:\other\cards-th.jsonl" "D:\other\verified.json"
```
ค่าเริ่มต้นใช้ `E:\YGO-Translator\batch\cards-th.jsonl` และ `E:\YGO-Translator\extension\verified.json`

| ข้อความ error | แก้ยังไง |
| --- | --- |
| ขั้น: เตรียมไฟล์ · ไม่พบไฟล์ผล batch | ตรวจ path หรือส่ง path เป็นอาร์กิวเมนต์แรก |
| ขั้น: git pull | มีงานในเครื่องที่ชนกับบน GitHub → `git status` ดูก่อน แล้ว commit หรือเก็บงานนั้น |
| ขั้น: import-batch | ดูบรรทัด `skip ...` ด้านบน · ถ้าเป็น `not valid JSON` หลายบรรทัด แปลว่าไฟล์ jsonl เสีย |
| ขั้น: validate | ดูชื่อไฟล์ที่ขึ้นด้านบน แก้ไฟล์นั้นแล้วรันใหม่ (ยังไม่ได้ push อะไร) |
| ขั้น: git commit | ตั้งชื่อและอีเมลด้วย `git config user.name` / `git config user.email` |
| ขั้น: git push · ruleset | main ห้าม push ตรง → commit อยู่ในเครื่องแล้ว ให้เปิด PR หรือตั้ง bypass ให้บัญชีผู้ดูแล |
| ขั้น: git push · มี commit ใหม่กว่า | `git pull --rebase` แล้ว `git push` |

---

<a id="review-ui"></a>
## `review-ui.bat` / `review-ui.mjs`: หน้าตรวจคำแปล

**ทำอะไร:** เปิดหน้าเว็บบนเครื่อง (`127.0.0.1:8787` เท่านั้น) ให้ตรวจทีละใบ
- ภาษาอังกฤษ (จาก `batch\cards-en.json` ในเครื่อง) คู่กับคำแปลไทย ทั้งสองฝั่งจัดสีและแบ่งย่อหน้าด้วย `extension/format.js` ตัวเดียวกับ extension
- แสดงปัญหาที่ rule-check เจอ · ยอดดู · ป้าย "ข้อความอังกฤษเปลี่ยนจากตอนแปล"
- แก้คำแปลในกล่องได้ เห็นตัวอย่างการแสดงผลสดด้านบน
- **เทียบเดิม | ใหม่ ข้างกันแบบ VS Code:** คำที่ถูกลบไฮไลต์แดงฝั่งซ้าย คำที่เพิ่มไฮไลต์เขียวฝั่งขวา (ตัดคำไทยด้วย `Intl.Segmenter`) · อัปเดตทุกครั้งที่พิมพ์ · ขึ้นเสมอในโหมดฟอร์ม และขึ้นในโหมดอื่นเมื่อแก้ข้อความในกล่องแล้ว
- เรียงใบยอดนิยมก่อน · กรองตามชนิดปัญหา (banish / หงาย-คว่ำ / ตัวเลข / ":" / ";" / ชื่อการ์ด …) · ค้นตามชื่อหรือ passcode
- โหมด "ทุกใบที่ยังเป็น AI" ใช้ไล่ตรวจใบยอดนิยมที่ไม่มี note ได้ด้วย
- ใบที่ [`ai-fix`](#ai-fix) ตรวจแล้วมีกล่อง **ความเห็นของ AI** (คำเตือนไหนเป็นปัญหาจริง / เตือนเกินจริง / แก้เองไม่สำเร็จเพราะอะไร) · ตัวกรอง "ai-fix บอกว่าเตือนเกินจริง"
- โหมด **"อาจผิดแบบเดียวกัน"**: รูปแบบความผิดจากคำแก้ที่ตรวจด้วย AI แล้ว + การ์ดที่ยังผิดแบบนั้น → ส่งให้ ai-fix / ไม่ส่ง (ดู [review-all](#review-all))
- โหมด **"คำแก้จาก Google Form"**: คำแก้จากคนที่ไม่มีบัญชี GitHub · **ดึงจาก Google Sheet อัตโนมัติ**ทุกครั้งที่เปิดโหมดนี้ จากลิงก์ CSV "เผยแพร่ไปยังเว็บ" ที่เก็บไว้ใน `E:\YGO-Translator\form-csv-url.txt` (หรือ env `YGOTH_FORM_CSV_URL` / `--form-url <ลิงก์>`) · ดึงได้แล้วเก็บสำเนาไว้ที่ `E:\YGO-Translator\form-responses.csv` ถ้าเน็ตหลุดจะใช้สำเนานี้ · ไม่ได้ตั้งลิงก์ = อ่านจากไฟล์นี้อย่างเดียว (ดาวน์โหลด CSV จาก Sheet มาวางเอง หรือ `--form <path>`)
  - ลิงก์ที่เผยแพร่: ใครมีลิงก์ก็อ่านคำตอบได้ อย่าใส่ลงใน repo · ถ้าหลุด ให้ "หยุดเผยแพร่" ใน Sheet แล้วเผยแพร่ใหม่
  - แสดงคำแก้ที่ส่งมาคู่กับภาษาอังกฤษ + คำแปลปัจจุบัน + เหตุผล/แหล่งอ้างอิง/ชื่อเครดิต · ตรวจ passcode, ความยาว, ข้อความอันตราย และ rule-check ให้
  - **ใช้คำแก้นี้** → บันทึกข้อความในกล่อง (แก้ต่อได้) เป็นสถานะ `community` พร้อม**ชื่อเครดิต** (ฟิลด์ `credit` — สาธารณะ แสดงใน extension "แก้โดย …"; ยาว ≤40 ไม่มีลิงก์/@/สัญลักษณ์ ไม่ผ่านจะไม่เก็บ) · **ไม่ใช้คำแก้นี้** → การ์ดไม่เปลี่ยน
  - คำตอบที่จัดการแล้วจดไว้ใน `form-responses.handled.json` ข้าง CSV จะไม่ขึ้นซ้ำแม้ดาวน์โหลด CSV ใหม่ทับ · ทั้งสองไฟล์อยู่นอก repo (มีชื่อเครดิตของผู้ส่ง ห้าม commit)

| ปุ่ม | คีย์ลัด | ผล |
| --- | --- | --- |
| ถูกแล้ว (โหมดฟอร์ม: ใช้คำแก้นี้) | Ctrl+Enter | status → `reviewed`, ลบ note (ถ้าแก้ในกล่องไว้จะบันทึกที่แก้) |
| บันทึกที่แก้ | Ctrl+S | บันทึกคำแปลในกล่อง + `reviewed` |
| ย้อน / ข้าม | Alt+← / Alt+→ | เลื่อนใบโดยไม่บันทึก (ถ้าแก้ค้างไว้จะถามก่อน) |

ปุ่มอยู่ในแถบติดขอบล่างจอ · หลังบันทึกจะขึ้นข้อความยืนยันบนใบถัดไป · ยังไม่มี undo — ถ้าบันทึกผิด แก้ใหม่ใน review-ui หรือ `git checkout -- data/cards/<id>.json` ก่อนรัน update-data

บันทึกลง `data/cards/{id}.json` ทันที (อัปเดต `en_sha256` เป็นข้อความอังกฤษเวอร์ชันที่ตรวจ) · ตรวจเสร็จแล้วปิดหน้าต่าง แล้วรัน `update-data.bat` เพื่อ commit + push
ใบที่ `reviewed` แล้ว import-batch / retry-flagged จะไม่เขียนทับ

**ใช้ยังไง:** ดับเบิลคลิก `tools\review-ui.bat` → รอโหลดการ์ด (บน HDD ประมาณ 1–1.5 นาที) → browser เปิดเอง
ถ้า cards-en.json อยู่ที่อื่น: `node tools/review-ui.mjs "D:\path\cards-en.json"` · เปลี่ยนพอร์ต: ตั้ง env `REVIEW_PORT`

**ความปลอดภัย:** รับเฉพาะ 127.0.0.1 · ต้องเปิดจากลิงก์ที่มี token สุ่ม (เปลี่ยนทุกครั้งที่เปิด) · API ต้องมี token ใน header และ Host ต้องเป็น 127.0.0.1/localhost (กันเว็บอื่นแอบสั่งบันทึก) · คำแปลแสดงด้วย textContent เท่านั้น

---

<a id="import-batch"></a>
## `import-batch.mjs`: แปลงผล batch เป็นไฟล์การ์ด

**ทำอะไร:** อ่าน `cards-th.jsonl` ที่ได้จาก `translate-all.ps1` แล้วเขียนเป็น `data/cards/{passcode}.json` ทีละใบ
- **ไม่เก็บข้อความภาษาอังกฤษ** (เพราะลิขสิทธิ์) เก็บแค่ `en_sha256`
- **ไม่เขียนทับ** การ์ดที่เป็น `community` หรือ `reviewed` แล้ว
- ถ้าการ์ดมีอยู่ใน `verified.json` จะได้สถานะ `reviewed` และใช้คำแปลที่ตรวจแล้ว
- ใบที่ rule-check สงสัย (เช่น ตัวเลขหาย, `;` `:` น้อยกว่าต้นฉบับ, ชื่อในเครื่องหมายคำพูดเปลี่ยน) จะมีฟิลด์ `note` ให้ไล่ตรวจ
- การ์ดที่ไม่มีอะไรเปลี่ยนจะไม่ถูกเขียนซ้ำ · บรรทัดสุดท้ายที่ batch ยังเขียนไม่เสร็จจะถูกข้าม

**ใช้ยังไง:** ปกติให้ใช้ `update-data` แทน ถ้าจะรันเอง:
```sh
node tools/import-batch.mjs "E:\YGO-Translator\batch\cards-th.jsonl" "E:\YGO-Translator\extension\verified.json"
```
ผลลัพธ์: `imported N · unchanged N · kept (community/reviewed) N · flagged by rule-check N · invalid N · broken lines N`
จะจบด้วย exit code 1 ถ้ามี `invalid` หรือ `broken lines` มากกว่า 1

หาใบที่ต้องตรวจ:
```sh
grep -l '"note"' data/cards/*.json
```
ตรวจแล้วให้แก้ `th` ถ้าผิด ลบ `note` ออก และถ้ามั่นใจแล้วเปลี่ยน `status` เป็น `reviewed`

---

<a id="validate"></a>
## `validate.mjs`: ตรวจรูปแบบ `data/`

**ทำอะไร:** ตรวจการ์ดทุกไฟล์ว่า
- ชื่อไฟล์ตรงกับ `id`
- ไม่มี passcode ซ้ำ รวมถึงใน `alt`
- มีฟิลด์ครบและไม่มีฟิลด์แปลก
- `status` ถูกต้อง และ `en_sha256` เป็น hex 64 ตัว
- `th` ไม่ยาวเกิน 6000 ตัวอักษร และไม่มี `< >`, URL, markdown หรือตัวควบคุม/bidi

นอกจากนี้ยังตรวจ `glossary.json` ด้วย

**ใช้ตอนไหน:** ก่อน push ทุกครั้งที่แก้ `data/` ด้วยมือ ส่วน CI (workflow `validate`) จะรันเองทุก PR และทุก push

**ใช้ยังไง:**
```sh
node tools/validate.mjs
```
ผ่าน: `ok · N passcodes` (exit 0) · ไม่ผ่าน: แสดงรายชื่อไฟล์พร้อมปัญหา (exit 1)

---

<a id="build"></a>
## `build.mjs`: สร้าง API

**ทำอะไร:** สร้าง `site/` สำหรับ GitHub Pages
- `v1/all.json.gz`: ทุกการ์ด `{ passcode: { name, th, status, en_sha256 } }` (passcode ใน `alt` ชี้ไปที่การ์ดเดียวกัน)
- `v1/cards/{passcode}.json`: การ์ดทีละใบ
- `v1/glossary.json`
- `v1/manifest.json`: เวอร์ชัน (timestamp UTC `YYYYMMDDHHMMSS`), จำนวน, sha256 ของ `all.json.gz` และลายเซ็น Ed25519

**ใช้ตอนไหน:** ไม่ต้องรันเอง workflow `publish API` จะรันให้ทุกครั้งที่ push แล้ว `data/` เปลี่ยน
ถ้าจะลองในเครื่อง ให้รันโดยไม่ตั้ง env แล้วจะได้ manifest แบบ UNSIGNED (extension จะไม่รับ แต่ใช้ดูผลได้)

**ใช้ยังไง:**
```sh
node tools/build.mjs           # → site/ (UNSIGNED)
```
env `YGOTH_SIGNING_KEY` = เนื้อหาไฟล์ private key (PEM) · ใน Actions มาจาก secret ใน environment `release`
`site/` อยู่ใน `.gitignore` ห้าม commit

---

<a id="review-all"></a>
## `review-all.bat` / `review-all.mjs`: ตรวจคำแก้ทั้งหมด (GitHub + Google Form)

**ทำอะไร:** ในคำสั่งเดียว
1. **GitHub:** รัน `review-issues.mjs` กับ issue ที่ติด `needs-ai-review` ทีละหัวข้อ: ดึงข้อความอังกฤษจาก YGOPRODeck → rule-check → AI 2 รอบ → คอมเมนต์ผลใน issue + ติด label `ai-accept` / `ai-reject` / `ai-needs-human` (เหลือป้ายผล AI อันเดียวเสมอ)
   - ได้ `ai-accept` ต่อเมื่อ AI ยอมรับทั้งสองรอบ (มั่นใจ ≥ 90%) **และ** rule-check ผ่าน
   - ต้องมี token `YGOTH_GITHUB_TOKEN` (ตั้งครั้งเดียวด้วย `--set-token`) ไม่มี token จะข้ามส่วนนี้
2. **Google Form:** ดึงคำตอบล่าสุดจาก Sheet → ตรวจรูปแบบ (passcode, ความยาว, ข้อความอันตราย) → rule-check + AI 2 รอบ → เก็บผลไว้ใน `E:\YGO-Translator\form-responses.ai.json` (นอก repo)
   - ตรวจเฉพาะคำแก้ใหม่ หรือคำแก้ที่ข้อความเปลี่ยน (`--recheck` = ตรวจใหม่ทั้งหมด) · Ollama พังกลางทาง ใบนั้นจะถูกลองใหม่รอบหน้า

**ไม่เขียนคำแปลลงฐานเอง และไม่ merge เองเด็ดขาด** (จนกว่าจะผ่านเกณฑ์เฟส 5 · AI ยังพลาดเรื่อง "คุณ/คู่ต่อสู้ควบคุม" ได้ และผลกับข้อความเดิมพลิกได้ระหว่างรอบ) — เปิด `review-ui.bat` → โหมด "คำแก้จาก Google Form" จะเห็นกล่อง **ผลตรวจ AI** (ผ่าน/ไม่ผ่าน/ให้คนดู, ปัญหาที่เจอ, ความมั่นใจแต่ละรอบ, คำแปลกลับเป็นอังกฤษ) และกรอง "AI ผ่าน" ได้ แล้วกด ใช้ / ไม่ใช้ → `update-data.bat`

**ใช้ยังไง:** ดับเบิลคลิก `tools\review-all.bat` (เปิด Ollama ให้ถ้ายังไม่เปิด — ไม่ปิด Ollama ที่ batch ใช้อยู่ · ปิดเกมก่อน เพราะใช้การ์ดจอ)
```bat
tools\review-all.bat              :: ตรวจทั้งหมด
tools\review-all.bat --set-token  :: ครั้งแรก: วาง GitHub token (fine-grained เฉพาะ ygo-th · ดู MAINTAINING.md)
tools\review-all.bat --dry-run    :: ดูผล ไม่แตะ GitHub ไม่บันทึกผลฟอร์ม
tools\review-all.bat --recheck    :: ตรวจคำแก้จากฟอร์มใหม่ทั้งหมด
tools\review-all.bat --open-pr    :: GitHub: เปิด PR ให้ issue ที่ได้ ai-accept (branch fix/{passcode}-issue-{n}) — ผู้ดูแล merge เอง
```
| env | ค่าเริ่มต้น |
| --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `gemma3:12b` |
| `OLLAMA_NUM_GPU` | `46` (ลดเป็น 42 ถ้าการ์ดจอเต็ม) |

**ความปลอดภัย:** ข้อความจาก issue/ฟอร์มถือว่าไว้ใจไม่ได้ จึงส่งให้ AI เป็นข้อมูล JSON เท่านั้น AI ไม่มี tool และต้องตอบตาม schema ที่กำหนด · ไม่ว่า AI จะตอบอะไร สคริปต์ทำได้แค่คอมเมนต์ ติด label และ (ถ้าใช้ `--open-pr`) แก้ `th` ของการ์ดใบเดียวในฟอร์ม · ข้อความจาก AI ในคอมเมนต์ถูกตัดลิงก์/markdown ออก
ตัวตรวจ AI อยู่ใน `tools/ai-review.mjs` (prompt บอกโมเดลว่าช่อง "เหตุผล" พูดถึงคำแปลเดิม ไม่ใช่คำแก้) · การอ่านฟอร์มอยู่ใน `tools/form.mjs` ใช้ร่วมกับ `review-ui`

**การ์ดใบอื่นที่อาจผิดแบบเดียวกัน** (ทั้ง Google Form และ GitHub issue · เฉพาะคำแก้ที่ AI ไม่ตีตก):
1. AI สรุปว่าคำแก้นี้แก้ความผิดแบบไหน เช่น `"face-up"` เขียนเป็น `คว่ำอยู่` ควรเป็น `หงายอยู่` · ถ้าเป็นการแก้เฉพาะใบ (สำนวน/ลำดับคำ) จะไม่มีรูปแบบ
2. โค้ดตรวจว่ารูปแบบตรงกับที่แก้จริง (คำเดิมผิดแบบนั้น คำแก้ไม่ผิดแล้ว) — AI ตอบมั่วจะถูกทิ้ง
3. `similar.mjs` ค้นทุกใบที่ยังเป็นสถานะ ai: อังกฤษมีวลีนั้น ไทยมีคำผิด และมีคำที่ถูกน้อยกว่าที่อังกฤษต้องการ (นับเหมือน rule-check — ใบที่ใช้ "คว่ำ" ถูกกับ face-down ไม่นับ) ใช้ `batch\cards-th.jsonl` ไฟล์เดียว ~2 วินาที
4. เก็บใน `batch\similar.json` (นอก repo) · GitHub: ใส่รายชื่อ 10 ใบแรกในคอมเมนต์ AI ด้วย
5. **review-ui โหมด "อาจผิดแบบเดียวกัน"** → ดูรูปแบบ + รายชื่อการ์ด (ยอดนิยมก่อน, นับใหม่จากคำแปลปัจจุบัน) → **ส่ง N ใบให้ ai-fix** / ไม่ส่ง / ยกเลิก → ดับเบิลคลิก `batch\ai-fix.bat`

---

<a id="ai-fix"></a>
## `batch\ai-fix.bat` / `ai-fix.mjs`: ให้ AI แก้เฉพาะจุดในใบที่ rule-check สงสัย

**ต่างจาก `retry-flagged`:** retry-flagged แปลใหม่ทั้งใบ (รันไปแล้ว) · ai-fix **แก้เฉพาะคำที่ผิด** ส่วนอื่นคงเดิม สำหรับใบที่แปลใหม่แล้วก็ยังไม่ผ่าน

**ทำอะไร (ต่อใบ):**
1. **ทีละบรรทัด:** batch แปล 1 ประโยคอังกฤษ = 1 บรรทัดไทย → หาว่าบรรทัดไหนมีปัญหา แล้วส่งให้ AI เฉพาะบรรทัดนั้นพร้อมประโยคอังกฤษของมัน (12b หาเองไม่เจอว่าเลข 1 หายจากตรงไหน — ชี้บรรทัดให้แล้วแก้ได้) · บรรทัดอื่นไม่ถูกแตะเลย · จับคู่ไม่ได้ค่อยส่งทั้งใบ
2. AI ตอบว่าแต่ละคำเตือน **เป็นปัญหาจริงไหม** + บรรทัดที่แก้
3. **โค้ดตรวจคำแก้ซ้ำ** (ไม่เชื่อ AI อย่างเดียว) — ไม่ผ่านข้อใดข้อหนึ่ง = ไม่ใช้:
   - เปลี่ยนคำไม่เกินที่กำหนด · เติมเลข/"ออกจากเกม" ต้อง**เพิ่มคำอย่างเดียว** (ห้ามลบคำเดิม) · หงาย↔คว่ำ ลบได้แค่คำที่ผิด
   - คำสำคัญจาก glossary (เด็ค มือ สุสาน สนาม คู่ต่อสู้ …) ต้องไม่หาย · คว่ำ ต้องไม่น้อยกว่าจำนวน face-down/Set ในอังกฤษ
   - **ตรวจความหมาย:** ถาม AI แบบแคบว่าคำที่เติม (หงาย / ออกจากเกม / ตัวเลข) ขยายสิ่งเดียวกับในอังกฤษไหม · ปัญหาแบบอื่นใช้ตัวตรวจทั่วไป (แปลกลับแล้วเทียบ)
   - rule-check ทั้งใบต้องเตือนน้อยลง · จำนวนบรรทัดเท่าเดิม · ไม่มีข้อความอันตราย
4. **ผ่าน** → ต่อท้าย `cards-th.jsonl` (ยังเป็นสถานะ ai) → `update-data.bat` ส่งขึ้น API
   **AI บอกว่าเตือนเกินจริงทุกข้อ** → ไม่แก้ แต่จดเหตุผลไว้ → review-ui โหมด note แสดงกล่อง "ความเห็นของ AI" และกรอง "ai-fix บอกว่าเตือนเกินจริง" ได้ (กด ถูกแล้ว ได้เร็วขึ้น)
   **แก้ไม่ได้** → การ์ดคงเดิม ยังขึ้นใน review-ui พร้อมเหตุผล

ผลทุกใบจดใน `batch\ai-fix-results.json` · รันซ้ำได้ (ข้ามใบที่ตรวจแล้วและคำแปลไม่เปลี่ยน) · ปิดหน้าต่างได้ทุกเมื่อ · ใบที่ reviewed/community ไม่แตะ · กันชนกับ batch ที่รันอยู่ (jsonl แก้ไม่ถึง 90 วิ = ไม่รัน)

**ใช้ยังไง:** ดับเบิลคลิก `batch\ai-fix.bat` (ปิด Ollama เดิมแล้วเปิดใหม่ด้วยค่าเดียวกับ batch) → เสร็จแล้ว `update-data.bat`
```bat
batch\ai-fix.bat --dry-run --limit 20   :: ลองดูก่อน: แสดงบรรทัดเดิม/ใหม่ ไม่บันทึก
batch\ai-fix.bat --only 12345,67890     :: เฉพาะบางใบ
batch\ai-fix.bat --recheck              :: ตรวจใหม่ทุกใบ (แม้เคยตรวจแล้ว)
```
ประมาณ 6–10 วินาที/ใบ · ทดสอบ 30 ใบยอดนิยม (2026-11-08): แก้ได้ 18 ใบ (อ่านทุกบรรทัดแล้วถูกหมด) · เตือนเกินจริง 1 · แก้ไม่ได้ 11 (ปล่อยให้คนดู) · รันจริงแล้วกับทั้งฐาน: แก้ 290 ใบ

**`batch\retry-flagged.bat`** (วิธีเก่า): แปลใบที่ rule-check สงสัยใหม่ทั้งใบ สูงสุด 3 ครั้ง · ใช้เมื่ออยากให้แปลใหม่หมดแทนการแก้เฉพาะจุด · ตัวเลือก `--limit N`, `--only id,id`, `--num-gpu 42`

---

<a id="triage"></a>
## `triage.mjs`: คัดกรอง issue (Actions)

**ทำอะไร:** ตรวจ issue แบบ **แก้คำแปล** ทันทีที่มีคนเปิดหรือแก้ issue โดยไม่ใช้ AI
- passcode ต้องเป็นตัวเลข และต้องหาเจอใน YGOPRODeck
- ต้องมีคำแปลที่เสนอ ยาวไม่เกิน 6000 ตัวอักษร ไม่มีข้อความอันตราย และไม่ซ้ำกับคำแปลเดิม
- การ์ดที่เป็น `reviewed` แล้วจะไม่ส่งต่อให้ AI ผู้ดูแลอ่านเอง
- คนเดียวเปิดได้ไม่เกิน 5 หัวข้อใน 24 ชั่วโมง

ผลคือคอมเมนต์ใน issue และติด label 1 ตัว: `needs-ai-review` (ผ่าน) / `invalid` / `rate-limited`
ถ้าผ่านแต่ rule-check เทียบกับภาษาอังกฤษแล้วสงสัย จะติด `rule-check-failed` เพิ่มอีกตัว
ถ้าผู้เสนอแก้ issue ระบบจะตรวจใหม่อัตโนมัติ

**ใช้ตอนไหน:** ไม่ต้องรันเอง workflow `triage` จะรันให้ ตัวสคริปต์อ่าน event จาก `GITHUB_EVENT_PATH` เท่านั้น
ข้อความใน issue จึงไม่ถูกส่งเข้า shell และสั่งคำสั่งแปลก ๆ ไม่ได้ · workflow นี้มีสิทธิ์แค่อ่านโค้ดและเขียน issue

---

<a id="keygen"></a>
## `keygen.mjs`: สร้างกุญแจเซ็น

**ทำอะไร:** สร้างคู่กุญแจ Ed25519
- private key ไปอยู่ที่ `<โฟลเดอร์ที่ระบุ>/ygo-th-signing.pem` สคริปต์ไม่ยอมเขียนไฟล์นี้ลงใน repo
- public key ไปอยู่ที่ `keys/ygo-th.pub.pem`

ถ้ามีไฟล์ private key อยู่แล้ว สคริปต์จะไม่ยอมทับ

**ใช้ตอนไหน:** ครั้งเดียวตอนตั้งโปรเจกต์ (ทำแล้วเมื่อ 2026-11-05) หรือตอนกุญแจหลุด

**ใช้ยังไง:**
```sh
node tools/keygen.mjs "E:\YGO-Translator\keys"
```
ถ้าต้องหมุนกุญแจ:
1. ย้ายไฟล์ `.pem` เดิมออกก่อน
2. รัน keygen
3. วาง private key ใหม่ใน secret `YGOTH_SIGNING_KEY` (environment `release`)
4. แก้ `PUBLIC_KEY_B64` ใน `extension/background.js`
5. ออก extension เวอร์ชัน **MAJOR** (ดู [VERSIONING.md](../VERSIONING.md))

extension ตัวเก่าจะไม่รับฐานที่เซ็นด้วยกุญแจใหม่ ต้องให้เพื่อนอัปเดต extension

---

<a id="test"></a>
## `tools.test.mjs`: test

**ทำอะไร:** ตรวจโค้ดที่อ่านข้อความจากคนนอกและตัวกันข้อความอันตราย — ตัวอ่าน CSV ของฟอร์ม, ตัวอ่านฟอร์ม issue, `isPasscode`, `unsafeText`, `cleanCredit`, `ruleCheck`, ตัวตัดประโยค, รูปแบบความผิด (`similar`), การนับคำที่เปลี่ยน (`ai-fix`) และว่ากุญแจสาธารณะใน extension ตรงกับ `keys/ygo-th.pub.pem`
ไม่อ่าน `data/` เลย รันเสร็จใน ~1 วินาที · ใช้ `node:test` ที่มากับ Node ไม่ต้องติดตั้งอะไร

**ใช้ตอนไหน:** Actions รันเองทุก push/PR (workflow `validate`) · ถ้าแก้ไฟล์ใน `tools/` ให้รันเองก่อน push
```sh
node --test tools/tools.test.mjs
```

---

<a id="lib"></a>
## โค้ดกลาง (ไม่ได้รันเอง)

| ไฟล์ | มีอะไร | ใครใช้ |
| --- | --- | --- |
| `lib.mjs` | ค่าคงที่, `norm()` / `enHash()`, schema การ์ด, `ruleCheck()`, `RULE_HINTS`, `splitSentences()`, ตัวช่วยรูปแบบความผิด, `wordChange()`, `loadCards()` | ทุกตัว + `batch\ai-fix`, `batch\retry-flagged` |
| `github.mjs` | เรียก GitHub REST, แยกค่าจากฟอร์ม issue (env `GITHUB_TOKEN`, `GITHUB_REPOSITORY`), ดึงข้อความอังกฤษจาก YGOPRODeck | triage, review-issues |
| `form.mjs` | ที่อยู่ไฟล์ของ Google Form, อ่าน CSV, จดคำแก้ที่จัดการแล้ว/ผล AI | review-all, review-ui |
| `ai-review.mjs` | คุยกับ Ollama: ตรวจคำแก้ 2 รอบ, สรุปรูปแบบความผิด, แก้เฉพาะจุด, ตรวจตำแหน่งคำ | review-all, review-issues, `batch\ai-fix` |
| `similar.mjs` | หาใบที่อาจผิดแบบเดียวกัน, ไฟล์ `batch\similar.json` / `batch\ai-fix-results.json` | review-all, review-issues, review-ui, `batch\ai-fix` |
| `review-issues.mjs` | ส่วน GitHub ของ review-all | review-all.bat |

ถ้าแก้ `norm()` ต้องแก้ใน `extension/background.js` ให้ตรงกัน ไม่งั้นป้าย "อาจเก่า" จะขึ้นทุกใบ
ค่า Ollama (`num_gpu 46`, `num_ctx 3072`) ต้องตรงกันทั้ง `ai-review.mjs`, `batch\translate-all.ps1`, `batch\retry-flagged.mjs` และ extension รุ่นของ Tonk ไม่งั้น Ollama โหลดโมเดลใหม่ทุกครั้งที่สลับ
