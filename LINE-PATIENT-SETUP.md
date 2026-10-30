# LINE OA — เมนูคนไข้ Bangluang

## ความปลอดภัยของหน้าเจ้าหน้าที่

`staff-access.gs` เพิ่มรหัสเจ้าหน้าที่ 64 ตัวอักษรที่เก็บเป็น SHA-256 ใน Script Properties และส่งผ่าน POST body เท่านั้น หน้าโปรแกรมจะตรวจรหัสกับ Apps Script ก่อนแสดงข้อมูล และเก็บรหัสในหน่วยความจำของแท็บเท่านั้น API เดิมที่อ่านข้อมูลด้วย GET จะตอบ `staff_unauthorized` หลัง deploy รุ่นใหม่นี้ การซิงก์และงานจัดฟันของเจ้าหน้าที่ส่งรหัสผ่าน POST; webhook ของ LINE ยังเดินทางเดิม

ก่อน deploy ให้เพิ่ม `staff-access.gs` ใน Apps Script, อัปเดต `Code.gs` และ `patient-backend.gs`, แล้วรัน `setupStaffAccess` ใน Apps Script ด้วยบัญชีเจ้าของชีต คัดลอกรหัสที่หน้าต่างแสดงเก็บในระบบจัดการรหัสของคลินิก จากนั้น deploy เวอร์ชันใหม่และเผยแพร่ `index.html` ใหม่ให้พร้อมกัน เมื่อเปิดโปรแกรม เจ้าหน้าที่วางรหัสนี้หลังกรอก PIN การสร้างรหัสใหม่จะทำให้รหัสเก่าใช้ไม่ได้ทันที

หน้าโปรแกรมย้าย cache `bl_` เดิมจาก localStorage ไป sessionStorage ซึ่งอยู่เฉพาะแท็บปัจจุบัน และล้างเมื่อกดออกจากระบบ ควรตรวจว่าข้อมูลที่ยังไม่ซิงก์ถูกบันทึกในชีตก่อนอัปเดตหน้าโปรแกรม

ข้อจำกัดที่ต้องแก้ต่อ: webhook บน Apps Script ไม่สามารถอ่าน `X-Line-Signature` จากคำขอเพื่อยืนยันต้นทางได้ จึงควรย้าย webhook ไปยังบริการที่ตรวจลายเซ็นได้ รหัสเจ้าหน้าที่เป็นรหัสร่วมของคลินิก การยกเลิกสิทธิ์รายบุคคลต้องเปลี่ยนรหัสใหม่ และ Channel access token เก่าที่เคยอยู่ในโค้ดสาธารณะต้องออกใหม่และตั้งเป็น `LINE_CHANNEL_ACCESS_TOKEN` ด้วยตนเองก่อนแทน `ortho-backend.gs` เวอร์ชันใหม่ใน Apps Script

## สิ่งที่เพิ่ม

Rich Menu 3 ช่อง ขนาด 2500 × 843 สีม่วงไวน์/ทองตามโปรแกรมเดิม:

- นัดครั้งต่อไป: รวมตารางนัดทั่วไปและนัดจัดฟัน เรียงวัน/เวลา ตัดนัดยกเลิก
- ประวัติรักษา: วัน รายการ และหมอ จาก `บันทึกการรักษา` เฉพาะ HN ของบัญชีที่ยืนยันแล้ว
- ข้อมูลจัดฟัน: วันเริ่ม ชนิด หมอ จำนวนวันที่ปรับเครื่องมือจริง และรายการเครื่องมือหลุด

จำนวนปรับเครื่องมือนับวันไม่ซ้ำที่มี `ปรับเครื่องมือ` ใน ortho_log (ไม่เหมารวมวันติดเครื่องมือหรือรายการอื่น) จำนวนหลุดนับรายการ `เครื่องมือหลุด` ไม่ใช่จำนวนชิ้นหรือจำนวนซี่ ถ้าบันทึกย้อนหลังไม่ครบ จำนวนจะแสดงเท่าที่มีบันทึกจริง

## Apps Script (โปรเจกต์เดิมที่ผูกกับชีต)

1. เพิ่ม `patient-backend.gs` และอัปเดต `Code.gs` (เพิ่ม route สองจุดก่อน route เดิม)
2. อัปเดต `ortho-backend.gs` และแทน `richmenu-setup.gs` ด้วยเวอร์ชันใหม่ ทั้งสองไฟล์อ่าน Channel access token จาก Script Properties เท่านั้น ต้องตั้งค่าก่อน deploy เพื่อให้ webhook / daily push เดิมทำงานต่อ
3. Project Settings → Script Properties:
   - `PATIENT_LINE_CHANNEL_ID`: Channel ID ของ **LINE Login** ที่เป็นเจ้าของ LIFF ต้องมี scope `profile` (ห้ามใช้ Messaging API Channel ID)
   - `PATIENT_LIFF_ID`: LIFF ID ที่จะใช้ในเมนู
   - `LINE_CHANNEL_ACCESS_TOKEN`: token ใหม่ของ Messaging API ใน OA นี้
   - `PATIENT_RICHMENU_IMAGE_URL`: ไม่จำเป็น ค่าเริ่มต้นคือ `https://toy113.github.io/Bangluang/richmenu-patient.png`
4. รัน `setupPatientPortal` เพื่อสร้างชีตการผูก `line_patient_links` และเมนู **LINE คนไข้**
5. Deploy → Manage deployments → Edit → New version โดยใช้ /exec เดิม และทดสอบ POST จริงจาก LINE ก่อนเปิดเมนูใหม่

## LIFF / GitHub Pages

1. เผยแพร่ `patient.html`, `patient.css`, `patient.js`, `patient-config.js`, `richmenu-patient.png`
2. ตรวจ `patient-config.js` ว่า API และ LIFF ID ตรงกับ deployment จริง (ไฟล์นี้มีเฉพาะ public identifiers)
3. ใน LINE Developers เปลี่ยน Endpoint URL ของ LIFF เป็น `https://toy113.github.io/Bangluang/patient.html` พร้อมเปิด scope `profile` หรือสร้าง LIFF ใหม่แล้วแก้ public config และ Script Property ให้ตรงกัน
4. LINE Login และ Messaging API ต้องอยู่ภายใต้ Provider เดียวกัน หากต้องการใช้ LINE user ID ร่วมกัน
5. เมนูส่ง query `?view=appt`, `?view=history`, `?view=ortho` รองรับการสลับหน้าและ hash ภายในแอป

## ผูกบัญชีคนไข้

เปิดชีตด้วยบัญชีเจ้าหน้าที่ → เมนู **LINE คนไข้ → ออกรหัสผูกบัญชี** → กรอก HN ที่ตรวจสอบตัวตนแล้ว → แจ้งรหัสให้คนไข้ด้วยตนเอง รหัสมีอายุ 30 นาที ใช้ได้ครั้งเดียวและเก็บเฉพาะ hash

คนไข้เปิด LIFF ใส่ HN เบอร์โทรที่ลงทะเบียน และรหัส 12 ตัว ระบบตรวจ access token กับ LINE รวมถึง channel ID และอายุ token ทุกครั้งก่อนอ่านข้อมูล ไม่ใช้ userId/HN ที่ browser ส่งมาในการอนุญาตอ่านข้อมูล และไม่เก็บประวัติหรือ token ใน localStorage

ผิด 5 ครั้งจะล็อกการลองของ LINE นั้น 15 นาที รหัสแต่ละชุดลองได้ 5 ครั้ง ออกใหม่จะยกเลิกรหัสเดิม ไม่ให้ LINE หนึ่งผูกหลาย HN หรือ HN หนึ่งผูกหลาย LINE หากต้องเปลี่ยนบัญชี ให้เจ้าหน้าที่ใช้ **ยกเลิกการผูก LINE** ก่อน ไม่มีการย้ายสิทธิ์จาก binding จัดฟันเก่าอัตโนมัติ

## ติดตั้ง Rich Menu

1. รัน `preparePatientRichMenu`: validate → สร้าง → อัปโหลด PNG → ตรวจ readback เก็บเป็น pending โดยยังไม่เปลี่ยนเมนูที่คนไข้เห็น
2. ทดสอบผูกบัญชีด้วยบัญชีทดสอบ, เปิดทั้ง 3 เมนู, เปลี่ยน LINE แล้วต้องอ่านข้อมูลคนแรกไม่ได้, ตรวจคนไข้ทั่วไปที่ไม่มีจัดฟัน
3. รัน `activatePatientRichMenu` หลังหน้าข้อมูลทำงานจริง: เก็บ default menu เดิม ตั้ง default ใหม่ และอ่านกลับยืนยัน (ไม่ลบเมนูเก่า)
4. หากต้องย้อนกลับ รัน `rollbackPatientRichMenu` ผู้ที่มี per-user rich menu อาจยังเห็นเมนูของตน ต้องตรวจ mapping ก่อนเปลี่ยน ไม่ unlink ทุกคนแบบเหมารวม

## ข้อควรแก้ก่อนให้คนไข้ใช้งานจริง

ซอร์สเดิมมี LINE token ฝังในไฟล์ที่เป็นสาธารณะ ต้อง revoke/rotate ที่ LINE Developers แล้วตั้งค่าใหม่ใน Script Properties การลบจาก commit ใหม่อย่างเดียวไม่ลบ token ออกจาก Git history อย่านำ token เก่ามาใช้

ใน backend เดิม `getAll`, `orthoList`, `orthoGet` และ admin routes ยังไม่มีการตรวจสิทธิ์ฝั่ง server การเพิ่ม patient API นี้ไม่ได้ปิดช่องทางเดิมทั้งหมด ต้องจัดการสิทธิ์ admin/backend เดิมก่อนยืนยันว่าระบบทั้งชุดป้องกันการเข้าถึงข้อมูลคนไข้แล้ว ห้ามใช้ endpoint เก่าแบบ `orthoGet&lineUserId=...` แทน patient API ใหม่

## เอกสารอ้างอิง

- https://developers.line.biz/en/docs/liff/using-user-profile/
- https://developers.line.biz/en/reference/line-login/#verify-access-token
- https://developers.line.biz/en/docs/messaging-api/using-rich-menus/
- https://developers.line.biz/en/reference/messaging-api/#upload-rich-menu-image
