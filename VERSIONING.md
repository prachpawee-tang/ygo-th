# การตั้งชื่อและการจัดการเวอร์ชัน

ในโปรเจกต์นี้มี 3 อย่างที่มีเวอร์ชันของตัวเอง แต่ละอย่างนับเวอร์ชันคนละแบบ

| ของ | เวอร์ชันแบบ | อยู่ที่ | ใครเปลี่ยน |
| --- | --- | --- | --- |
| **Extension** | SemVer `X.Y.Z` | `extension/manifest.json` → `version` + tag `ext-vX.Y.Z` | ผู้ดูแลเปลี่ยนเอง |
| **ฐานคำแปล (ข้อมูล)** | timestamp `YYYYMMDDHHMMSS` (UTC) | `v1/manifest.json` → `manifest.version` | `tools/build.mjs` สร้างให้เองทุกครั้งที่ deploy ห้ามแก้มือ |
| **รูปแบบ API** | `ygo-th/vN` | `manifest.format` และ path `/vN/` | เปลี่ยนเมื่อมีการเปลี่ยนแบบ breaking เท่านั้น |

## 1. Extension: SemVer

| เพิ่มเลข | เมื่อไร | ตัวอย่าง |
| --- | --- | --- |
| **MAJOR** `3.0.0` | ตัวเก่าใช้ต่อไม่ได้: เปลี่ยนกุญแจเซ็น, ย้ายไปใช้ API `/v2`, เปลี่ยนโครง IndexedDB จนต้องล้างข้อมูลเดิม | หมุนกุญแจหลังกุญแจหลุด |
| **MINOR** `2.1.0` | เพิ่มความสามารถที่ตัวเก่ายังทำงานได้ตามปกติ | โหมดแสดงผลใหม่, รองรับเว็บอื่นเพิ่ม |
| **PATCH** `2.0.1` | แก้บั๊ก, แก้ selector เมื่อ Dueling Nexus เปลี่ยน DOM, แก้ข้อความ UI | `#card-description` เปลี่ยนชื่อ |

กฎ:
- `version` ใน manifest เขียนได้เฉพาะตัวเลขคั่นจุด (ข้อกำหนดของ Chrome/Edge) จึง **ไม่มี** `-beta` · ถ้าจะทดสอบ ให้ Load unpacked จากโฟลเดอร์ในเครื่อง ไม่ต้องออก tag
- tag ต้องตรงกับ manifest พอดี: `version: "2.0.1"` ↔ tag `ext-v2.0.1` ถ้าไม่ตรง workflow จะไม่ยอมออก release
- tag ที่ push ไปแล้ว **ห้ามลบหรือย้าย** ถ้าออกผิด ให้ออกเวอร์ชัน PATCH ถัดไปแทน (เพื่อนอาจดาวน์โหลดไฟล์ไปแล้ว)
- การแก้คำแปลไม่ต้องออก extension ใหม่ ฐานคำแปลอัปเดตเองทุก 12 ชม.

### ขั้นตอนออก release
1. แก้ `version` ใน `extension/manifest.json`
2. Load unpacked ทดสอบบน Edge: popup โหลดฐานได้ และหน้า Duel แสดงคำแปล
3. commit `ext: release 2.0.1` แล้ว merge เข้า `main`
4. สร้าง tag แล้ว push:
   ```sh
   git tag ext-v2.0.1
   git push origin ext-v2.0.1
   ```
5. workflow **release extension** จะ zip และสร้าง Release ให้เอง เปิดหน้า Releases ดูว่ามีไฟล์ `ygo-th-extension-2.0.1.zip`
6. ส่งลิงก์ Release ให้เพื่อน ถ้าเป็น MAJOR ต้องบอกเพื่อนด้วยว่าตัวเก่าจะไม่ได้รับอัปเดตฐานคำแปลแล้ว

## 2. ฐานคำแปล: timestamp อัตโนมัติ

- ทุก push เข้า `main` ที่แก้ `data/**` จะ build และเซ็นเป็นเวอร์ชันใหม่ (`20261104175900` = 2026-11-04 17:59:00 UTC)
- extension รับเฉพาะเวอร์ชันที่ **ใหม่กว่า** ของที่มีอยู่ จึงย้อนเวอร์ชันโดยการ deploy ของเก่าไม่ได้
  ถ้าจะถอยคำแปลที่ผิด ให้ `git revert` แล้ว push ซึ่งจะได้ timestamp ใหม่ที่มีเนื้อหาแบบเดิม

## 3. รูปแบบ API: `/vN`

- เพิ่มฟิลด์ใหม่ที่ตัวอ่านเก่าข้ามได้ ไม่นับเป็น breaking ใช้ `/v1` ต่อได้
- เปลี่ยนชื่อฟิลด์, เปลี่ยนวิธีเซ็น หรือเปลี่ยนโครง `all.json.gz` นับเป็น breaking ให้ build `/v2/` คู่กับ `/v1/`
  ไปสักระยะ ออก extension MAJOR ที่อ่าน `/v2` แล้วค่อยหยุด build `/v1` ทีหลัง

## 4. ชื่อ (naming convention)

### Branch
`main` คือของจริงที่ deploy อยู่ งานอื่นทำบน branch อายุสั้นแล้วเปิด PR

| prefix | ใช้กับ | ตัวอย่าง |
| --- | --- | --- |
| `data/` | เพิ่มหรือแก้คำแปลหลายใบ, import batch | `data/batch-2026-11-07` |
| `fix/` | แก้คำแปลใบเดียวจาก issue (`review-issues.mjs` สร้างชื่อนี้เอง) | `fix/26077387-issue-12` |
| `ext/` | งาน extension | `ext/below-mode-spacing` |
| `tools/` | สคริปต์ใน `tools/` | `tools/import-batch-dedupe` |
| `ci/` | workflow ใน `.github/` | `ci/actions-node24` |
| `docs/` | เอกสาร | `docs/contributing-th` |

ชื่อ branch ใช้ตัวเล็ก คั่นด้วย `-` และเป็นภาษาอังกฤษ

### Commit
```
<type>: <สรุปสั้น ภาษาอังกฤษ ขึ้นต้นด้วยคำกริยา ≤ 72 ตัวอักษร>

<รายละเอียด ภาษาไทยหรืออังกฤษก็ได้>
```
`type` มี: `data` · `ext` · `tools` · `ci` · `docs` · `chore`
ตัวอย่าง: `data: import batch 2026-11-07 (2,140 cards)` · `ext: fix selector after Dueling Nexus update` · `ext: release 2.0.1`

### Tag
| รูปแบบ | ความหมาย |
| --- | --- |
| `ext-vX.Y.Z` | release ของ extension (ตัวเดียวที่ tag) |

ฐานคำแปลไม่ต้อง tag เพราะเวอร์ชันอยู่ใน manifest และ git history อยู่แล้ว

### ไฟล์
| ของ | ชื่อ |
| --- | --- |
| คำแปล | `data/cards/{passcode}.json` (passcode หลักของการ์ด, passcode อื่นของใบเดียวกันอยู่ใน `alt`) |
| zip ที่แจก | `ygo-th-extension-X.Y.Z.zip` |
| กุญแจ | `keys/ygo-th.pub.pem` (สาธารณะ) · private key ตั้งชื่อ `ygo-th-signing.pem` และเก็บ **นอก repo** เท่านั้น |

### Label ของ issue
| label | ใครติด | ความหมาย |
| --- | --- | --- |
| `fix-translation` · `errata` · `glossary` | ฟอร์ม issue | ประเภทเรื่อง |
| `needs-ai-review` · `invalid` · `rate-limited` | triage (Actions) | ผลตรวจรูปแบบ |
| `ai-accept` · `ai-reject` · `ai-needs-human` | `review-issues.mjs` บนเครื่อง | ความเห็นของ AI ซึ่งคนยังต้อง merge เอง |

## 5. การป้องกันบน GitHub (แนะนำ)
- ruleset ของ `main`: บังคับใช้ PR และให้ `validate` ผ่านก่อน (ดู MAINTAINING.md)
- ruleset ของ tag `ext-v*`: Restrict deletions และ Block force pushes เพื่อกันลบหรือย้าย tag ที่ออกไปแล้ว
