# ตั้งให้ Apps Script อัปเดตเองเมื่อ push (ทำครั้งเดียว ~15 นาที)

ผลลัพธ์: เมื่อมีการแก้ไฟล์ `.gs` แล้ว push ขึ้น main → GitHub ตรวจ syntax → ส่งโค้ดเข้า Apps Script → สร้างเวอร์ชันใหม่ → อัปเดต deployment เดิม (URL เดิม ไม่ต้องแก้ค่าในเว็บ/LINE)

## ต้องทำบนคอมพิวเตอร์ (ทำบนมือถือไม่ได้)
1. เปิด https://script.google.com/home/usersettings → เปิด **Google Apps Script API** เป็น On
2. ติดตั้ง Node.js แล้วรัน `npm i -g @google/clasp@2` จากนั้น `clasp login` (ล็อกอินด้วยบัญชี Google ที่เป็นเจ้าของ Apps Script)
3. เปิด Apps Script → **Project Settings** → คัดลอก **Script ID**
4. `clasp clone <SCRIPT_ID>` ในโฟลเดอร์ว่าง → นำไฟล์ `appsscript.json` ที่ได้ มาเก็บใน repo ชื่อ **`apps-script-manifest.json`** (ห้ามเขียนเอง เพราะมีสิทธิ์/การตั้งค่า Web App อยู่ข้างใน ถ้าผิดระบบพังได้)
5. Apps Script → **Deploy → Manage deployments** → คัดลอก **Deployment ID** ของ Web app ตัวที่ใช้งานอยู่
6. GitHub repo → Settings → Secrets and variables → Actions → New secret 3 ตัว
   - `CLASPRC_JSON` = เนื้อหาไฟล์ `~/.clasprc.json` ทั้งไฟล์
   - `SCRIPT_ID`
   - `DEPLOYMENT_ID`
7. ทดสอบ: แท็บ **Actions → Deploy Apps Script → Run workflow**

## ต้องรู้ไว้
- โปรเจกต์นี้ต้องมี Apps Script **โปรเจกต์เดียว** ที่รวมไฟล์ `.gs` ทุกไฟล์ใน repo ถ้าแยกหลายโปรเจกต์ ต้องแจ้งให้แก้ workflow
- `CLASPRC_JSON` คือกุญแจเข้า Apps Script ทั้งบัญชี เก็บเป็น secret เท่านั้น ห้ามวางในแชตหรือไฟล์ใน repo
- ย้อนกลับ: Apps Script → Deploy → Manage deployments → แก้ deployment เดิม เลือกเวอร์ชันก่อนหน้า (ทุก push จะมีเวอร์ชันชื่อ `auto xxxxxxx`)
- การแก้โค้ดตรงใน Apps Script จะถูกทับเมื่อ push ครั้งถัดไป ให้แก้ผ่าน repo เท่านั้น
- ฟังก์ชันที่ต้องกดรันเองในครั้งแรก (เช่น ขอสิทธิ์ใหม่) ยังต้องกดเองใน Apps Script
