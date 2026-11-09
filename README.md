# ygo-th — คำแปลการ์ดภาษาไทย

ฐานคำแปลข้อความการ์ด Yu-Gi-Oh! ภาษาไทย **14,000+ ใบ** เปิดให้ใช้ฟรี พร้อม extension ที่แสดงคำแปลบน [Dueling Nexus](https://duelingnexus.com)

> โปรเจกต์แฟน ไม่เกี่ยวข้องกับ Konami · คำแปลไม่ใช่ข้อความทางการ ใช้ตัดสินกฎในการแข่งขันไม่ได้ — ดู [DISCLAIMER.md](DISCLAIMER.md)

## ใช้บน Dueling Nexus (Edge / Chrome)

1. ดาวน์โหลด `ygo-th-extension-X.Y.Z.zip` จาก [Releases](https://github.com/prachpawee-tang/ygo-th/releases) แล้วแตกไฟล์ไว้ในโฟลเดอร์ที่จะไม่ลบ
2. เปิด `edge://extensions` (หรือ `chrome://extensions`) → เปิด **Developer mode**
3. กด **Load unpacked** → เลือกโฟลเดอร์ที่แตกไว้
4. เข้า Dueling Nexus แล้วเลือกการ์ด — ข้อความการ์ดเป็นภาษาไทย **คลิกที่ข้อความเพื่อสลับ ไทย / English**

- คำแปลอัปเดตเองทุก 12 ชั่วโมง ไม่ต้องโหลด zip ใหม่
- มี extension เวอร์ชันใหม่ จะขึ้นป้าย **NEW** บนไอคอน → แตก zip ใหม่ทับโฟลเดอร์เดิม แล้วกดรีโหลด (↻)
- ใต้คำแปลมีป้ายบอกที่มา:

| ป้าย | ความหมาย |
| --- | --- |
| ✓ ตรวจแล้ว | ผู้ดูแลตรวจเทียบภาษาอังกฤษแล้ว |
| 👥 ชุมชน | มีคนเสนอแก้ และผู้ดูแลรับแล้ว (ขึ้นชื่อผู้ช่วยแก้ถ้ามี) |
| 🤖 AI | แปลด้วย AI ยังไม่มีคนตรวจ — อาจผิดได้ |
| ⚠ อาจเก่า | ข้อความอังกฤษบนเว็บไม่ตรงกับตอนที่แปล (การ์ดอาจโดน errata) |

## เจอคำแปลผิด? ช่วยแก้ได้

กด **"แจ้งแก้คำแปล"** ใต้คำแปล → เปิดฟอร์มที่กรอกเลขการ์ดและคำแปลเดิมไว้ให้แล้ว แก้เฉพาะจุดที่ผิดแล้วกดส่ง **ไม่ต้องมีบัญชีอะไรเลย**
(หรือ [เปิดฟอร์มเอง](https://forms.gle/WTz1vW8Nwp9TXnST9) · มีบัญชี GitHub ใช้ลิงก์ **(GitHub)** ข้าง ๆ เพื่อเปิด issue)

AI ช่วยตรวจความหมายเทียบภาษาอังกฤษ แล้วผู้ดูแลตัดสินเองทุกคำแก้ · หลักการแปลและศัพท์มาตรฐาน: [CONTRIBUTING.md](CONTRIBUTING.md)

## ใช้ข้อมูลในโปรเจกต์ของคุณ (API)

ไฟล์นิ่งบน GitHub Pages ไม่ต้องขอ key · Base URL: `https://prachpawee-tang.github.io/ygo-th/v1/`

| ไฟล์ | ได้อะไร |
| --- | --- |
| `manifest.json` | เวอร์ชัน, จำนวนการ์ด, sha256 ของ `all.json.gz`, ลายเซ็น |
| `all.json.gz` | ทุกการ์ด `{ "passcode": { name, th, status, en_sha256, credit? } }` (~2 MB) |
| `cards/{passcode}.json` | การ์ดใบเดียว |
| `glossary.json` | ศัพท์มาตรฐาน อังกฤษ → ไทย |

```js
const card = await fetch("https://prachpawee-tang.github.io/ygo-th/v1/cards/89631139.json").then(r => r.json());
console.log(card.th, card.status);
```

- `status`: `ai` · `community` · `reviewed` (ความหมายตามตารางป้ายด้านบน)
- `en_sha256`: sha256 ของข้อความอังกฤษหลังยุบช่องว่าง `text.replace(/\s+/g, " ").trim()` — ถ้าไม่ตรงกับข้อความที่คุณมี คำแปลอาจเก่า
- `th`: 1 บรรทัดต่อ 1 ประโยค/เอฟเฟกต์ของภาษาอังกฤษ · ข้อความธรรมดา (แสดงด้วย `textContent` ไม่ใช่ HTML)
- ลายเซ็น: ตรวจ `signature` (base64, Ed25519) กับ `JSON.stringify(manifest)` ด้วย [`keys/ygo-th.pub.pem`](keys/ygo-th.pub.pem)
- ใบอนุญาตของข้อมูลและโค้ด: [LICENSE](LICENSE)

## โครงสร้าง repo

```
data/cards/{passcode}.json   คำแปล 1 ใบต่อไฟล์ (ไม่เก็บข้อความอังกฤษ เก็บแค่ sha256)
data/glossary.json           ศัพท์มาตรฐาน
extension/                   extension สำหรับผู้ใช้ (ไม่มี AI)
tools/                       เครื่องมือผู้ดูแล → tools/README.md
.github/                     ฟอร์ม issue + workflows (ตรวจข้อมูล, สร้าง API, ออก release)
```

```sh
node --test tools/tools.test.mjs   # test
node tools/validate.mjs            # ตรวจข้อมูล
node tools/build.mjs               # สร้าง site/v1 (ไม่มีลายเซ็นถ้าไม่ได้ตั้ง YGOTH_SIGNING_KEY)
```
Node 20+ · ไม่มี dependency

ผู้ดูแล: [MAINTAINING.md](MAINTAINING.md) · การออกเวอร์ชัน: [VERSIONING.md](VERSIONING.md)

## ขอบคุณ

ข้อความการ์ดภาษาอังกฤษสำหรับแปลและตรวจ จาก [YGOPRODeck API](https://ygoprodeck.com/api-guide/)
