# คู่มือผู้ดูแล

ทุกอย่างทำจากเครื่องผู้ดูแล (Windows) ด้วยการดับเบิลคลิกไฟล์ `.bat` ใน `tools\`
GitHub Actions ทำส่วนที่เหลือเอง: ตรวจข้อมูล → สร้าง API + เซ็น → ขึ้น GitHub Pages → extension ของทุกคนอัปเดตภายใน 12 ชม.

```
คำแก้เข้ามา (Google Form / GitHub issue)
   │  [Actions] triage ตรวจรูปแบบ issue ทันที (ไม่ใช้ AI)
   ▼
review-all.bat ── AI บนเครื่องตรวจความหมาย 2 รอบ (ไม่เขียนลงฐาน)
   ▼
review-ui.bat ─── ผู้ดูแลดู เดิม | ใหม่ + ผล AI แล้วกด ใช้ / ไม่ใช้   (GitHub: merge PR เอง)
   ▼
update-data.bat ─ commit + push ──► [Actions] validate + test + build + เซ็น ──► Pages ──► extension
```

> **ไม่มีอะไร merge เองอัตโนมัติ** — AI เป็นแค่คำแนะนำ ผู้ดูแลตัดสินทุกคำแก้ (จนกว่าจะผ่านเกณฑ์เฟส 5: ≥50 หัวข้อ, AI ตรงกับผู้ดูแล ≥95%, ไม่เคยให้ผ่านคำแปลที่ความหมายผิด)

## งานที่ทำบ่อย

### มีคำแก้เข้ามา
1. `tools\review-all.bat` — ตรวจทั้ง Google Form และ GitHub issue ในคำสั่งเดียว
2. `tools\review-ui.bat` → โหมด **"คำแก้จาก Google Form"** → กด **ใช้คำแก้นี้** / **ไม่ใช้คำแก้นี้**
   - ถ้ามีโหมด **"อาจผิดแบบเดียวกัน"** ขึ้นรายการ: ดูรายชื่อการ์ด → **ส่งให้ ai-fix** → ทีหลังรัน `batch\ai-fix.bat`
3. GitHub issue: อ่านคอมเมนต์ AI ใน issue → แก้ใน review-ui เอง หรือ merge PR (ถ้ารันด้วย `--open-pr`)
4. `tools\update-data.bat`

### ตรวจคำแปลเอง
`tools\review-ui.bat` → โหมด **"ใบที่ rule-check สงสัย"** (เรียงยอดนิยมก่อน) → ถูกแล้ว `Ctrl+Enter` · บันทึกที่แก้ `Ctrl+S` · ข้าม `Alt+→` → ปิดหน้าต่าง → `tools\update-data.bat`

### ส่งผลแปลจาก batch ขึ้น API
`tools\update-data.bat` — pull → นำเข้า → ตรวจ → commit (เฉพาะ `data/`) → push · ขั้นไหนพังจะขึ้นกรอบ **[ผิดพลาด]** บอกสาเหตุและวิธีแก้
- การ์ดที่ผู้ดูแลตรวจแล้ว (`reviewed`) หรือรับจากชุมชน (`community`) จะไม่ถูกผล AI เขียนทับ
- `--no-push` = หยุดหลังตรวจ ไม่ commit

### ออก extension เวอร์ชันใหม่
แก้ `version` ใน `extension/manifest.json` → ทดสอบแบบ Load unpacked → commit → push tag `ext-vX.Y.Z` → Actions สร้าง Release ให้ · กติกาเต็ม: [VERSIONING.md](VERSIONING.md)

## เมื่อมีปัญหา

| เรื่อง | ทำอย่างไร |
| --- | --- |
| คำแปลผิดหลุดขึ้น API | แก้ใน review-ui แล้ว update-data · หรือ revert commit นั้นบน GitHub → Pages สร้างใหม่เอง |
| Actions แดง | เปิดแท็บ Actions ดูขั้นที่พัง · `validate` = ไฟล์ใน `data/` ผิดรูปแบบ หรือ test ตก (รัน `node --test tools/tools.test.mjs` ในเครื่องดู) |
| ไม่ยอม publish (unsigned) | secret `YGOTH_SIGNING_KEY` หายหรือผิด → ใส่ใหม่ใน environment `release` |
| **กุญแจลับหลุด** | `node tools/keygen.mjs "E:\YGO-Translator\keys"` → เปลี่ยน secret → แก้ `PUBLIC_KEY_B64` ใน `extension/background.js` → ออก extension เวอร์ชัน MAJOR ใหม่ (test จะตกถ้าลืมแก้กุญแจใน extension) |
| GitHub token หมดอายุ | สร้างใหม่ (ดูด้านล่าง) → `tools\review-all.bat --set-token` |
| ลิงก์ Sheet ของฟอร์มหลุด | ใน Google Sheet: หยุดเผยแพร่ แล้วเผยแพร่ใหม่ → ใส่ลิงก์ใหม่ใน `E:\YGO-Translator\form-csv-url.txt` |
| โดนป่วนใน issue | Settings → Moderation options → Interaction limits · triage จำกัด 5 หัวข้อ/คน/วันอยู่แล้ว |

## ตั้งค่าครั้งแรก (ทำแล้ว — ไว้ดูตอนย้ายเครื่อง/ตั้ง repo ใหม่)

1. **กุญแจเซ็น API:** `node tools/keygen.mjs "E:\YGO-Translator\keys"`
   - commit `keys/ygo-th.pub.pem`
   - คัดลอกทั้งไฟล์ `ygo-th-signing.pem` ไปที่ Settings → Environments → `release` → secret `YGOTH_SIGNING_KEY` · Deployment branches = `main` เท่านั้น
   - สำรองไฟล์ `.pem` ไว้นอกเครื่อง · **ห้าม commit** (`.gitignore` กันไว้แล้ว)
2. **Pages:** Settings → Pages → Source: **GitHub Actions**
3. **ป้องกัน main:** Settings → Rules → branch ruleset: require status check `validate`, block force push
4. **Actions:** Workflow permissions = **Read repository contents** (แต่ละ workflow ขอสิทธิ์เพิ่มเฉพาะที่ใช้) · require approval สำหรับ PR จาก fork
5. **บัญชี:** เปิด 2FA
6. **GitHub token สำหรับ AI ตรวจ issue:** GitHub → Settings → Developer settings → Fine-grained tokens
   - Repository access: **เฉพาะ ygo-th** · Issues, Pull requests, Contents = Read and write · อายุ ≤ 90 วัน
   - `tools\review-all.bat --set-token` แล้ววาง token (เก็บในตัวแปรผู้ใช้ Windows — **อย่าวางในแชทหรือไฟล์**)
7. **บนเครื่อง:** Node 20+ (`winget install OpenJS.NodeJS.LTS`), Git, Ollama + gemma3:12b (`E:\YGO-Translator\install-ollama.bat`)

## กติกาความปลอดภัย (อย่าเปลี่ยนโดยไม่คิด)

- ข้อความจาก issue/ฟอร์มเป็นข้อมูลจากคนแปลกหน้า: workflow อ่านจากไฟล์ event เท่านั้น ไม่เอาไปต่อในคำสั่ง shell · ไม่ใช้ `pull_request_target` หรือ self-hosted runner
- extension และหน้า review-ui แสดงคำแปลด้วย `textContent` เท่านั้น
- ไม่เปิด Ollama (พอร์ต 11434) ออกอินเทอร์เน็ต · review-ui ฟังเฉพาะ 127.0.0.1 + token สุ่ม

รายละเอียดเครื่องมือแต่ละตัว: [tools/README.md](tools/README.md)
