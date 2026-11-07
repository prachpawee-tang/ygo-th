# tools/ — เครื่องมือของผู้ดูแล

ทุกตัวต้องใช้ Node 20 ขึ้นไป ไม่ต้องติดตั้ง package เพิ่ม และต้องรันจากโฟลเดอร์ `ygo-th`
(ยกเว้นไฟล์ `.bat` ซึ่ง `cd` ไปที่โฟลเดอร์นั้นให้เอง)

## สรุปเร็ว

| เครื่องมือ | ทำอะไร | ใช้ตอนไหน | รันที่ไหน |
| --- | --- | --- | --- |
| [`update-data.bat`](#update-data) | pull + import + validate + commit + push ในคำสั่งเดียว | หลัง batch แปลการ์ดได้เพิ่ม | เครื่อง Tonk (ดับเบิลคลิก) |
| [`review-ui.bat`](#review-ui) | หน้าตรวจคำแปลใน browser (EN คู่ TH, ✓ ถูก / แก้ / ข้าม) | ไล่ตรวจใบที่มี note หรือใบยอดนิยม | เครื่อง Tonk (ดับเบิลคลิก) |
| [`import-batch.mjs`](#import-batch) | แปลงผล batch เป็น `data/cards/*.json` | ถูกเรียกจาก update-data | เครื่อง Tonk |
| [`validate.mjs`](#validate) | ตรวจรูปแบบไฟล์ใน `data/` | ก่อน push ทุกครั้ง · CI รันเองทุก PR/push | ทั้งสองที่ |
| [`build.mjs`](#build) | สร้าง API static `site/v1/` และเซ็น | Actions รันเองหลัง push เข้า main | Actions (ลองในเครื่องได้) |
| [`review.bat`](#review) | ให้ AI บนเครื่องตรวจคำแก้จาก issue | เมื่อมี issue ติด label `needs-ai-review` | เครื่อง Tonk (ต้องเปิด Ollama) |
| [`triage.mjs`](#triage) | ตรวจ issue แก้คำแปลแบบไม่ใช้ AI | Actions รันเองเมื่อมีคนเปิด/แก้ issue | Actions เท่านั้น |
| [`keygen.mjs`](#keygen) | สร้างกุญแจเซ็น manifest | ครั้งเดียว หรือตอนกุญแจหลุด | เครื่อง Tonk |
| `lib.mjs`, `github.mjs` | โค้ดกลางที่ตัวอื่น import | ไม่ได้รันเอง | — |

### ลำดับงานปกติ
```
batch แปลบนเครื่อง ──► update-data.bat (commit + push ให้เอง) ──► [Actions] validate + build ──► Pages ──► extension ของเพื่อน (ภายใน 12 ชม.)

เพื่อนเปิด issue ──► [Actions] triage ──► label needs-ai-review ──► review.bat (AI บนเครื่อง) ──► Tonk อ่านแล้ว merge เอง
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
- ภาษาอังกฤษ (จาก `batchcards-en.json` ในเครื่อง) คู่กับคำแปลไทย ทั้งสองฝั่งจัดสีและแบ่งย่อหน้าด้วย `extension/format.js` ตัวเดียวกับ extension
- แสดงปัญหาที่ rule-check เจอ · ยอดดู · ป้าย "ข้อความอังกฤษเปลี่ยนจากตอนแปล"
- แก้คำแปลในกล่องได้ เห็นตัวอย่างการแสดงผลสดด้านบน
- เรียงใบยอดนิยมก่อน · กรองตามชนิดปัญหา (banish / หงาย-คว่ำ / ตัวเลข / ":" / ";" / ชื่อการ์ด …) · ค้นตามชื่อหรือ passcode
- โหมด "ทุกใบที่ยังเป็น AI" ใช้ไล่ตรวจใบยอดนิยมที่ไม่มี note ได้ด้วย

| ปุ่ม | คีย์ลัด | ผล |
| --- | --- | --- |
| ✓ ถูกแล้ว | Ctrl+Enter | status → `reviewed`, ลบ note (ถ้าแก้ในกล่องไว้จะบันทึกที่แก้) |
| 💾 บันทึกที่แก้ | Ctrl+S | บันทึกคำแปลในกล่อง + `reviewed` |
| ข้าม → / ← ย้อน | Alt+→ / Alt+← | เลื่อนใบโดยไม่บันทึก |

บันทึกลง `data/cards/{id}.json` ทันที (อัปเดต `en_sha256` เป็นข้อความอังกฤษเวอร์ชันที่ตรวจ) · ตรวจเสร็จแล้วปิดหน้าต่าง แล้วรัน `update-data.bat` เพื่อ commit + push
ใบที่ `reviewed` แล้ว import-batch / retry-flagged จะไม่เขียนทับ

**ใช้ยังไง:** ดับเบิลคลิก `toolseview-ui.bat` → รอโหลดการ์ด (บน HDD ประมาณ 1–1.5 นาที) → browser เปิดเอง
ถ้า cards-en.json อยู่ที่อื่น: `node tools/review-ui.mjs "D:pathcards-en.json"` · เปลี่ยนพอร์ต: ตั้ง env `REVIEW_PORT`

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

<a id="review"></a>
## `review.bat` / `review-issues.mjs`: AI ตรวจคำแก้จากชุมชน

**ทำอะไร:** ดึง issue ที่เปิดอยู่และติด label `needs-ai-review` ทีละหัวข้อ แล้วทำตามลำดับ:
1. ดึงข้อความภาษาอังกฤษของการ์ดจาก YGOPRODeck
2. รัน rule-check
3. ให้ AI (Ollama บนเครื่อง) ตรวจ **2 รอบแยกกัน** เทียบกับต้นฉบับ
4. คอมเมนต์ผลลงใน issue แล้วติด label `ai-accept` / `ai-reject` / `ai-needs-human`
   ได้ `ai-accept` ต่อเมื่อ AI ยอมรับทั้งสองรอบ **และ** rule-check ผ่าน

**ไม่ merge เองเด็ดขาด** ผู้ดูแลต้องอ่านแล้วตัดสินเอง (ยังพลาดเรื่อง "คุณ/คู่ต่อสู้ควบคุม" ได้)

**ใช้ตอนไหน:** เมื่อเห็น issue ติด `needs-ai-review` ซึ่ง triage ติดให้เอง ก่อนรันต้องเปิด Ollama และหยุดเล่นเกมก่อน เพราะใช้การ์ดจอ

**ใช้ยังไง:**
```bat
tools\review.bat              :: เฟส 3: คอมเมนต์ + label อย่างเดียว
tools\review.bat --dry-run    :: แสดงว่าจะทำอะไร ไม่แตะ GitHub
tools\review.bat --open-pr    :: เฟส 4: เปิด PR ให้ด้วยเมื่อได้ ai-accept (branch fix/{passcode}-issue-{n})
```
ครั้งแรกจะถาม token (fine-grained เฉพาะ repo ygo-th: Issues, Pull requests, Contents = Read and write · อายุไม่เกิน 90 วัน)
แล้วเก็บไว้ในตัวแปรผู้ใช้ `YGOTH_GITHUB_TOKEN` · ดูวิธีสร้าง token ใน [MAINTAINING.md](../MAINTAINING.md)

| env | ค่าเริ่มต้น |
| --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `gemma3:12b` |

ความปลอดภัย: ข้อความใน issue ถือว่าไว้ใจไม่ได้ จึงส่งให้ AI เป็นข้อมูล JSON เท่านั้น AI ไม่มี tool และต้องตอบตาม schema ที่กำหนด
ไม่ว่า AI จะตอบอะไร สคริปต์ทำได้แค่คอมเมนต์ ติด label และ (ถ้าใช้ `--open-pr`) แก้ `th` ของการ์ดใบเดียวในฟอร์ม

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

## `lib.mjs` / `github.mjs`: โค้ดกลาง
- `lib.mjs`: ค่าคงที่, `norm()` / `enHash()` (ต้องตรงกับ extension: ยุบช่องว่างแล้วค่อย sha256), schema ของการ์ด, `ruleCheck()`, `loadCards()`
- `github.mjs`: เรียก GitHub REST และแยกค่าจากฟอร์ม issue ใช้ env `GITHUB_TOKEN` และ `GITHUB_REPOSITORY`

ถ้าแก้ `norm()` ต้องแก้ใน `extension/background.js` ให้ตรงกัน ไม่งั้นป้าย "อาจเก่า" จะขึ้นทุกใบ
