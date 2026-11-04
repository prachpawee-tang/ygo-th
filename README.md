# ygo-th — คำแปลการ์ดภาษาไทย

ฐานข้อมูลคำแปลข้อความการ์ด Yu-Gi-Oh! เป็นภาษาไทย ทำโดยชุมชน เปิดให้ใช้ฟรีเป็น API แบบไฟล์ static
และมี extension สำหรับแสดงคำแปลบน Dueling Nexus

> โปรเจกต์แฟน ไม่เกี่ยวข้องกับ Konami · คำแปลไม่ใช่ข้อความทางการ ใช้ตัดสินกฎในการแข่งขันไม่ได้ — ดู [DISCLAIMER.md](DISCLAIMER.md)

## สถานะคำแปล

| สถานะ | ความหมาย |
| --- | --- |
| `ai` | แปลด้วย AI (gemma3:12b) ยังไม่มีคนตรวจ |
| `community` | มีคนเสนอแก้ ผ่านการตรวจอัตโนมัติ + AI และผู้ดูแล merge แล้ว |
| `reviewed` | ผู้ดูแลตรวจเทียบกฎแล้ว |

## ใช้ API

Base URL: `https://prachpawee-tang.github.io/ygo-th/v1/`

| Endpoint | ได้อะไร |
| --- | --- |
| `manifest.json` | เวอร์ชัน จำนวนการ์ด sha256 ของ `all.json.gz` และลายเซ็น Ed25519 |
| `all.json.gz` | ทุกการ์ด `{ passcode: { name, th, status, en_sha256 } }` |
| `cards/{passcode}.json` | การ์ดใบเดียว |
| `glossary.json` | ศัพท์มาตรฐาน EN → TH |

`en_sha256` = sha256 ของข้อความภาษาอังกฤษหลังยุบช่องว่าง (`text.replace(/\s+/g, " ").trim()`) ใช้เช็กว่าคำแปลตรงกับข้อความเวอร์ชันที่คุณมี
ถ้าไม่ตรง แปลว่าการ์ดอาจโดน errata — คำแปลอาจเก่า

ลายเซ็น: ตรวจ `signature` (base64) กับ `JSON.stringify(manifest)` ด้วยกุญแจสาธารณะใน [`keys/ygo-th.pub.pem`](keys/ygo-th.pub.pem)

## ช่วยแก้คำแปล

เปิด issue แบบ **แก้คำแปล** — ระบบจะตรวจรูปแบบทันที แล้ว AI จะตรวจความหมายเทียบภาษาอังกฤษ ผู้ดูแลตัดสินขั้นสุดท้าย
อ่านวิธีใน [CONTRIBUTING.md](CONTRIBUTING.md)

## โครงสร้าง

```
data/cards/{passcode}.json   คำแปล 1 ใบต่อไฟล์ (ไม่เก็บข้อความภาษาอังกฤษ)
data/glossary.json           ศัพท์มาตรฐาน
tools/                       validate · build · triage (Actions) · review-issues (AI บนเครื่องผู้ดูแล)
.github/                     ฟอร์ม issue และ workflows
```

```sh
node tools/validate.mjs     # ตรวจข้อมูล
node tools/build.mjs        # สร้าง site/v1 (ไม่เซ็นถ้าไม่มี YGOTH_SIGNING_KEY)
```

Node 20+ ไม่มี dependency

## ขอบคุณ

ข้อมูลการ์ดภาษาอังกฤษสำหรับตรวจคำแปลจาก [YGOPRODeck API](https://ygoprodeck.com/api-guide/)
