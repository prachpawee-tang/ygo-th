# คู่มือผู้ดูแล

## ตั้งค่าครั้งแรก (ทำครั้งเดียว)

1. **กุญแจเซ็น API** — บนเครื่องตัวเอง: `node tools/keygen.mjs "E:\YGO-Translator\keys"`
   - commit `keys/ygo-th.pub.pem`
   - เปิดไฟล์ `ygo-th-signing.pem` คัดลอกทั้งไฟล์ไปที่ Settings → Environments → New environment `release`
     → Add secret `YGOTH_SIGNING_KEY` แล้วสำรองไฟล์ไว้นอกเครื่อง (USB/ตัวจัดการรหัสผ่าน) อย่า commit
   - ใน environment `release` ตั้ง Deployment branches = `main` เท่านั้น
2. **GitHub Pages** — Settings → Pages → Source: **GitHub Actions**
3. **ป้องกัน main** — Settings → Rules → New branch ruleset (main): Require a pull request, Require status checks (`validate`),
   Block force pushes · เปิด "Require review from Code Owners" ไว้ก่อน (ปิดได้ตอนเปิด auto-merge ในเฟส 5)
4. **Actions** — Settings → Actions → General: Workflow permissions = **Read repository contents** (workflow ขอสิทธิ์เพิ่มเองเฉพาะที่ต้องใช้),
   และ "Require approval for all outside collaborators" สำหรับ fork PR
5. **บัญชี** — เปิด 2FA ให้บัญชี GitHub

## ตัวตรวจ AI บนเครื่อง (option B)

ต้องมี Node 20+ (`winget install OpenJS.NodeJS.LTS`) และ Ollama + gemma3:12b ที่ติดตั้งไว้แล้ว

1. สร้าง fine-grained token: GitHub → Settings → Developer settings → Fine-grained tokens
   - Repository access: **เฉพาะ ygo-th**
   - Permissions: Issues = Read and write, Pull requests = Read and write, Contents = Read and write
   - อายุ token ≤ 90 วัน
2. ดับเบิลคลิก `tools\review.bat` — ครั้งแรกจะถาม token (เก็บไว้ในตัวแปรผู้ใช้ Windows ของเครื่องนี้)
3. เฟส 3: รันแบบคอมเมนต์อย่างเดียว (ค่าเริ่มต้น) · เฟส 4: `tools\review.bat --open-pr`

สคริปต์ไม่ merge เองเด็ดขาด — ผู้ดูแลอ่าน PR แล้ว merge

เครื่องมือแต่ละตัวทำอะไร ใช้ตอนไหน ดู [tools/README.md](tools/README.md) · การตั้งชื่อ branch/commit/tag และการออกเวอร์ชัน extension ดู [VERSIONING.md](VERSIONING.md)

## อัปเดตฐานจาก batch

ดับเบิลคลิก `tools\update-data.bat` (หรือ `node tools/update-data.mjs [cards-th.jsonl] [verified.json]`)
→ import-batch แล้ว validate ในคำสั่งเดียว ถ้าขั้นไหนพังจะขึ้นกรอบ **[ผิดพลาด]** บอกขั้นและสาเหตุ
ถ้าผ่าน จะสรุปว่ามีไฟล์เปลี่ยนกี่ไฟล์ และมีการ์ดที่มี note กี่ใบ แล้ว commit/push เอง
รันได้ระหว่างที่ batch ยังทำงานอยู่ (ถ้าบรรทัดสุดท้ายยังเขียนไม่เสร็จ จะข้ามบรรทัดนั้นไป) · การ์ดที่ไม่มีอะไรเปลี่ยนจะไม่ถูกเขียนทับ

แบบแยกขั้น:
```sh
node tools/import-batch.mjs "E:\YGO-Translator\batch\cards-th.jsonl" "E:\YGO-Translator\extension\verified.json"
node tools/validate.mjs
```

การ์ดสถานะ `community`/`reviewed` จะไม่ถูกทับ · ใบที่ rule-check สงสัยจะมี `note` ให้ไล่ตรวจ:
`grep -l '"note"' data/cards/*.json`

## เมื่อมีปัญหา

- คำแปลผิดหลุดเข้าไป → revert commit นั้น, push → Pages build ใหม่เอง
- กุญแจเซ็นหลุด → `keygen` ใหม่, เปลี่ยน secret, ออก extension เวอร์ชันที่มีกุญแจสาธารณะใหม่
- โดนป่วน → Settings → Moderation options → Interaction limits (จำกัดเฉพาะผู้เคยมีส่วนร่วม)
