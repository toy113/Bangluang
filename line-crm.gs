/**********************************************************************
 * BANGLUANG DENTAL — LINE CRM  (Google Apps Script)
 * ไฟล์ใหม่ วางในโปรเจกต์ Apps Script เดียวกับ Code.gs / ortho-backend.gs
 *
 * ทำอะไรบ้าง
 *  - ผูกบัญชี LINE กับคนไข้ทุกคน (หน้า LIFF) + ยืนยันตัวตนด้วย LINE token ฝั่งเซิร์ฟเวอร์
 *  - ส่งยืนยันนัด / เตือนก่อนนัด (จัดฟัน 2 วัน, งานอื่น 2 วัน) พร้อมปุ่ม ยืนยัน / ขอเลื่อน / ติดต่อคลินิก
 *  - ขอเลื่อนนัด = สร้างงานให้พนักงาน (ไม่แตะตารางนัดจริง)
 *  - ส่งคำแนะนำหลังรักษา (เฉพาะ template ที่ทันตแพทย์อนุมัติแล้ว) + คำแนะนำพิเศษเฉพาะเคส
 *  - ถามอาการวันถัดไป 10:00 น. ปุ่มตอบตามหัตถการ, อาการฉุกเฉิน → สร้างงานด่วนให้พนักงาน + ตอบรับสั้น ๆ
 *  - กันส่งซ้ำด้วย log + key ไม่ซ้ำ, โหมดทดสอบ, ช่วงเวลาส่ง, กันโควตาหมด
 *  - rich menu ใหม่ 3 ปุ่ม (ลบของเดิมทิ้ง)
 *
 * ไม่มี AI วินิจฉัยหรือสั่งยา: ทุกข้อความตอบกลับเป็นข้อความคงที่ที่ทันตแพทย์อนุมัติแล้วเท่านั้น
 *
 * ติดตั้ง (ทำครั้งเดียว) ดูรายละเอียดใน LINE-CRM-SETUP.md
 *  1) เพิ่ม 2 บรรทัดใน Code.gs (บนสุดของ doGet และ doPost)
 *       doGet :  var _crm = crmRouteGet_(e);  if (_crm) return _crm;
 *       doPost:  var _crm = crmRoutePost_(e); if (_crm) return _crm;
 *  2) Script Properties: LINE_CHANNEL_ACCESS_TOKEN (token ใหม่)
 *  3) รัน crmSetup() หนึ่งครั้งจาก editor → สร้างชีต + template ร่าง + trigger ทุก 10 นาที
 *  4) Deploy เวอร์ชันใหม่ (Manage deployments > ดินสอ > New version)
 *  5) รัน crmSetupRichMenu() เพื่อลบ rich menu เดิมและสร้างใหม่
 **********************************************************************/

var CRM_TZ = 'Asia/Bangkok';
var CRM_DEFAULT_LIFF_ID = '2012312037-ZWyIL0I7';
var CRM_DEFAULT_RICHMENU_IMG = 'https://toy113.github.io/Bangluang/richmenu-crm.png';

var CRM_SHEETS = {
  links:     ['id','lineUserId','hn','patName','status','source','consent','displayName','inputName','inputPhone','createdAt','approvedBy','approvedAt','note','birthday'],
  followers: ['lineUserId','displayName','pictureUrl','status','followedAt','updatedAt','lastSeenAt'],
  log:       ['key','type','hn','patName','lineUserId','refId','status','detail','createdAt','pushCount'],
  tasks:     ['id','type','priority','status','hn','patName','lineUserId','aptId','aptDate','aptTime','detail','preference','createdAt','updatedAt','doneBy','resultNote'],
  followups: ['id','hn','patName','lineUserId','treatDate','templateId','proc','sentAt','answer','answerKind','answeredAt','taskId','status','rating','ratedAt','calledAt','calledBy','callNote','reviewAt'],
  templates: ['id','name','procKeywords','priority','aftercareText','followupEnabled','followupQuestion','followupOptions','status','version','approvedBy','approvedAt','updatedBy','updatedAt'],
  casenotes: ['id','treatId','hn','patName','text','author','status','approvedBy','approvedAt','sentAt','createdAt'],
  apt:       ['aptId','hn','confirmedAt','rescheduleAt','lastAction','updatedAt'],
  campaigns: ['id','name','segment','text','createdBy','createdAt','targets','sent','status']
};
var CRM_SHEET_NAMES = {
  links:'crm_links', followers:'crm_followers', log:'crm_log', tasks:'crm_tasks', followups:'crm_followups',
  templates:'crm_templates', casenotes:'crm_casenotes', apt:'crm_apt', campaigns:'crm_campaigns'
};

/* ============================ SETTINGS ============================ */
var CRM_DEFAULT_SETTINGS = {
  enabled: false,            // สวิตช์หลัก — ปิดไว้จนกว่าจะทดสอบ+อนุมัติครบ
  testMode: true,            // โหมดทดสอบ: ทุกข้อความ push ไปหา testUserId คนเดียว
  testUserId: '',
  staffNotifyOn: false,       // แจ้งแอดมินทาง LINE เมื่อคนไข้ขอเลื่อนนัด / ฉุกเฉิน / ขอให้โทรกลับ
  staffNotifyIds: '',         // lineUserId ของแอดมิน (คั่นด้วย ,) — ต้องเพิ่มเพื่อน LINE OA และทักแชทก่อน 1 ครั้ง
  staffNotifyTypes: 'reschedule,emergency,callback,message,receipt',
  sendStart: '08:00', sendEnd: '20:00',
  confirmOn: true,
  remindOn: true, remindHour: '10:00', orthoDays: 2, otherDays: 2,
  orthoKeywords: 'จัดฟัน,ปรับเครื่องมือ,รีเทนเนอร์,ถอดเครื่องมือจัดฟัน',
  receiptWaitMin: 30,        // ยังไม่มียอดเงิน → รอกี่นาทีก่อนส่งสรุป (เผื่อพนักงานกรอกยอดทีหลังหมอ) · 0 = ไม่รอ
  receiptOn: true,           // ส่งสรุปการรักษา + ค่าใช้จ่าย + ขอบคุณ ทันทีหลังบันทึกการรักษา
  aftercareOn: true, aftercareDelayMin: 0,
  birthdayOn: true,          // ส่งคำอวยพรวันเกิด (เช้าวันเกิด) เฉพาะคนที่กรอกวันเกิดใน LIFF และยินยอมรับข้อความ
  birthdayText: '🎂 สุขสันต์วันเกิดค่ะ คุณ{name}\nขอให้สุขภาพแข็งแรง ยิ้มได้สดใสทุกวันนะคะ\n\n🎁 ของขวัญวันเกิด: รับยาสีฟันฟรี 1 หลอด เมื่อมาตามนัดที่คลินิกในเดือน{month}นี้ค่ะ\nนัดคิวได้เลยโดยพิมพ์ในแชทนี้ หรือโทร {phone} 💜\n{clinic}',
  followupOn: true, followupHour: '10:00',
  reviewDocRules: 'สรวิศ=tpl_extraction,tpl_surgery;พัทธนันท์=tpl_extraction,tpl_filling;ภาคภูมิ=tpl_extraction,tpl_filling,tpl_surgery',   // จำกัดการเด้งไปหน้ารีวิว: หมอที่ชื่อมีคำนี้ → เฉพาะเทมเพลตที่ระบุ (รูปแบบ  คำในชื่อหมอ=tplId,tplId ; อีกคน=...) · หมอที่ไม่อยู่ในรายการ = ไม่เด้งไปรีวิว · ว่าง = ไม่จำกัด
  reviewOnOk: true,          // คนไข้ตอบ "ปกติดี" ในข้อความถามอาการ → ส่งการ์ดปุ่มไปหน้ารีวิว Google ทันที (ต่อคนไข้ไม่เกิน 1 ครั้งต่อ 360 วัน) · ใช้เมื่อปิดการให้คะแนนอยู่
  ratingOn: false, ratingTpls: 'tpl_extraction,tpl_surgery', reviewUrl: 'https://g.page/r/CXrZfNExDQq4EBM/review',   // ถามคะแนนบริการ 0-5 หลังตอบ "ปกติดี" (เฉพาะเทมเพลตใน ratingTpls) · ได้ 5 ส่งลิงก์รีวิว reviewUrl
  clinicName: 'คลินิกทันตกรรมบางหลวง',
  clinicPhone: '095-947-6759',
  linkApproval: 'staff',     // staff = พนักงานต้องกดอนุมัติการผูกบัญชี, auto = เบอร์+ชื่อตรงก็ผูกเลย
  quotaGuard: 20,            // หยุด push เมื่อโควตาคงเหลือ <= ค่านี้
  emergencyKeywords: 'หายใจลำบาก,หายใจไม่ออก,หายใจไม่สะดวก,กลืนลำบาก,กลืนไม่ได้,เลือดไม่หยุด,เลือดออกไม่หยุด,เลือดออกมาก,บวมลาม,บวมถึงตา,บวมถึงคอ,บวมมาก',
  // อาการฉุกเฉิน: ไม่แนะนำห้องฉุกเฉินอัตโนมัติ — สร้างงานด่วนให้พนักงาน และตอบรับข้อความนี้ (เว้นว่าง = ไม่ตอบ)
  emergencyText: 'ได้รับข้อความแล้วค่ะ 🙏 ทีมคลินิกจะติดต่อกลับโดยเร็วที่สุด',
  emergencyApprovedBy: '', emergencyApprovedAt: '',
  rescheduleText: 'รับเรื่องขอเลื่อนนัดแล้วค่ะ 🙏\nพนักงานจะติดต่อกลับเพื่อยืนยันวันเวลาใหม่\n\n*นัดเดิมยังคงอยู่จนกว่าคลินิกจะยืนยันการเปลี่ยนแปลง*\n\nสะดวกช่วงเวลาไหนคะ?',
  confirmThanksText: 'ขอบคุณค่ะ ✅ ยืนยันนัดเรียบร้อย แล้วพบกันนะคะ'
};

function crmSettings_() {
  var raw = PropertiesService.getScriptProperties().getProperty('CRM_SETTINGS');
  var s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch (e) { s = {}; }
  // ย้ายค่าครั้งเดียว: เตือนนัดล่วงหน้า 2 วันทุกประเภท (ค่าเดิมที่เคยบันทึกไว้เป็น 1 วัน) — หลังจากนี้ปรับเองในตั้งค่าได้ตามปกติ
  if (raw && s.remind2dMigrated !== true) {
    s.orthoDays = 2; s.otherDays = 2; s.remind2dMigrated = true;
    try { PropertiesService.getScriptProperties().setProperty('CRM_SETTINGS', JSON.stringify(s)); } catch (e) {}
  }
  // ย้ายค่าครั้งเดียว: ปิดการถามคะแนนบริการ (6 พ.ย. 69 ตามที่คลินิกสั่ง) — หลังจากนี้เปิดเองได้ในตั้งค่า "ให้คะแนนบริการ"
  if (raw && s.ratingOffMigrated !== true) {
    s.ratingOn = false; s.ratingOffMigrated = true;
    try { PropertiesService.getScriptProperties().setProperty('CRM_SETTINGS', JSON.stringify(s)); } catch (e) {}
  }
  // ย้ายค่าครั้งเดียว: เพิ่มเรื่องแจ้งแอดมิน "คนไข้พิมพ์เข้ามา" + "ส่งสรุปการรักษาแล้ว" (6 พ.ย. 69) — ปิดได้ในตั้งค่า
  if (raw && s.staffMsgMigrated !== true) {
    var tl = String(s.staffNotifyTypes || 'reschedule,emergency,callback').split(',').map(function (x) { return x.trim(); }).filter(String);
    ['message', 'receipt'].forEach(function (x) { if (tl.indexOf(x) === -1) tl.push(x); });
    s.staffNotifyTypes = tl.join(','); s.staffMsgMigrated = true;
    try { PropertiesService.getScriptProperties().setProperty('CRM_SETTINGS', JSON.stringify(s)); } catch (e) {}
  }
  // ย้ายค่าครั้งเดียว: กติกาเด้งไปรีวิวต่อหมอ (หมอทอย: ถอนฟัน/ผ่าฟันคุด · หมอก้อย: ถอนฟัน/อุดฟัน · หมอมายด์: ถอนฟัน/อุดฟัน/ผ่าฟันคุด)
  if (raw && s.reviewRulesV3 !== true) {
    s.reviewDocRules = CRM_DEFAULT_SETTINGS.reviewDocRules; s.reviewRulesV3 = true;
    try { PropertiesService.getScriptProperties().setProperty('CRM_SETTINGS', JSON.stringify(s)); } catch (e) {}
  }
  var out = {};
  for (var k in CRM_DEFAULT_SETTINGS) out[k] = (s[k] === undefined) ? CRM_DEFAULT_SETTINGS[k] : s[k];
  for (var k2 in s) if (out[k2] === undefined) out[k2] = s[k2];
  return out;
}
function crmSaveSettingsRaw_(s) {
  crmTouch_();
  PropertiesService.getScriptProperties().setProperty('CRM_SETTINGS', JSON.stringify(s));
}
function crmProp_(k, def) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return v ? v : def;
}
function crmToken_() {
  var t = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (t) return t;
  try { if (typeof ORTHO_LINE_TOKEN !== 'undefined' && ORTHO_LINE_TOKEN) return ORTHO_LINE_TOKEN; } catch (e) {}
  return '';
}
function crmLiffId_() { return crmProp_('LIFF_ID', CRM_DEFAULT_LIFF_ID); }
function crmLiffUrl_(tab) { return 'https://liff.line.me/' + crmLiffId_() + (tab ? ('?tab=' + tab) : ''); }
function crmChannelId_() { return crmProp_('LIFF_CHANNEL_ID', crmLiffId_().split('-')[0]); }

/* ============================ SHEET HELPERS ============================ */
// จำชีต + หัวตารางไว้ตลอดการทำงานรอบนี้ (ไม่ต้องอ่านหัวตารางซ้ำทุกครั้งที่อ่าน/เขียน → เร็วขึ้นมาก)
var CRM_SHEET_MEMO = {};
function crmSheet_(key) { return crmSheetInfo_(key).sh; }
function crmSheetInfo_(key) {
  if (CRM_SHEET_MEMO[key]) return CRM_SHEET_MEMO[key];
  var name = CRM_SHEET_NAMES[key], headers = CRM_SHEETS[key];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name), hdr;
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), headers.length).setNumberFormat('@');
    hdr = headers.slice();
  } else {
    var lastCol = Math.max(sh.getLastColumn(), 1);
    hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    while (hdr.length && hdr[hdr.length - 1] === '') hdr.pop();
    var missing = headers.filter(function (h) { return hdr.indexOf(h) === -1; });
    if (missing.length) { sh.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]); hdr = hdr.concat(missing); }
  }
  CRM_SHEET_MEMO[key] = { sh: sh, hdr: hdr };
  return CRM_SHEET_MEMO[key];
}
// มีการเขียนข้อมูล CRM → แคชหน้าแดชบอร์ดเก่าใช้ไม่ได้
function crmTouch_() { try { CacheService.getScriptCache().put('crm_gen', String(Date.now()) + Math.random(), 21600); } catch (e) {} }
function crmCell_(v, col) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    var c = String(col || '').toLowerCase();
    if (c === 'date' || c === 'treatdate' || c === 'aptdate' || c === 'วันที่' || c === 'วันเริ่ม' || c === 'วันติดบน' || c === 'วันติดล่าง' || c === 'วันเช็ครีเทนเนอร์' || c === 'นัดถัดไป' || c === 'ปรับล่าสุด' || c === 'วันใส่รีเทนเนอร์') return Utilities.formatDate(v, CRM_TZ, 'yyyy-MM-dd');
    if (c === 'time' || c === 'apttime' || c === 'นัดถัดไปเวลา') return Utilities.formatDate(v, CRM_TZ, 'HH:mm');
    return Utilities.formatDate(v, CRM_TZ, 'yyyy-MM-dd HH:mm');
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
/* อ่านชีตใด ๆ เป็น array ของ object (+ _row = เลขแถวจริง) */
// อ่านชีตแบบเร็ว: แปลงค่าเป็นข้อความเฉพาะแถวที่ test(raw, hdr) บอกว่าเอา (ข้ามการ format วันที่ของแถวอื่นทั้งหมด)
function crmReadByNameWhere_(name, test) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return [];
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  var vals = sh.getRange(1, 1, lr, lc).getValues();
  var hdr = vals[0], out = [];
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i];
    if (!test(row, hdr)) continue;
    var o = { _row: i + 1 };
    for (var c2 = 0; c2 < hdr.length; c2++) if (hdr[c2] !== '') o[hdr[c2]] = crmCell_(row[c2], hdr[c2]);
    out.push(o);
  }
  return out;
}
function crmColIdx_(hdr, names) {
  for (var j = 0; j < hdr.length; j++) if (names.indexOf(String(hdr[j])) !== -1) return j;
  return -1;
}
function crmHnTest_(hnSet) {
  var ix = null;
  return function (row, hdr) {
    if (ix === null) ix = crmColIdx_(hdr, ['hn', 'HN', 'Hn']);
    if (ix < 0) return false;
    var k = crmHN_(row[ix]);
    return !!k && hnSet[k] === true;
  };
}
function crmReadByName_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return [];
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  var vals = sh.getRange(1, 1, lr, lc).getValues();
  var hdr = vals[0], out = [];
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i], has = false;
    for (var c = 0; c < row.length; c++) if (row[c] !== '' && row[c] !== null) { has = true; break; }
    if (!has) continue;
    var o = { _row: i + 1 };
    for (var c2 = 0; c2 < hdr.length; c2++) if (hdr[c2] !== '') o[hdr[c2]] = crmCell_(row[c2], hdr[c2]);
    out.push(o);
  }
  return out;
}
function crmRead_(key) { crmSheet_(key); return crmReadByName_(CRM_SHEET_NAMES[key]); }
function crmAppend_(key, obj) {
  var info = crmSheetInfo_(key), sh = info.sh, hdr = info.hdr; crmTouch_();
  var row = hdr.map(function (h) { var v = obj[h]; return (v === undefined || v === null) ? '' : String(v); });
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return r;
}
function crmAppendMany_(key, objs) {
  if (!objs.length) return;
  var info = crmSheetInfo_(key), sh = info.sh, hdr = info.hdr; crmTouch_();
  var rows = objs.map(function (obj) { return hdr.map(function (h) { var v = obj[h]; return (v === undefined || v === null) ? '' : String(v); }); });
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, rows.length, hdr.length).setNumberFormat('@').setValues(rows);
}
function crmUpdate_(key, rowNum, patch) {
  var info = crmSheetInfo_(key), sh = info.sh, hdr = info.hdr; crmTouch_();
  for (var k in patch) {
    var c = hdr.indexOf(k);
    if (c === -1) continue;
    var v = patch[k];
    sh.getRange(rowNum, c + 1).setNumberFormat('@').setValue((v === undefined || v === null) ? '' : String(v));
  }
}
function crmFind_(rows, field, val) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][field]) === String(val)) return rows[i];
  return null;
}

/* ============================ UTIL ============================ */
function crmNow_() { return Utilities.formatDate(new Date(), CRM_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function crmToday_() { return Utilities.formatDate(new Date(), CRM_TZ, 'yyyy-MM-dd'); }
function crmHM_() { return Utilities.formatDate(new Date(), CRM_TZ, 'HH:mm'); }
function crmAddDays_(ds, n) {
  var p = String(ds).split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.toISOString().slice(0, 10);
}
function crmDateOnly_(v) {
  var s = String(v || '').trim();
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return '';
}
function crmHN_(v) { return String(v == null ? '' : v).replace(/[-\s]/g, '').trim().toUpperCase(); }
function crmPhone_(v) {
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('66') === 0 && d.length >= 11) d = '0' + d.slice(2);
  return d.slice(-9);
}
function crmNameKey_(v) {
  return String(v || '').replace(/^(คุณ|นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|ดร\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
function crmId_(prefix) { return prefix + Utilities.formatDate(new Date(), CRM_TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 1000); }
function crmJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
var CRM_TH_DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
var CRM_TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
function crmThaiDate_(ds) {
  var p = String(ds || '').split('-');
  if (p.length < 3) return String(ds || '');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return 'วัน' + CRM_TH_DAYS[d.getUTCDay()] + 'ที่ ' + (+p[2]) + ' ' + CRM_TH_MONTHS[+p[1] - 1] + ' ' + (+p[0] + 543);
}
function crmSplitList_(s) {
  return String(s || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}
function crmProcItems_(proc) {
  return String(proc || '').split(/[,+\/\n]|และ/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}
function crmHasWord_(text, words) {
  var t = String(text || '').toLowerCase();
  for (var i = 0; i < words.length; i++) if (words[i] && t.indexOf(String(words[i]).toLowerCase()) !== -1) return true;
  return false;
}

/* ============================ ROUTING ============================ */
function crmRouteGet_(e) {
  var p = (e && e.parameter) || {};
  var a = p.action || '';
  if (a.indexOf('crm') !== 0) return null;
  try {
    if (a === 'crmPortal')    return ContentService.createTextOutput(crmPortalJson_(p)).setMimeType(ContentService.MimeType.JSON);
    if (a === 'crmLinked')    return ContentService.createTextOutput(crmLinkedJson_()).setMimeType(ContentService.MimeType.JSON);   // รายชื่อ HN ที่ผูก LINE แล้ว (ให้เว็บแสดงแบดจ์)
    if (a === 'crmRateOpen')  return crmJson_(crmRateOpen_(p));   // ปุ่ม 5 ดาวในไลน์ (สาธารณะ ตรวจด้วยลายเซ็น k)
    if (a === 'crmBind')      return crmJson_(crmBind_(p));
    if (a === 'crmConsent')   return crmJson_(crmConsent_(p));
    if (a === 'crmBirthday')  return crmJson_(crmBirthday_(p));
    if (a === 'crmDashboard') return ContentService.createTextOutput(crmDashboardJson_(p.fresh === '1')).setMimeType(ContentService.MimeType.JSON);
    if (a === 'crmCall')      { var cb = JSON.parse(p.data || '{}'), cr = crmStaffAction_(cb); if (cr && cr.ok && cb.withDash) cr.dash = JSON.parse(crmDashboardJson_()); return crmJson_(cr); }
    return crmJson_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return crmJson_({ ok: false, error: String(err && err.message || err) });
  }
}
function crmRoutePost_(e) {
  var body = null;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return null; }
  if (!body) return null;
  if (body.events && Object.prototype.toString.call(body.events) === '[object Array]') {
    crmHandleWebhook_(body.events, body.destination);
    return ContentService.createTextOutput('OK');
  }
  if (body.crm) {
    try { var rr = crmStaffAction_(body); if (rr && rr.ok && body.withDash) rr.dash = JSON.parse(crmDashboardJson_()); return crmJson_(rr); }
    catch (err2) { return crmJson_({ ok: false, error: String(err2 && err2.message || err2) }); }
  }
  return null;
}

/* ============================ LINE API ============================ */
function crmApi_(method, path, payload, host) {
  var opt = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + crmToken_() } };
  if (payload !== undefined && payload !== null) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch((host || 'https://api.line.me') + path, opt);
  var code = res.getResponseCode(), txt = res.getContentText();
  var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
  return { code: code, data: data, text: txt };
}
function crmReply_(replyToken, messages) {
  if (!replyToken || !messages || !messages.length) return;
  crmApi_('post', '/v2/bot/message/reply', { replyToken: replyToken, messages: messages.slice(0, 5) });
}
function crmText_(t) { return { type: 'text', text: String(t).slice(0, 4900) }; }
function crmQuota_(force) {
  var cache = CacheService.getScriptCache();
  var c = !force && cache.get('crm_quota');
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  var q = { type: '', limit: null, used: null, remaining: null, checkedAt: crmNow_() };
  try {
    var a = crmApi_('get', '/v2/bot/message/quota');
    if (a.code === 200 && a.data) { q.type = a.data.type; q.limit = (a.data.type === 'limited') ? a.data.value : null; }
    var b = crmApi_('get', '/v2/bot/message/quota/consumption');
    if (b.code === 200 && b.data) q.used = b.data.totalUsage;
    if (q.limit !== null && q.used !== null) q.remaining = q.limit - q.used;
    if (a.code !== 200) q.error = 'quota_' + a.code;
  } catch (e) { q.error = String(e); }
  cache.put('crm_quota', JSON.stringify(q), 600);
  return q;
}

/* ส่ง push พร้อม log/dedupe/test mode — คืน true ถ้าส่งออก (หรือส่งในโหมดทดสอบ) */
function crmLogKeys_() {
  var rows = crmRead_('log');
  var done = {}, fails = {};
  rows.forEach(function (r) {
    if (r.status === 'failed') fails[r.key] = (fails[r.key] || 0) + 1;
    else done[r.key] = r;
  });
  return { done: done, fails: fails, rows: rows };
}
function crmKey_(s, key) { return (s.testMode ? 'T:' : '') + key; }
function crmIsDone_(state, key) { return !!state.done[key] || (state.fails[key] || 0) >= 3; }

function crmSend_(s, state, ctx, messages) {
  // ctx: {key,type,hn,patName,lineUserId,refId}
  var key = ctx.key;
  if (crmIsDone_(state, key)) return false;
  if (state.pushBudget !== undefined && state.pushBudget <= 0) return false;
  var to = ctx.lineUserId, msgs = messages.slice(0, 5), status = 'sent';
  if (s.testMode) {
    if (!s.testUserId) return false;
    to = s.testUserId;
    msgs = [crmText_('🧪 โหมดทดสอบ — ข้อความนี้ปกติจะส่งถึง คุณ' + (ctx.patName || '-') + (ctx.hn ? ' (HN ' + ctx.hn + ')' : ''))].concat(messages).slice(0, 5);
    status = 'test';
  }
  var res = crmApi_('post', '/v2/bot/message/push', { to: to, messages: msgs });
  var ok = res.code === 200;
  var row = { key: key, type: ctx.type, hn: ctx.hn || '', patName: ctx.patName || '', lineUserId: ctx.lineUserId || '',
    refId: ctx.refId || '', status: ok ? status : 'failed', detail: ok ? (ctx.detail || '') : ('HTTP ' + res.code + ' ' + String(res.text || '').slice(0, 180)),
    createdAt: crmNow_(), pushCount: ok ? 1 : 0 };
  crmAppend_('log', row);
  if (ok) { state.done[key] = row; if (state.pushBudget !== undefined) state.pushBudget--; }
  else state.fails[key] = (state.fails[key] || 0) + 1;
  return ok;
}
function crmAllDone_(state, key, tg) {
  for (var i = 0; i < tg.length; i++) if (!crmIsDone_(state, key + '>' + tg[i].lineUserId)) return false;
  return true;
}
function crmSentWithinHours_(state, keyPrefix, hours) {
  var lim = Date.now() - hours * 3600000;
  for (var k in state.done) {
    if (k.indexOf(keyPrefix) !== 0) continue;
    var r = state.done[k];
    if (r.status !== 'sent' && r.status !== 'test') continue;
    var t = new Date(String(r.createdAt).replace(' ', 'T') + '+07:00').getTime();
    if (t >= lim) return true;
  }
  return false;
}
function crmMark_(state, key, type, ctx, status, detail) {
  if (state.done[key]) return;
  var row = { key: key, type: type, hn: ctx.hn || '', patName: ctx.patName || '', lineUserId: ctx.lineUserId || '', refId: ctx.refId || '',
    status: status, detail: detail || '', createdAt: crmNow_(), pushCount: 0 };
  state.pending = state.pending || [];
  state.pending.push(row);
  state.done[key] = row;
}
function crmFlushMarks_(state) {
  if (state.pending && state.pending.length) crmAppendMany_('log', state.pending);
  state.pending = [];
}

/* ============================ LINKS ============================ */
/* hn → [{lineUserId, consent}] (เฉพาะ active) รวมคนไข้จัดฟันที่ผูกไว้ในชีต ortho เดิม */
function crmLinkMap_(preLinks, preOrtho, preFollowers) {
  var map = {};
  // คนไข้ที่บล็อก/เลิกติดตาม OA → ไม่ส่งข้อความ (consent=false, blocked=true) จนกว่าจะเพิ่มเพื่อนกลับมา
  var blocked = {};
  try { (preFollowers || crmRead_('followers')).forEach(function (f) { if (f.status === 'unfollow' && f.lineUserId) blocked[f.lineUserId] = true; }); } catch (e) {}
  function add(hn, uid, consent, name) {
    var k = crmHN_(hn);
    if (!k || !uid) return;
    map[k] = map[k] || [];
    for (var i = 0; i < map[k].length; i++) if (map[k][i].lineUserId === uid) return;
    map[k].push({ lineUserId: uid, consent: consent && !blocked[uid], blocked: !!blocked[uid], patName: name || '' });
  }
  (preLinks || crmRead_('links')).forEach(function (l) {
    if (l.status === 'active') add(l.hn, l.lineUserId, String(l.consent).toUpperCase() !== 'FALSE', l.patName);
  });
  (preOrtho || crmReadByName_('ortho')).forEach(function (o) { if (o.lineUserId) add(o.hn, o.lineUserId, true, o['ชื่อ']); });
  return map;
}
/* HN ที่ผูก LINE แล้ว (เบา — ไม่ส่งชื่อ/เบอร์) cache ตามรุ่นข้อมูล CRM */
function crmLinkedJson_() {
  var c = CacheService.getScriptCache(), key = 'crm_lk_' + (c.get('crm_gen') || 'g0');
  var hit = c.get(key); if (hit) return hit;
  var map = crmLinkMap_(), hns = [], blocked = [];
  Object.keys(map).forEach(function (k) {
    var ok = map[k].some(function (x) { return !x.blocked; });
    (ok ? hns : blocked).push(k);
  });
  var out = JSON.stringify({ ok: true, hns: hns, blocked: blocked });
  try { c.put(key, out, 300); } catch (e) {}
  return out;
}
function crmUserHns_(uid) {
  var hns = [];
  crmRead_('links').forEach(function (l) { if (l.lineUserId === uid && l.status === 'active' && hns.indexOf(crmHN_(l.hn)) === -1) hns.push(crmHN_(l.hn)); });
  crmReadByName_('ortho').forEach(function (o) { if (o.lineUserId === uid && hns.indexOf(crmHN_(o.hn)) === -1) hns.push(crmHN_(o.hn)); });
  return hns;
}

/* ============================ TEMPLATES ============================ */
function crmOpt_(label, kind, reply) { return { label: label, kind: kind, reply: reply || '' }; }
var CRM_REPLY_OK = 'ดีจังเลยค่ะ 🌟 ขอบคุณที่ตอบกลับนะคะ ถ้ามีอาการอะไรเพิ่มเติม แจ้งคลินิกได้เสมอเลยค่ะ';
var CRM_REPLY_OK_OLD = 'ดีใจด้วยค่ะ 😊 ดูแลตามคำแนะนำต่อไปนะคะ';   // ข้อความเดิมที่บันทึกในแม่แบบเก่า → ใช้ข้อความใหม่แทนตอนตอบ (แก้เองในแท็บ Aftercare ก็ได้)
var CRM_REPLY_MILD = 'อาการปวดเล็กน้อยพบได้ในช่วง 1–3 วันแรก รับประทานยาตามที่ทันตแพทย์สั่ง และดูแลตามคำแนะนำค่ะ\nถ้าปวดมากขึ้นหรือไม่ดีขึ้น กดปุ่ม "ให้คลินิกโทรกลับ" ได้เลยค่ะ';
var CRM_REPLY_SEVERE = 'ขอบคุณที่แจ้งค่ะ 🙏 ส่งเรื่องให้ทีมคลินิกติดต่อกลับโดยเร็วแล้ว';
var CRM_REPLY_CALLBACK = 'รับเรื่องแล้วค่ะ 🙏 ทีมคลินิกจะโทรกลับในเวลาทำการ';

function crmSeedTemplates_() {
  var surgOpts = [crmOpt_('ปกติดี', 'ok', CRM_REPLY_OK), crmOpt_('ปวดเล็กน้อย', 'mild', CRM_REPLY_MILD), crmOpt_('ปวดมาก', 'severe', CRM_REPLY_SEVERE),
    crmOpt_('บวมมาก', 'severe', CRM_REPLY_SEVERE),
    crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var basicOpts = [crmOpt_('ปกติดี', 'ok', CRM_REPLY_OK), crmOpt_('เสียวฟัน/เจ็บเล็กน้อย', 'mild', 'อาการเสียวหรือเจ็บเล็กน้อยพบได้ในช่วงไม่กี่วันแรก และมักดีขึ้นเองค่ะ\nถ้าไม่ดีขึ้นหรือเป็นมากขึ้น กดปุ่ม "ให้คลินิกโทรกลับ" ได้เลยค่ะ'),
    crmOpt_('ปวดมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var endoOpts = [crmOpt_('ปกติดี', 'ok', CRM_REPLY_OK), crmOpt_('เจ็บเวลากัดเล็กน้อย', 'mild', 'อาการเจ็บเวลากัดเล็กน้อยพบได้ 2–3 วันหลังรักษารากฟันค่ะ เลี่ยงเคี้ยวด้านนั้นและรับประทานยาตามที่ทันตแพทย์สั่ง\nถ้าไม่ดีขึ้น กดปุ่ม "ให้คลินิกโทรกลับ" ได้เลยค่ะ'),
    crmOpt_('ปวดมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('บวม', 'severe', CRM_REPLY_SEVERE), crmOpt_('วัสดุอุดหลุด', 'callback', CRM_REPLY_CALLBACK),
    crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var dentureOpts = [crmOpt_('ใส่ได้ปกติ', 'ok', CRM_REPLY_OK), crmOpt_('เจ็บเหงือกเล็กน้อย', 'mild', 'ช่วงแรกอาจรู้สึกแน่นหรือเจ็บเหงือกเล็กน้อยได้ค่ะ\nถ้าเจ็บจนเป็นแผล อย่าแก้ฟันปลอมเอง กดปุ่ม "ให้คลินิกโทรกลับ" เพื่อนัดปรับได้เลยค่ะ'),
    crmOpt_('เป็นแผล/เจ็บมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('หลวม/หลุดบ่อย', 'callback', CRM_REPLY_CALLBACK), crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var crownOpts = [crmOpt_('ปกติดี', 'ok', CRM_REPLY_OK),
    crmOpt_('เสียวฟัน/เจ็บเล็กน้อย', 'mild', 'อาการเสียวหรือเจ็บเล็กน้อยพบได้ในช่วง 2–3 วันแรกหลังทำครอบฟัน/Onlay ค่ะ เลี่ยงของร้อนเย็นจัดและของแข็ง\nถ้าไม่ดีขึ้นหรือเป็นมากขึ้น กดปุ่ม "ให้คลินิกโทรกลับ" ได้เลยค่ะ'),
    crmOpt_('กัดแล้วรู้สึกสูง/ชนก่อน', 'callback', 'รับเรื่องแล้วค่ะ 🙏 ถ้ากัดแล้วรู้สึกสูงหรือไม่สบาย ทันตแพทย์ปรับให้ได้ ทีมคลินิกจะโทรกลับในเวลาทำการนะคะ'),
    crmOpt_('ครอบฟันชั่วคราวหลุด/ครอบหลุด', 'callback', 'รับเรื่องแล้วค่ะ 🙏 เก็บชิ้นที่หลุดไว้ให้ดี อย่าพยายามติดเอง ทีมคลินิกจะโทรกลับในเวลาทำการนะคะ'),
    crmOpt_('ปวดมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('บวม', 'severe', CRM_REPLY_SEVERE),
    crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var Q = 'สวัสดีค่ะ คุณ{name} 😊\nเมื่อวานคุณได้รับการ{proc} วันนี้อาการเป็นอย่างไรบ้างคะ?\nกดเลือกด้านล่างได้เลยค่ะ';
  var T = [
    { id: 'tpl_surgery', name: 'ผ่าฟันคุด', procKeywords: 'ผ่าฟันคุด', priority: 1, followupEnabled: 'TRUE', opts: surgOpts,
      text: 'คำแนะนำหลังผ่าฟันคุด 🦷\n1. กัดผ้าก๊อซให้แน่นประมาณ 1 ชั่วโมง แล้วคายทิ้ง ถ้ายังมีเลือดซึมให้กัดผ้าก๊อซสะอาดชิ้นใหม่อีก 30–60 นาที\n2. วันนี้ห้ามบ้วนน้ำ บ้วนปากแรง หรือดูดหลอด\n3. ประคบเย็นด้านนอกแก้ม ครั้งละ 10–15 นาที ในวันแรก อาการบวมมักมากที่สุดวันที่ 2–3 แล้วค่อย ๆ ยุบ\n4. รับประทานยาตามที่ทันตแพทย์สั่งให้ครบ\n5. ทานอาหารอ่อน ไม่ร้อนจัด เคี้ยวอีกด้าน งดสูบบุหรี่และแอลกอฮอล์\n6. อาจอ้าปากได้น้อยลงชั่วคราว\n7. มาตัดไหมตามนัด\nถ้าเลือดออกมากไม่หยุด ปวดหรือบวมมากขึ้นเรื่อย ๆ มีไข้ ให้ติดต่อคลินิกทันที' },
    { id: 'tpl_implant', name: 'รากฟันเทียม', procKeywords: 'รากฟันเทียม', priority: 2, followupEnabled: 'TRUE', opts: surgOpts,
      text: 'คำแนะนำหลังผ่าตัดฝังรากฟันเทียม 🦷\n1. กัดผ้าก๊อซให้แน่นประมาณ 1 ชั่วโมง\n2. วันนี้ห้ามบ้วนน้ำแรง ห้ามดูดหลอด\n3. ประคบเย็นด้านนอกแก้ม ครั้งละ 10–15 นาที ในวันแรก\n4. รับประทานยาตามที่ทันตแพทย์สั่งให้ครบ\n5. ทานอาหารอ่อน ห้ามเคี้ยวด้านที่ฝังราก งดสูบบุหรี่\n6. แปรงฟันได้ แต่บริเวณแผลให้ทำความสะอาดเบา ๆ\n7. มาตามนัดตัดไหมและตรวจติดตาม\nถ้าเลือดออกมากไม่หยุด ปวดหรือบวมมากขึ้น มีไข้ ให้ติดต่อคลินิกทันที' },
    { id: 'tpl_extraction', name: 'ถอนฟัน', procKeywords: 'ถอนฟัน', priority: 3, followupEnabled: 'TRUE', opts: surgOpts,
      text: 'คำแนะนำหลังถอนฟัน 🦷\n1. กัดผ้าก๊อซให้แน่นประมาณ 1 ชั่วโมง แล้วคายทิ้ง ถ้ายังมีเลือดซึมให้กัดชิ้นใหม่อีก 30–60 นาที\n2. วันนี้ห้ามบ้วนน้ำ บ้วนปากแรง หรือดูดหลอด เพื่อไม่ให้ลิ่มเลือดหลุด\n3. น้ำลายปนเลือดเล็กน้อยในวันแรกถือว่าปกติ\n4. ประคบเย็นด้านนอกแก้ม ครั้งละ 10–15 นาที ในวันแรก\n5. รับประทานยาตามที่ทันตแพทย์สั่ง\n6. ทานอาหารอ่อน ไม่ร้อนจัด เคี้ยวอีกด้าน งดสูบบุหรี่และแอลกอฮอล์อย่างน้อย 24 ชั่วโมง\n7. แปรงฟันได้ตามปกติ แต่เลี่ยงบริเวณแผลในวันแรก\nถ้าเลือดออกมากไม่หยุด ปวดหรือบวมมากขึ้น มีไข้ ให้ติดต่อคลินิกทันที' },
    { id: 'tpl_endo', name: 'รักษารากฟัน', procKeywords: 'รักษารากฟัน', priority: 4, followupEnabled: 'TRUE', opts: endoOpts,
      text: 'คำแนะนำหลังรักษารากฟัน 🦷\n1. ระหว่างรักษามีวัสดุอุดชั่วคราว ห้ามเคี้ยวของแข็งหรือเหนียวด้านนั้น\n2. อาจเจ็บเวลากัดได้ 2–3 วัน รับประทานยาตามที่ทันตแพทย์สั่ง\n3. แปรงฟันได้ตามปกติ\n4. มาตามนัดให้ครบทุกครั้ง การหยุดกลางคันทำให้ฟันติดเชื้อซ้ำได้\n5. หลังรักษาเสร็จ ฟันจะเปราะกว่าเดิม ทันตแพทย์มักแนะนำให้ทำครอบฟัน\nถ้าวัสดุอุดหลุด ปวดมาก หรือบวม ให้ติดต่อคลินิก' },
    { id: 'tpl_crown', name: 'ครอบฟัน / Onlay', procKeywords: 'ครอบฟัน,ใส่ครอบฟัน,onlay,crown', priority: 5, followupEnabled: 'TRUE', opts: crownOpts,
      text: 'คำแนะนำหลังทำครอบฟัน / Onlay 🦷\n1. กรณีฉีดยาชา ถ้ายังชาอยู่ (ประมาณ 2–3 ชั่วโมง) ระวังกัดแก้มหรือลิ้น และงดของร้อน\n2. อาจเสียวฟันหรือเหงือกระคายเล็กน้อยได้ 2–3 วันแรก\n3. ถ้าใส่ครอบฟันชั่วคราว ห้ามเคี้ยวของเหนียว/แข็งด้านนั้น และเวลาใช้ไหมขัดฟันให้ดึงออกทางด้านข้าง ห้ามดึงขึ้น เพราะอาจทำให้ครอบหลุด\n4. แปรงฟันและใช้ไหมขัดฟันรอบครอบฟันให้สะอาดทุกวัน\n5. ถ้ากัดแล้วรู้สึกสูง ชนก่อนซี่อื่น หรือปวดมาก ให้ติดต่อคลินิกเพื่อปรับ อย่ารอให้หายเอง\n6. ถ้าครอบฟันหรือครอบชั่วคราวหลุด เก็บไว้ให้ดีแล้วติดต่อคลินิก' },
    { id: 'tpl_filling', name: 'อุดฟัน', procKeywords: 'อุดฟัน,อุดชั่วคราว,อุดปิดช่องว่าง', priority: 5, followupEnabled: 'TRUE', opts: basicOpts,
      text: 'คำแนะนำหลังอุดฟัน 🦷\n1. กรณีฉีดยาชา ถ้ายังชาอยู่ (ประมาณ 2–3 ชั่วโมง) ระวังกัดแก้มหรือลิ้น และงดของร้อน\n2. อาจเสียวฟันเล็กน้อยได้ในช่วงไม่กี่วันแรก\n3. ถ้าเป็นการอุดชั่วคราว เลี่ยงเคี้ยวของแข็ง/เหนียวด้านนั้น และมาตามนัด\n4. ถ้ารู้สึกว่าฟันที่อุดสูง กัดแล้วชนก่อนซี่อื่น หรือปวดมาก ให้ติดต่อคลินิกเพื่อปรับ' },
    { id: 'tpl_scaling', name: 'ขูดหินปูน', procKeywords: 'ขูดหินปูน,เกลารากฟัน', priority: 6, followupEnabled: 'FALSE', opts: basicOpts,
      text: 'คำแนะนำหลังขูดหินปูน 🦷\n1. อาจเสียวฟันหรือเหงือกมีเลือดออกเล็กน้อย 1–2 วัน ถือว่าปกติ\n2. แปรงฟันเบา ๆ ด้วยแปรงขนนุ่ม ใช้ยาสีฟันลดอาการเสียวได้\n3. เลี่ยงอาหารร้อนจัดหรือเย็นจัดในช่วงแรก\n4. ใช้ไหมขัดฟันทุกวัน\n5. ควรตรวจและขูดหินปูนทุก 6 เดือน' },
    { id: 'tpl_denture', name: 'ฟันปลอม', procKeywords: 'RPD,Valplast,ใส่ฟัน,ฟันปลอม', priority: 7, followupEnabled: 'FALSE', opts: dentureOpts,
      text: 'คำแนะนำการใช้ฟันปลอม 🦷\n1. ช่วงแรกอาจรู้สึกแน่นหรือเจ็บเหงือกเล็กน้อย ค่อย ๆ ฝึกเคี้ยวอาหารอ่อนก่อน\n2. ถอดล้างหลังอาหารทุกครั้ง แปรงทำความสะอาดฟันปลอม\n3. ถอดก่อนนอน แช่ในน้ำสะอาด ห้ามใช้น้ำร้อน\n4. ถ้าเจ็บจนเป็นแผลหรือหลวม ห้ามแก้ไขเอง ให้นัดมาปรับที่คลินิก' },
    { id: 'tpl_ortho_bond', name: 'ติดเครื่องมือจัดฟัน', procKeywords: 'ติดเครื่องมือ', priority: 7, followupEnabled: 'FALSE', opts: basicOpts,
      text: 'คำแนะนำหลังติดเครื่องมือจัดฟัน 🦷\n1. อาจรู้สึกตึง เจ็บฟัน หรือเครื่องมือเสียดแก้ม 3–5 วันแรก ถือว่าปกติ ทานอาหารอ่อนในช่วงนี้ และทานยาแก้ปวดตามที่ทันตแพทย์แนะนำได้\n2. ใช้ขี้ผึ้งจัดฟันปิดส่วนที่เสียดแก้มหรือริมฝีปาก และบ้วนปากด้วยน้ำเกลืออุ่นช่วยให้แผลหายเร็ว\n3. งดอาหารแข็ง เหนียว และต้องกัดแทะ เช่น ลูกอม หมากฝรั่ง น้ำแข็ง ขนมกรอบ อ้อย ผลไม้ชิ้นใหญ่ให้หั่นเป็นชิ้นเล็กก่อนทาน เพื่อไม่ให้เครื่องมือหลุด\n4. แปรงฟันให้สะอาดหลังอาหารทุกมื้อและก่อนนอน ใช้แปรงซอกฟันหรือแปรงสำหรับคนจัดฟันช่วยทำความสะอาดรอบเครื่องมือ ฟันที่สะอาดช่วยลดฟันผุและเหงือกอักเสบ\n5. ถ้ามีเครื่องมือหลุด ลวดทิ่มจนเจ็บ หรือยางหลุดหาย ติดต่อคลินิกเพื่อนัดแก้ไขได้เลยค่ะ และมาตามนัดปรับเครื่องมือทุกครั้ง' },
    { id: 'tpl_ortho_adjust', name: 'ปรับเครื่องมือจัดฟัน', procKeywords: 'ปรับเครื่องมือ', priority: 8, followupEnabled: 'FALSE', opts: basicOpts,
      text: 'คำแนะนำหลังปรับเครื่องมือจัดฟัน 🦷\n1. อาจรู้สึกตึงหรือเจ็บฟัน 2–3 วันแรกหลังปรับ ถือว่าปกติ รับประทานอาหารอ่อนในช่วงนี้ และทานยาแก้ปวดตามที่ทันตแพทย์แนะนำได้\n2. แปรงฟันให้สะอาดหลังอาหารทุกมื้อ ใช้แปรงซอกฟันหรือไหมขัดฟันสำหรับคนจัดฟันช่วยทำความสะอาดรอบเครื่องมือ\n3. หลีกเลี่ยงอาหารแข็ง เหนียว หรือต้องกัดแทะ เช่น ลูกอม หมากฝรั่ง น้ำแข็ง เพราะอาจทำให้เครื่องมือหลุดหรือเสียหาย\n4. ถ้าลวดหรือเครื่องมือทิ่มแก้ม ใช้ขี้ผึ้งจัดฟันปิดไว้ชั่วคราว\n5. ถ้าเครื่องมือหลุด ลวดแทงจนเจ็บ หรือมียางหลุดหาย ติดต่อคลินิกเพื่อนัดแก้ไขได้เลยค่ะ' },
    { id: 'tpl_retainer_place', name: 'ใส่รีเทนเนอร์', procKeywords: 'ใส่รีเทนเนอร์', priority: 8, followupEnabled: 'FALSE', opts: basicOpts,
      text: 'คำแนะนำการใช้รีเทนเนอร์ 🦷\n1. ใส่รีเทนเนอร์ตามระยะเวลาที่ทันตแพทย์แนะนำอย่างสม่ำเสมอ เพื่อให้ฟันคงตำแหน่งที่จัดไว้\n2. ช่วงแรกอาจรู้สึกตึงหรือพูดไม่ชัดเล็กน้อย จะค่อย ๆ ชินภายใน 1–2 สัปดาห์\n3. ถอดทุกครั้งเมื่อรับประทานอาหาร แล้วเก็บในกล่องเสมอ ห้ามห่อกระดาษหรือวางทิ้งไว้ เพราะมักสูญหายหรือถูกทิ้ง\n4. ล้างด้วยแปรงสีฟันขนนุ่มและน้ำเย็น ห้ามใช้น้ำร้อนหรือวางใกล้ความร้อน เพราะอาจทำให้ผิดรูป\n5. ถ้ารีเทนเนอร์หลวม แตก หรือใส่ไม่เข้า ติดต่อคลินิกก่อนใส่ต่อค่ะ' },
    { id: 'tpl_retainer_check', name: 'เช็ครีเทนเนอร์', procKeywords: 'เช็ครีเทนเนอร์', priority: 8, followupEnabled: 'FALSE', opts: basicOpts,
      text: 'คำแนะนำหลังเช็ครีเทนเนอร์ 🦷\n1. ใส่รีเทนเนอร์ต่อเนื่องตามที่ทันตแพทย์แนะนำ ฟันจึงจะคงตำแหน่งสวยได้ในระยะยาว\n2. ทำความสะอาดรีเทนเนอร์ทุกวันด้วยแปรงขนนุ่มและน้ำเย็น และเก็บในกล่องเมื่อไม่ได้ใส่\n3. ถ้ารีเทนเนอร์หลวม แตก หาย หรือใส่ไม่เข้า อย่าฝืนใส่ ติดต่อคลินิกเพื่อนัดตรวจได้เลยค่ะ\n4. ควรมาตรวจฟันและรีเทนเนอร์ตามนัดเป็นระยะ' },
  ];
  var existing = crmRead_('templates');
  // ย้าย onlay ออกจากแม่แบบอุดฟันเดิม (ที่ยังเป็นค่าเริ่มต้น) ไปอยู่กลุ่มครอบฟัน/Onlay — กันคำแนะนำสองชุดซ้อนกัน
  existing.forEach(function (e) {
    if (e.id === 'tpl_filling' && String(e.procKeywords) === 'อุดฟัน,อุดชั่วคราว,onlay,อุดปิดช่องว่าง') {
      try { crmUpdate_('templates', e._row, { procKeywords: 'อุดฟัน,อุดชั่วคราว,อุดปิดช่องว่าง' }); } catch (e2) {}
    }
  });
  existing.forEach(function (e) {   // แม่แบบอุดฟันเดิมที่ยังเป็นข้อความเริ่มต้น → แก้ข้อ 1 เป็น "กรณีฉีดยาชา ..."
    if (e.id === 'tpl_filling' && String(e.aftercareText).indexOf('\n1. ถ้ายังชาอยู่ (ประมาณ 2–3 ชั่วโมง)') >= 0) {
      try { crmUpdate_('templates', e._row, { aftercareText: String(e.aftercareText).replace('\n1. ถ้ายังชาอยู่ (ประมาณ 2–3 ชั่วโมง)', '\n1. กรณีฉีดยาชา ถ้ายังชาอยู่ (ประมาณ 2–3 ชั่วโมง)') }); } catch (e3) {}
    }
  });
  try {   // ครั้งเดียว: เปิดติดตามอาการวันถัดไปของแม่แบบอุดฟันเดิม (ขูดหินปูนยังปิด) — หลังจากนั้นปิด/เปิดเองในแท็บ Aftercare ได้ ไม่ถูกทับอีก
    var pr = PropertiesService.getScriptProperties();
    if (!pr.getProperty('CRM_FILLING_FU_ON')) {
      existing.forEach(function (e) { if (e.id === 'tpl_filling' && String(e.followupEnabled).toUpperCase() !== 'TRUE') crmUpdate_('templates', e._row, { followupEnabled: 'TRUE' }); });
      pr.setProperty('CRM_FILLING_FU_ON', '1');
    }
  } catch (e4) {}
  var add = [];
  T.forEach(function (t) {
    if (crmFind_(existing, 'id', t.id)) return;
    add.push({ id: t.id, name: t.name, procKeywords: t.procKeywords, priority: t.priority, aftercareText: t.text,
      followupEnabled: t.followupEnabled, followupQuestion: Q, followupOptions: JSON.stringify(t.opts),
      status: 'draft', version: 1, approvedBy: '', approvedAt: '', updatedBy: 'ระบบ (ร่างเริ่มต้น)', updatedAt: crmNow_() });
  });
  crmAppendMany_('templates', add);
  return add.length;
}
function crmTemplatesFor_(proc, templates) {
  var items = crmProcItems_(proc), out = [];
  templates.forEach(function (t) {
    if (t.status !== 'approved') return;
    var kws = crmSplitList_(t.procKeywords);
    var hit = items.some(function (it) { return kws.some(function (k) { return it.toLowerCase().indexOf(k.toLowerCase()) !== -1; }); });
    if (hit) out.push(t);
  });
  out.sort(function (a, b) { return (+a.priority || 99) - (+b.priority || 99); });
  return out;
}

/* ============================ MESSAGE BUILDERS ============================ */
function crmRow_(k, v) {
  return { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
    { type: 'text', text: String(k || '\u3000'), color: '#83627C', size: 'sm', flex: 2 },
    { type: 'text', text: String(v || '-'), wrap: true, color: '#1A0A17', size: 'sm', flex: 5, weight: 'bold' }] };
}
function crmBubble_(s, title, subtitle, bodyRows, buttons, accent) {
  var bubble = { type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: accent || '#6B2D5E', paddingAll: '16px', contents: [
      { type: 'text', text: s.clinicName, color: '#F0C96B', size: 'xs', weight: 'bold' },
      { type: 'text', text: title, color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true }] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [] } };
  if (subtitle) bubble.body.contents.push({ type: 'text', text: subtitle, wrap: true, size: 'sm', color: '#4A3347' });
  if (bodyRows && bodyRows.length) bubble.body.contents.push({ type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyRows });
  if (buttons && buttons.length) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'xl', contents: buttons };
  return bubble;
}
/* ข้อความบอกช่องทางสอบถาม — เป็นข้อความธรรมดา ไม่ใช่ปุ่ม ไม่มีลิงก์ */
function crmInquiryNote_(s) { return { type: 'text', text: 'สอบถามเพิ่มเติม\nโทร. ' + String((s && s.clinicPhone) || '0959476759').replace(/[^0-9]/g, '') + '\nพิมพ์ในแชทนี้ได้เลยค่ะ', wrap: true, size: 'sm', color: '#6B2D5E', align: 'center', margin: 'md' }; }
function crmTelUri_(s) { return 'tel:' + String(s.clinicPhone || '').replace(/[^0-9+]/g, ''); }
/* ปุ่มขอเลื่อนนัด = ส่งข้อความจริงเข้าแชท (เด้งเตือนใน LINE OA Manager) เช่น "ขอเลื่อนนัด 12/11" · วัน/เดือนใช้จับคู่นัด */
function crmReschedText_(date, word) {
  var d = crmDateOnly_(date);
  return (word || 'ขอเลื่อนนัด') + (d ? ' ' + parseInt(d.slice(8, 10), 10) + '/' + parseInt(d.slice(5, 7), 10) : '');
}
// นัดเดิมที่ถูกเลื่อน: (ก) นัดในตารางนัด id เดิม เปลี่ยนวัน/เวลา (ข) นัดจัดฟันจากการ์ด — วันเก่าส่งยืนยันไปแล้ว แต่ตอนนี้ไม่มีแล้ว (curIds = id ของนัดทั้งหมดที่มีตอนนี้) · ไม่พบ = null
function crmMoveInfo_(s, state, a, curIds) {
  var best = null, bestAt = '', prefix = crmKey_(s, 'confirm:' + a.id + ':'), ck = crmKey_(s, 'confirm:' + a.id + ':' + a.date + ':' + (a.time || ''));
  var hk = crmHN_(a.hn), today = crmToday_();
  for (var k in state.done) {
    var lr = state.done[k]; if (!lr) continue;
    var at = String(lr.createdAt || ''), od = '', ot = '';
    if (k.indexOf(prefix) === 0 && k.indexOf(ck) !== 0) {
      var m1 = k.slice(prefix.length).split('>')[0].match(/^(\d{4}-\d{2}-\d{2}):(.*)$/);
      if (m1) { od = m1[1]; ot = m1[2]; }
    } else if (a._ortho && lr.type === 'confirm' && (lr.status === 'sent' || lr.status === 'test')) {
      var m2 = String(lr.refId || '').match(/^ORTHO-(.+)-(\d{4}-\d{2}-\d{2})$/);
      if (m2 && crmHN_(m2[1]) === hk && m2[2] !== a.date && m2[2] >= today && !curIds[lr.refId]) { od = m2[2]; ot = String(lr.detail || '').split(' ')[1] || ''; }
    }
    if (od && at >= bestAt) { best = { date: od, time: ot }; bestAt = at; }
  }
  return best;
}
function crmAptMessage_(s, apt, kind, mv) {
  // mv = { date, time } นัดเดิมที่ถูกเลื่อน (kind 'move') — บอกคนไข้ชัดเจนว่าเลื่อนจากวันไหนเป็นวันไหน และนัดเดิมถูกยกเลิกแล้ว
  var sameDay = !!(mv && mv.date === apt.date);
  var title = kind === 'remind' ? '🔔 เตือนนัดหมาย' : (kind === 'move' ? (sameDay ? '🔄 เปลี่ยนเวลานัดหมาย' : '🔄 เลื่อนนัดหมายแล้ว') : (kind === 'change' ? '🔄 นัดหมายมีการเปลี่ยนแปลง' : '📅 ใบนัด'));
  var sub = 'คุณ' + (apt.patName || '') + (kind === 'remind' ? ' อย่าลืมนัดหมายของคุณนะคะ' : (kind === 'move' ? ' คลินิกได้' + (sameDay ? 'เปลี่ยนเวลา' : 'เลื่อน') + 'นัดหมายของคุณให้แล้วค่ะ' : ' คลินิกได้บันทึกนัดหมายของคุณแล้วค่ะ'));
  var rows = [];
  if (kind === 'move' && mv) rows.push(crmRow_('นัดเดิม', (sameDay ? '' : crmThaiDate_(mv.date) + ' ') + (mv.time ? mv.time + ' น. ' : '') + '(ยกเลิกแล้ว)'));
  rows.push(crmRow_(kind === 'move' ? 'นัดใหม่' : 'วัน', crmThaiDate_(apt.date)), crmRow_('เวลา', (apt.time || '-') + ' น.'));
  if (apt.docName) rows.push(crmRow_('ทันตแพทย์', apt.docName));
  if (apt.proc) rows.push(crmRow_('รายการ', apt.proc));
  var buttons = [];
  // ปุ่มยืนยันนัดมีเฉพาะข้อความเตือนนัด (ข้อความยืนยัน/เปลี่ยนนัดตอนลงนัดไม่มีปุ่มนี้)
  if (kind === 'remind') buttons.push({ type: 'button', style: 'primary', color: '#6B2D5E', height: 'md', action: { type: 'message', label: '✅ ยืนยันนัด', text: crmReschedText_(apt.date, 'ยืนยันนัด') } });
  buttons.push({ type: 'button', style: 'secondary', height: 'md', action: { type: 'message', label: '🔄 ขอเลื่อนนัด', text: crmReschedText_(apt.date) } });
  buttons.push(crmInquiryNote_(s));
  return { type: 'flex', altText: title.replace(/^\S+\s/, '') + ' ' + crmThaiDate_(apt.date) + ' ' + (apt.time || '') + ' น.',
    contents: crmBubble_(s, title, sub, rows, buttons) };
}
// เตือนนัดหลายนัดในวันเดียวกัน (คนไข้คนเดียว) ในการ์ดเดียว · ปุ่มยืนยัน/เลื่อนนัดใช้กับทุกนัดในการ์ด (ids คั่นด้วย ,)
function crmAptGroupMessage_(s, list) {
  var a0 = list[0], ids = list.map(function (a) { return a.id; }).join(',');
  var rows = [crmRow_('วัน', crmThaiDate_(a0.date))];
  list.forEach(function (a, i) {
    rows.push(crmRow_((i + 1) + '. ' + String(a.time || '-').replace(':', '.') + ' น.', [a.proc, a.docName].filter(Boolean).join('\n')));
  });
  var buttons = [
    { type: 'button', style: 'primary', color: '#6B2D5E', height: 'md', action: { type: 'message', label: '✅ ยืนยันนัด', text: crmReschedText_(a0.date, 'ยืนยันนัด') } },
    { type: 'button', style: 'secondary', height: 'md', action: { type: 'message', label: '🔄 ขอเลื่อนนัด', text: crmReschedText_(a0.date) } },
    crmInquiryNote_(s)];
  return { type: 'flex', altText: 'เตือนนัดหมาย ' + crmThaiDate_(a0.date) + ' ' + list.length + ' นัด',
    contents: crmBubble_(s, '🔔 เตือนนัดหมาย', 'คุณ' + (a0.patName || '') + ' อย่าลืมนัดหมายของคุณนะคะ (' + list.length + ' นัดในวันเดียวกัน)', rows, buttons) };
}
function crmMoney_(n) { return '฿' + String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// สรุปการรักษา + ค่าใช้จ่าย + ขอบคุณ (+ คำแนะนำหลังรักษาในการ์ดเดียวกัน ถ้ามี template ที่อนุมัติแล้ว)
// trs = รายการรักษา (อันเดียวหรือ array) · extra = { tpls: [...], notes: [...] } (ไม่บังคับ)
function crmTreatAmt_(t) { return (+t.cash || 0) + (+t.transfer || 0) + (+t.sso || 0); }
function crmReceiptMessage_(s, trs, extra) {
  var list = Object.prototype.toString.call(trs) === '[object Array]' ? trs : [trs];
  var t0 = list[0] || {};
  var cash = 0, tr = 0, sso = 0, docs = [];
  list.forEach(function (t) { cash += +t.cash || 0; tr += +t.transfer || 0; sso += +t.sso || 0; if (t.docName && docs.indexOf(t.docName) === -1) docs.push(t.docName); });
  var total = cash + tr + sso;
  var rows = [crmRow_('วัน', crmThaiDate_(crmDateOnly_(t0.date)))];
  if (docs.length) rows.push(crmRow_('ทันตแพทย์', docs.join(', ')));
  // รายการรักษา: ถ้ามีราคาแยกรายการ (procPrices) แสดงราคาต่อรายการ · ไม่มีก็แสดงชื่ออย่างเดียว
  var items = [], anyPrice = false;
  list.forEach(function (t) {
    var procs = crmSplitList_(String(t.proc || '')), pp = {};
    try { pp = JSON.parse(t.procPrices || '{}') || {}; } catch (e) { pp = {}; }
    var recTotal = (+t.cash || 0) + (+t.transfer || 0) + (+t.sso || 0);
    if (!procs.length) procs = ['-'];
    var tm = {}, tp = {};
    try { tm = JSON.parse(t.procTeeth || '{}') || {}; } catch (e) { tm = {}; }
    try { tp = JSON.parse(t.toothPrices || '{}') || {}; } catch (e) { tp = {}; }
    procs.forEach(function (pr) {
      var teeth = String(tm[pr] || '').trim(), perTooth = tp[pr] || null;
      if (perTooth && Object.keys(perTooth).length) {            // หลายซี่ → แยกรายการต่อซี่ พร้อมราคา
        Object.keys(perTooth).sort(function (a, b) { return a - b; }).forEach(function (n) {
          anyPrice = true; items.push({ proc: pr + ' ซี่ ' + n, price: +perTooth[n] || 0 });
        });
        return;
      }
      var price = +pp[pr] > 0 ? +pp[pr] : (procs.length === 1 && list.length > 1 && recTotal > 0 ? recTotal : null);
      if (price !== null) anyPrice = true;
      items.push({ proc: pr + (teeth ? ' (ซี่ ' + teeth + ')' : ''), price: price });
    });
  });
  if (items.length === 1 || !anyPrice) {
    if (list.length === 1) rows.push(crmRow_('การรักษา', items.map(function (x) { return x.proc; }).join(', ') || '-'));
    else list.forEach(function (t, i) {
      var tm2 = {}; try { tm2 = JSON.parse(t.procTeeth || '{}') || {}; } catch (e) { tm2 = {}; }
      var txt = crmSplitList_(String(t.proc || '')).map(function (pr) { return pr + (tm2[pr] ? ' (ซี่ ' + tm2[pr] + ')' : ''); }).join(', ');
      rows.push(crmRow_(i === 0 ? 'การรักษา' : '', (i + 1) + '. ' + (txt || '-')));
    });
  } else {
    items.forEach(function (x, i) { rows.push(crmRow_(i === 0 ? 'การรักษา' : '', (i + 1) + '. ' + x.proc + (x.price !== null ? ' — ' + crmMoney_(x.price) : ''))); });
  }
  if (total > 0) {
    rows.push(crmRow_('ค่าใช้จ่าย', crmMoney_(total)));
    var parts = [];
    if (cash > 0) parts.push(['เงินสด', cash]); if (tr > 0) parts.push(['โอนเงิน', tr]); if (sso > 0) parts.push(['ประกันสังคม', sso]);
    if (parts.length > 1) parts.forEach(function (x) { rows.push(crmRow_('  ' + x[0], crmMoney_(x[1]))); });
    else if (parts.length === 1 && parts[0][0] !== 'เงินสด') rows.push(crmRow_('ชำระโดย', parts[0][0]));
  } else rows.push(crmRow_('ค่าใช้จ่าย', 'ไม่มีค่าใช้จ่าย'));
  var tpls = (extra && extra.tpls) || [], notes = (extra && extra.notes) || [];
  var hasAfter = tpls.length || notes.length;
  if (hasAfter) {
    rows.push({ type: 'separator', margin: 'md' });
    rows.push({ type: 'text', text: '🩹 คำแนะนำหลังการรักษา', weight: 'bold', size: 'md', color: '#6B2D5E', margin: 'md' });
    tpls.forEach(function (tp) { var tx = String(tp.aftercareText || '').trim(); if (tx) rows.push({ type: 'text', text: tx, wrap: true, size: 'sm', color: '#1A0A17', margin: 'md' }); });
    if (notes.length) rows.push({ type: 'text', text: '📝 คำแนะนำเพิ่มเติมจากทันตแพทย์\n' + notes.map(function (n) { return '• ' + n.text; }).join('\n'), wrap: true, size: 'sm', color: '#1A0A17', margin: 'md' });
    rows.push({ type: 'text', text: 'มีข้อสงสัยโทร ' + s.clinicPhone + ' หรือพิมพ์ทักในแชทนี้ได้เลยค่ะ', wrap: true, size: 'xs', color: '#83627C', margin: 'md' });
  }
  var corrected = !!(extra && extra.corrected);
  var sub = corrected ? ('คุณ' + (t0.patName || '') + '\nขออภัยในความคลาดเคลื่อนค่ะ คลินิกขอแก้ไขข้อมูลค่าใช้จ่ายดังนี้') : ('คุณ' + (t0.patName || '') + '\nขอบคุณที่ไว้วางใจให้' + s.clinicName + 'ดูรอยยิ้มของคุณค่ะ☺️');
  var buttons = [crmInquiryNote_(s)];
  return { type: 'flex', altText: 'สรุปการรักษา' + (total > 0 ? ' ' + crmMoney_(total) : '') + (hasAfter ? ' และคำแนะนำหลังรักษา' : '') + ' ขอบคุณที่มาใช้บริการค่ะ',
    contents: crmBubble_(s, corrected ? '🧾 แก้ไขสรุปค่าใช้จ่าย' : (hasAfter ? '🧾 สรุปการรักษา & คำแนะนำ' : '🧾 สรุปการรักษา'), sub, rows, buttons, '#1D825C') };
}
function crmAftercareMessages_(s, patName, date, tpls, notes) {
  var parts = ['คุณ' + (patName || '') + ' ขอบคุณที่มาใช้บริการ' + s.clinicName + 'ค่ะ 🙏\nคำแนะนำหลังการรักษา' + (date === crmToday_() ? 'วันนี้' : '') + ' (' + crmThaiDate_(date) + ')'];
  tpls.forEach(function (t) { parts.push(String(t.aftercareText || '').trim()); });
  if (notes && notes.length) parts.push('📝 คำแนะนำเพิ่มเติมจากทันตแพทย์\n' + notes.map(function (n) { return '• ' + n.text; }).join('\n'));
  parts.push('มีข้อสงสัยโทร ' + s.clinicPhone + ' หรือพิมพ์ทักในแชทนี้ได้เลยค่ะ');
  var msgs = [], cur = '';
  parts.forEach(function (p) {
    if ((cur + '\n\n' + p).length > 4800 && cur) { msgs.push(crmText_(cur)); cur = p; }
    else cur = cur ? (cur + '\n\n' + p) : p;
  });
  if (cur) msgs.push(crmText_(cur));
  return msgs.slice(0, 4);
}
/* กติกาว่าหมอคนไหน "เด้งไปหน้ารีวิว" ได้เฉพาะเทมเพลตไหน — s.reviewDocRules = 'สรวิศ=tpl_extraction,tpl_surgery;อีกคน=tpl_x'
   docNames = ชื่อหมอของรายการรักษาที่ทำให้เกิดข้อความถามอาการนี้ · หมอที่ชื่อไม่ตรงกติกาข้อไหน = ไม่เด้งไปรีวิว */
function crmReviewAllowed_(s, docNames, tplId) {
  var rules = String(s.reviewDocRules || '').split(';').map(function (x) { return x.trim(); }).filter(String);
  if (!rules.length) return true;   // ไม่ตั้งกติกา = ไม่จำกัด
  var ok = false;
  rules.forEach(function (r) {
    var i = r.indexOf('='); if (i < 1) return;
    var key = r.slice(0, i).trim(), allow = crmSplitList_(r.slice(i + 1));
    var hit = (docNames || []).some(function (d) { return String(d || '').indexOf(key) !== -1; });
    if (hit && allow.indexOf(String(tplId)) !== -1) ok = true;
  });
  return ok;   // หมอที่ไม่อยู่ในกติกา = ไม่เด้งไปรีวิว
}
var CRM_HIDDEN_OPT_LABELS_ = ['เลือดออกไม่หยุด', 'หายใจ/กลืนลำบาก'];   // ไม่แสดงเป็นปุ่มในการ์ดติดตามอาการ (คนไข้ยังพิมพ์แจ้งเองได้ — ระบบจับคำฉุกเฉินจากข้อความเหมือนเดิม)
function crmFollowupMessage_(s, fu, tpl, patName, procText, docOk) {
  var opts = [];
  try { opts = JSON.parse(tpl.followupOptions || '[]'); } catch (e) {}
  var q = String(tpl.followupQuestion || '').replace(/\{name\}/g, patName || '').replace(/\{proc\}/g, procText || tpl.name);
  var okReview = false;   // ปุ่ม "ปกติดี" เปิดหน้ารีวิวทันที: ต้องเปิดตัวเลือก + มีลิงก์รีวิว + ไม่ใช้โหมดถามคะแนน + คนไข้ยังไม่ถูกขอรีวิวใน 360 วัน
  try {
    if (docOk !== false && s.reviewOnOk === true && /^https:\/\//i.test(String(s.reviewUrl || '').trim()) && !crmRatingApplies_(s, fu)) {
      var since0 = crmAddDays_(crmToday_(), -360), hk0 = crmHN_(fu.hn);
      okReview = !crmRead_('followups').some(function (r) { return crmHN_(r.hn) === hk0 && r.reviewAt && String(r.reviewAt).slice(0, 10) > since0; });
    }
  } catch (eOk) { okReview = false; }
  var buttons = opts.slice(0, 9).map(function (o, i) { return { o: o, i: i }; }).filter(function (x) {
    return CRM_HIDDEN_OPT_LABELS_.indexOf(String(x.o.label || '').replace(/\s+/g, '')) === -1;   // ซ่อนปุ่มเลือดออก/หายใจลำบาก (เก็บ index เดิมไว้ให้ postback ตรงกับตัวเลือกในแม่แบบ)
  }).map(function (x) {
    var o = x.o, i = x.i, em = o.kind === 'emergency', sev = o.kind === 'severe';
    return { type: 'button', height: 'sm', style: em ? 'primary' : (o.kind === 'ok' ? 'primary' : 'secondary'),
      color: em ? '#C0392B' : (o.kind === 'ok' ? '#1D825C' : (sev ? '#F5D7DB' : undefined)),
      action: (o.kind === 'ok' && okReview)   // ปกติดี → เด้งไปหน้ารีวิว Google ทันที (ผ่านหน้า rate.html ที่บันทึกคำตอบก่อน)
        ? { type: 'uri', label: String(o.label).slice(0, 20), uri: crmRateUrl_(fu.id) + '&kind=ok' }
        : { type: 'postback', label: String(o.label).slice(0, 20), data: 'fu|' + fu.id + '|' + i, displayText: String(o.label) } };
  });
  buttons.forEach(function (b) { if (b.color === undefined) delete b.color; });
  return { type: 'flex', altText: 'ติดตามอาการหลังการรักษา', contents: crmBubble_(s, '🩺 ติดตามอาการ', q, [], buttons) };
}
function crmNextAptText_(hn, apts, fromDate) {
  var k = crmHN_(hn), today = fromDate || crmToday_();
  var next = apts.filter(function (a) {
    return crmHN_(a.hn) === k && crmDateOnly_(a.date) > today && ['ยกเลิก', 'เสร็จสิ้น', 'เสร็จ'].indexOf(a.status) === -1;
  }).sort(function (a, b) { return (crmDateOnly_(a.date) + (a.time || '')).localeCompare(crmDateOnly_(b.date) + (b.time || '')); })[0];
  if (!next) return '';
  return '\n\n📅 นัดครั้งถัดไปของคุณ: ' + crmThaiDate_(crmDateOnly_(next.date)) + ' เวลา ' + (next.time || '-') + ' น.' + (next.proc ? ' (' + next.proc + ')' : '');
}

/* ============================ MAIN TICK (trigger ทุก 10 นาที) ============================ */
function crmTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, error: 'busy' };
  try {
    // ย้าย log เก่าไปชีต archive วันละครั้ง (ทำแม้ระบบปิดอยู่) — กันชีต log โตจนรอบส่งช้า/หมดเวลา
    try {
      var props = PropertiesService.getScriptProperties(), td = crmToday_();
      if (props.getProperty('CRM_LOG_ARCHIVED_AT') !== td) { crmArchiveLog_(90); props.setProperty('CRM_LOG_ARCHIVED_AT', td); }
    } catch (ea) {}
    return crmTickInner_();
  }
  finally { lock.releaseLock(); }
}
/* ส่งข้อความยืนยันนัดเฉพาะคนไข้ 1 คนทันที (ใช้หลังพนักงานลงนัด) — เร็วกว่า crmTick ทั้งรอบมาก
   เพราะไม่อ่านชีตบันทึกการรักษาทั้งชีต/ติดตามอาการ/เตือนนัด และไม่เรียก API โควต้า (ใช้ค่าโควต้าที่แคชไว้) · กุญแจกันส่งซ้ำชุดเดียวกับ crmTickInner_ */
function crmConfirmOne_(hn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: false, error: 'busy' };
  try {
    var s = crmSettings_(), summary = { confirm: 0, skipped: [] };
    if (!s.enabled) { summary.skipped.push('disabled'); return summary; }
    if (s.testMode && !s.testUserId) { summary.skipped.push('no_test_user'); return summary; }
    if (!s.confirmOn) { summary.skipped.push('confirm_off'); return summary; }
    var hm = crmHM_(), today = crmToday_();
    if (hm < s.sendStart || hm >= s.sendEnd) { summary.skipped.push('outside_window'); return summary; }
    var k = crmHN_(hn); if (!k) { summary.skipped.push('no_hn'); return summary; }
    var budget = 20;   // บัญชีรายเดือน — ไม่หยุดส่งตามโควตาแล้ว (budget = เพดานต่อรอบเท่านั้น)
    var links = crmLinkMap_();
    var tg = (links[k] || []).filter(function (x) { return x.consent; });
    if (!tg.length) { summary.skipped.push('no_line'); return summary; }
    var hnSet = {}; hnSet[k] = true;
    var orthoAll = crmReadByName_('ortho').filter(function (o) { return crmHN_(o.hn) === k; });
    var apts = crmAptsWithOrtho_(crmReadByNameWhere_('ตารางนัด', crmHnTest_(hnSet)), orthoAll);
    var state = crmLogKeys_(); state.pushBudget = budget;
    var closed = ['ยกเลิก', 'เสร็จสิ้น', 'เสร็จ', 'walk-in'], curIds1 = {};
    apts.forEach(function (a) { if (a.id) curIds1[a.id] = true; });
    apts.forEach(function (a) {
      a.date = crmDateOnly_(a.date);
      if (!a.id || !a.date || a.date < today || closed.indexOf(a.status) !== -1) return;
      if (a.date === today && a.time && a.time <= hm) return;
      var ck = crmKey_(s, 'confirm:' + a.id + ':' + a.date + ':' + (a.time || ''));
      if (crmIsDone_(state, ck)) return;
      var prefix = crmKey_(s, 'confirm:' + a.id + ':'), changed = false;
      for (var kk in state.done) if (kk.indexOf(prefix) === 0 && kk.indexOf(ck) !== 0) { changed = true; break; }
      var mvI = crmMoveInfo_(s, state, a, curIds1);
      tg.forEach(function (t) {
        if (crmSend_(s, state, { key: ck + '>' + t.lineUserId, type: 'confirm', hn: a.hn, patName: a.patName, lineUserId: t.lineUserId, refId: a.id, detail: a.date + ' ' + (a.time || '') },
          [crmAptMessage_(s, a, mvI ? 'move' : (changed ? 'change' : 'confirm'), mvI)])) summary.confirm++;
      });
      if (crmAllDone_(state, ck, tg)) crmMark_(state, ck, 'confirm', { hn: a.hn, patName: a.patName, refId: a.id }, 'done', '');
    });
    crmFlushMarks_(state);
    return summary;
  } finally { lock.releaseLock(); }
}
/* ย้ายแถว crm_log ที่เก่ากว่า keepDays วันไปชีต crm_log_archive · เก็บสถิติรายเดือนของแถวที่ย้ายไว้ใน Script Properties (CRM_LOG_STATS) ให้ dashboard ยังเห็นครบ
   ยกเว้น: แถว "ยืนยันนัด" ของนัดที่ยังไม่ถึงวัน (ต้องใช้กันส่งยืนยันซ้ำ) */
function crmArchiveLog_(keepDays) {
  var sh = crmSheet_('log'), last = sh.getLastRow();
  if (last < 2) return 0;
  var lastCol = sh.getLastColumn(), vals = sh.getRange(1, 1, last, lastCol).getValues(), hdr = vals[0];
  var ci = crmColIdx_(hdr, ['createdAt']), si = crmColIdx_(hdr, ['status']), ti = crmColIdx_(hdr, ['type']), pi = crmColIdx_(hdr, ['pushCount']), ki = crmColIdx_(hdr, ['key']);
  if (ci < 0) return 0;
  var today = crmToday_(), cutoff = crmAddDays_(today, -(+keepDays || 90));
  var keep = [], move = [], stats = {};
  try { stats = JSON.parse(crmProp_('CRM_LOG_STATS', '{}')) || {}; } catch (e) { stats = {}; }
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r], ca = crmCell_(row[ci], 'createdAt'), d = String(ca).slice(0, 10);
    var isBlank = row.every(function (v) { return v === '' || v === null; });
    if (isBlank) continue;
    var old = /^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff;
    if (old && ki >= 0) {
      var m = String(row[ki] || '').match(/confirm:.+:(\d{4}-\d{2}-\d{2}):/);
      if (m && m[1] >= today) old = false;
    }
    if (!old) { keep.push(row); continue; }
    move.push(row);
    var st = String(row[si] || ''), mo = d.slice(0, 7);
    if (st === 'sent' || st === 'test' || st === 'failed') {
      stats[mo] = stats[mo] || { sent: 0, test: 0, failed: 0, byType: {} };
      stats[mo][st] += (st === 'failed') ? 1 : (+row[pi] || 0);
      if (st === 'sent') stats[mo].byType[row[ti]] = (stats[mo].byType[row[ti]] || 0) + (+row[pi] || 0);
    }
  }
  if (!move.length) return 0;
  var ss = SpreadsheetApp.getActiveSpreadsheet(), ar = ss.getSheetByName('crm_log_archive');
  if (!ar) { ar = ss.insertSheet('crm_log_archive'); ar.getRange(1, 1, 1, lastCol).setValues([hdr]); }
  ar.getRange(ar.getLastRow() + 1, 1, move.length, lastCol).setValues(move);
  var blank = []; for (var c = 0; c < lastCol; c++) blank.push('');
  var out = keep.slice(); while (out.length < last - 1) out.push(blank.slice());
  sh.getRange(2, 1, last - 1, lastCol).setValues(out);
  PropertiesService.getScriptProperties().setProperty('CRM_LOG_STATS', JSON.stringify(stats));
  return move.length;
}
// นัดจัดฟัน (เก็บในการ์ดจัดฟัน คอลัมน์ นัดถัดไป) → แปลงเป็นแถวนัดเสมือน (id = ORTHO-<HN>-<วันที่นัด> วันนัดใหม่ = นัดใหม่) รวมกับตารางนัด
// เพื่อให้ได้ข้อความยืนยัน/เปลี่ยนนัด/เตือนนัด + ปุ่มขอเลื่อนเหมือนนัดทั่วไป · ถ้ามีนัดในตารางนัดวันเดียวกัน (เวลาตรง หรือฝั่งใดไม่ระบุเวลา) ถือว่าซ้ำ ใช้แถวของตารางนัด ไม่สร้างเสมือน
// หมอคนเดียวกัน? (ตัดคำนำหน้า/ช่องว่าง) — ใช้ตัดสินว่านัดในตารางนัดซ้ำกับนัดจัดฟันในการ์ดหรือไม่ · หมอคนละคนในวัน+เวลาเดียวกัน = คนละนัด (เช่น หมอจัดฟัน + หมออื่นขูดหินปูน)
function crmSameDoc_(a, b) {
  var f = function (v) { return String(v || '').replace(/\s+/g, '').replace(/^(ทพญ\.|ทพ\.|หมอ)/, ''); };
  var x = f(a), y = f(b);
  return !x || !y || x === y;
}
function crmAptsWithOrtho_(apts, orthoRows) {
  var closedSt = ['ยกเลิก', 'เสร็จสิ้น', 'เสร็จ', 'walk-in'];
  var out = apts.slice();
  (orthoRows || []).forEach(function (o) {
    if (o['สถานะ'] && o['สถานะ'] !== 'กำลังจัด') return;
    var k = crmHN_(o.hn), d = crmDateOnly_(o['นัดถัดไป']);
    if (!k || !d) return;
    var tm = String(o['นัดถัดไปเวลา'] || '').trim().slice(0, 5);
    // ซ้ำกับนัดในตารางนัด (ทุกสถานะ: ยกเลิก/เสร็จแล้วก็ถือว่าตารางนัดเป็นตัวจริง) → ไม่สร้างนัดเสมือน
    // กันส่ง LINE ยืนยัน/เตือนนัดที่ยกเลิกไปแล้ว หรือนัดที่คนไข้มาแล้ว
    var dup = apts.some(function (a) {
      return crmHN_(a.hn) === k && crmDateOnly_(a.date) === d
        && (!tm || !a.time || String(a.time).slice(0, 5) === tm)
        && crmSameDoc_(a.docName, o['หมอ']);
    });
    if (dup) return;
    out.push({ id: 'ORTHO-' + k + '-' + d, date: d, time: tm, docName: o['หมอ'] || '', hn: o.hn, patName: o['ชื่อ'] || '',
      proc: o['รายการนัดถัดไป'] || 'นัดจัดฟัน', status: '', _ortho: true });
  });
  return out;
}
// ปุ่มในข้อความเก่าอ้างนัดจากการ์ด (ORTHO-<HN>-<วันที่>) แต่ตอนนี้มีนัดในตารางนัดวันเดียวกันมาแทน → ใช้นัดนั้น
function crmOrthoIdFallback_(allApts, id) {
  var m = String(id || '').match(/^ORTHO-(.+)-(\d{4}-\d{2}-\d{2})$/); if (!m) return null;
  var k = m[1], d = m[2], closedSt = ['ยกเลิก'];
  for (var i = 0; i < allApts.length; i++) {
    var a = allApts[i];
    if (!a._ortho && crmHN_(a.hn) === k && crmDateOnly_(a.date) === d && closedSt.indexOf(a.status) === -1) return a;
  }
  return null;
}
function crmIsOrthoApt_(s, apt, orthoActive) {
  if (apt._ortho) return true;
  if (orthoActive[crmHN_(apt.hn)]) return true;
  return crmHasWord_(apt.proc, crmSplitList_(s.orthoKeywords));
}
function crmTickInner_() {
  var s = crmSettings_();
  var summary = { confirm: 0, remind: 0, aftercare: 0, notes: 0, followup: 0, skipped: [] };
  if (!s.enabled) { summary.skipped.push('disabled'); return summary; }
  if (s.testMode && !s.testUserId) { summary.skipped.push('no_test_user'); return summary; }
  var hm = crmHM_(), today = crmToday_();
  if (hm < s.sendStart || hm >= s.sendEnd) { summary.skipped.push('outside_window'); return summary; }
  var budget = 150;   // บัญชีรายเดือน — ไม่หยุดส่งตามโควตาแล้ว (budget = เพดานต่อรอบเท่านั้น)
  var state = crmLogKeys_(); state.pushBudget = budget;
  var links = crmLinkMap_();
  var orthoAll = crmReadByName_('ortho');
  var apts = crmAptsWithOrtho_(crmReadByName_('ตารางนัด'), orthoAll);
  // แถวที่ลงอัตโนมัติจากปุ่ม "มาตามนัด" (จัดฟัน) ส่งสรุปให้คนไข้ไปแล้วทาง orthoVisitSend → ไม่ส่งใบเสร็จ/คำแนะนำ/ติดตามอาการซ้ำ
  var treats = crmReadByName_('บันทึกการรักษา').filter(function (t) { return String(t.note || '').indexOf('มาตามนัดจัดฟัน') < 0 && String(t.id || '').indexOf('orth-') !== 0; });   // ดูทั้งโน้ตและรหัสแถว (orth-…) — แก้โน้ตทิ้งก็ยังไม่ส่งซ้ำ
  var orthoActive = {};
  orthoAll.forEach(function (o) { if (!o['สถานะ'] || o['สถานะ'] === 'กำลังจัด') orthoActive[crmHN_(o.hn)] = true; });
  var closed = ['ยกเลิก', 'เสร็จสิ้น', 'เสร็จ', 'walk-in'];

  function targets(hn) { return (links[crmHN_(hn)] || []).filter(function (x) { return x.consent; }); }

  // 1) ยืนยันนัด (+ รวบรวมนัดที่ต้องเตือน)
  var remindGroups = {}, curIdsT = {};
  apts.forEach(function (a) { if (a.id) curIdsT[a.id] = true; });
  apts.forEach(function (a) {
    a.date = crmDateOnly_(a.date);
    if (!a.id || !a.date || a.date < today || closed.indexOf(a.status) !== -1) return;
    if (a.date === today && a.time && a.time <= hm) return;
    var tg = targets(a.hn); if (!tg.length) return;
    if (s.confirmOn) {
      var ck = crmKey_(s, 'confirm:' + a.id + ':' + a.date + ':' + (a.time || ''));
      // นัดในตารางนัดที่มาแทนนัดจากการ์ด (วันเดียวกัน) และการ์ดส่งยืนยันไปแล้ว → ไม่ส่งซ้ำ
      if (!a._ortho && !crmIsDone_(state, ck)) {
        var ok0 = 'confirm:ORTHO-' + crmHN_(a.hn) + '-' + a.date + ':' + a.date + ':';
        if (crmIsDone_(state, crmKey_(s, ok0 + (a.time || ''))) || crmIsDone_(state, crmKey_(s, ok0)))
          crmMark_(state, ck, 'confirm', { hn: a.hn, patName: a.patName, refId: a.id }, 'skipped', 'ส่งยืนยันไปแล้วในนามนัดจากการ์ดจัดฟัน');
      }
      if (!crmIsDone_(state, ck)) {
        var prefix = crmKey_(s, 'confirm:' + a.id + ':'), changed = false;
        for (var k in state.done) if (k.indexOf(prefix) === 0 && k.indexOf(ck) !== 0) { changed = true; break; }
        var mvI = crmMoveInfo_(s, state, a, curIdsT);
        tg.forEach(function (t) {
          if (crmSend_(s, state, { key: ck + '>' + t.lineUserId, type: 'confirm', hn: a.hn, patName: a.patName, lineUserId: t.lineUserId, refId: a.id, detail: a.date + ' ' + (a.time || '') },
            [crmAptMessage_(s, a, mvI ? 'move' : (changed ? 'change' : 'confirm'), mvI)])) summary.confirm++;
        });
        if (crmAllDone_(state, ck, tg)) crmMark_(state, ck, 'confirm', { hn: a.hn, patName: a.patName, refId: a.id }, 'done', '');
      }
    }
    if (s.remindOn && hm >= s.remindHour) {
      var gk = crmHN_(a.hn) + '|' + a.date;
      (remindGroups[gk] = remindGroups[gk] || []).push({ a: a, tg: tg, days: crmIsOrthoApt_(s, a, orthoActive) ? (+s.orthoDays || 2) : (+s.otherDays || 2) });
    }
  });

  // 2) เตือนนัด: คนไข้คนเดียวกัน วันเดียวกัน มีหลายนัด (เช่น ปรับลวด + ขูดหินปูน) → รวมเป็นข้อความเดียว ส่งตามวันที่เตือนล่วงหน้ามากที่สุดของกลุ่ม
  Object.keys(remindGroups).forEach(function (gk) {
    var g = remindGroups[gk], date = g[0].a.date, days = Math.max.apply(null, g.map(function (x) { return x.days; }));
    if (date !== crmAddDays_(today, days)) return;
    var items = [];
    g.forEach(function (x) {
      var a = x.a, rk = crmKey_(s, 'remind:' + a.id + ':' + a.date);
      if (!a._ortho && !crmIsDone_(state, rk) && crmIsDone_(state, crmKey_(s, 'remind:ORTHO-' + crmHN_(a.hn) + '-' + a.date + ':' + a.date)))
        crmMark_(state, rk, 'remind', { hn: a.hn, patName: a.patName, refId: a.id }, 'skipped', 'เตือนไปแล้วในนามนัดจากการ์ดจัดฟัน');
      if (crmIsDone_(state, rk)) return;
      if (crmSentWithinHours_(state, crmKey_(s, 'confirm:' + a.id + ':' + a.date + ':' + (a.time || '')), 12)) {
        crmMark_(state, rk, 'remind', { hn: a.hn, patName: a.patName, refId: a.id }, 'skipped', 'เพิ่งส่งยืนยันนัดไปไม่เกิน 12 ชม.'); return;
      }
      items.push(x);
    });
    if (!items.length) return;
    items.sort(function (x, y) { return String(x.a.time || '').localeCompare(String(y.a.time || '')); });
    var list = items.map(function (x) { return x.a; }), tg = items[0].tg;
    var ids = list.map(function (a) { return a.id; }).join(',');
    var gkey = crmKey_(s, 'remind:' + list[0].id + ':' + list[0].date);
    tg.forEach(function (t) {
      if (crmSend_(s, state, { key: gkey + '>' + t.lineUserId, type: 'remind', hn: list[0].hn, patName: list[0].patName, lineUserId: t.lineUserId, refId: ids,
        detail: date + ' ' + list.map(function (a) { return a.time || ''; }).join(' / ') + ' (' + days + ' วัน' + (list.length > 1 ? ' · รวม ' + list.length + ' นัด' : '') + ')' },
        [list.length > 1 ? crmAptGroupMessage_(s, list) : crmAptMessage_(s, list[0], 'remind')])) summary.remind++;
    });
    if (crmAllDone_(state, gkey, tg)) list.forEach(function (a) { crmMark_(state, crmKey_(s, 'remind:' + a.id + ':' + a.date), 'remind', { hn: a.hn, patName: a.patName, refId: a.id }, 'done', ''); });
  });

  // 3) คำแนะนำหลังรักษา (วันนี้)
  var templates = crmRead_('templates');
  var notes = crmRead_('casenotes');
  if (s.aftercareOn || s.receiptOn) {
    var byHn = {}, ydayR = crmAddDays_(today, -1);
    // รวมรายการของเมื่อวานที่ยังไม่ได้ส่ง (เช่น บันทึกหลังเวลาปิดส่ง sendEnd) → ส่งเช้านี้ ไม่หลุดหาย
    treats.forEach(function (t) {
      t.date = crmDateOnly_(t.date);
      if (!t.id || (t.date !== today && t.date !== ydayR) || !t.hn || t.status === 'ยกเลิก') return;
      var k = crmHN_(t.hn) + '|' + t.date; (byHn[k] = byHn[k] || []).push(t);
    });
    Object.keys(byHn).forEach(function (gk) {
      var k = gk.split('|')[0], gDate = gk.split('|')[1];
      var tg = targets(k); if (!tg.length) return;
      // เมื่อวาน: ส่งเฉพาะรายการที่หลุดทั้งหมด (ยังไม่ได้ส่งทั้งสรุปและคำแนะนำ) — ไม่ส่งคำแนะนำย้อนหลังให้เคสที่ได้สรุปไปแล้ว
      if (gDate === ydayR) byHn[gk] = byHn[gk].filter(function (t) { return !crmIsDone_(state, crmKey_(s, 'receipt:' + t.id)) && !crmIsDone_(state, crmKey_(s, 'after:' + t.id)); });
      if (!byHn[gk].length) return;
      var rowsR = s.receiptOn ? byHn[gk].filter(function (t) { return !crmIsDone_(state, crmKey_(s, 'receipt:' + t.id)); }) : [];
      var rowsA = s.aftercareOn ? byHn[gk].filter(function (t) { return !crmIsDone_(state, crmKey_(s, 'after:' + t.id)); }) : [];
      if (!rowsR.length && !rowsA.length) return;
      // ยังไม่มียอดเงิน → รอสูงสุด receiptWaitMin นาที (นับจากที่เห็นรายการครั้งแรก) เผื่อพนักงานกรอกยอดทีหลังหมอ ไม่งั้นการ์ดจะเขียนว่า "ไม่มีค่าใช้จ่าย" ผิด
      if (rowsR.length && (+s.receiptWaitMin) > 0) {
        var recTot = 0; rowsR.forEach(function (t) { recTot += (+t.cash || 0) + (+t.transfer || 0) + (+t.sso || 0); });
        if (recTot <= 0) {
          var firstSeen = null;
          rowsR.forEach(function (t) {
            var sk = crmKey_(s, 'rseen:' + t.id);
            if (!state.done[sk]) crmMark_(state, sk, 'seen', { hn: t.hn, patName: t.patName, refId: t.id }, 'seen', '');
            var at = new Date(String(state.done[sk].createdAt).replace(' ', 'T') + '+07:00').getTime();
            if (firstSeen === null || at < firstSeen) firstSeen = at;
          });
          if (Date.now() - firstSeen < (+s.receiptWaitMin) * 60000) return;
        }
      }
      var waiting = [];
      if (rowsA.length && +s.aftercareDelayMin > 0) {
        var ready = rowsA.filter(function (t) {
          var seenKey = crmKey_(s, 'seen:' + t.id);
          if (!state.done[seenKey]) { crmMark_(state, seenKey, 'seen', { hn: t.hn, patName: t.patName, refId: t.id }, 'seen', ''); return false; }
          var seenAt = new Date(String(state.done[seenKey].createdAt).replace(' ', 'T') + '+07:00');
          return (Date.now() - seenAt.getTime()) >= (+s.aftercareDelayMin) * 60000;
        });
        waiting = rowsA.filter(function (t) { return ready.indexOf(t) === -1; });
        rowsA = ready;
      }
      var tpls = [], ids = {};
      rowsA.forEach(function (t) { crmTemplatesFor_(t.proc, templates).forEach(function (tp) { if (!ids[tp.id]) { ids[tp.id] = 1; tpls.push(tp); } }); });
      var treatIds = rowsA.map(function (t) { return String(t.id); });
      var myNotes = notes.filter(function (n) { return n.status === 'approved' && treatIds.indexOf(String(n.treatId)) !== -1; });
      var hasAfter = tpls.length || myNotes.length;
      // ถ้ายังรอหน่วงเวลา Aftercare ที่มี template อยู่ → รอส่งรวมในข้อความเดียว (ไม่ส่งสรุปแยกก่อน)
      if (rowsR.length && !hasAfter && waiting.some(function (t) { return crmTemplatesFor_(t.proc, templates).length; })) return;
      var sentAny = false, treatsForMsg = rowsR.length ? rowsR : [];
      var msgs, key, refId, detail, type;
      if (hasAfter && rowsR.length) {            // การ์ดเดียว: สรุปการรักษา + ค่าใช้จ่าย + ขอบคุณ + คำแนะนำหลังรักษา
        var card = crmReceiptMessage_(s, rowsR, { tpls: tpls, notes: myNotes });
        msgs = (JSON.stringify(card).length < 45000) ? [card] : [crmReceiptMessage_(s, rowsR)].concat(crmAftercareMessages_(s, rowsR[0].patName, gDate, tpls, myNotes));
        key = crmKey_(s, 'after:' + rowsA[0].id); type = 'receipt'; refId = treatIds.join(',');
        detail = 'สรุป+Aftercare: ' + tpls.map(function (x) { return x.name; }).join(', ') + (myNotes.length ? ' +คำแนะนำพิเศษ' : '');
      } else if (hasAfter) {                      // สวิตช์สรุปการรักษาปิด หรือส่งสรุปไปแล้ว → ส่งคำแนะนำล้วน
        msgs = crmAftercareMessages_(s, rowsA[0].patName, gDate, tpls, myNotes);
        key = crmKey_(s, 'after:' + rowsA[0].id); type = 'aftercare'; refId = treatIds.join(',');
        detail = tpls.map(function (x) { return x.name; }).join(', ') + (myNotes.length ? ' +คำแนะนำพิเศษ' : '');
      } else if (rowsR.length) {                  // ยังไม่มี template อนุมัติ → ส่งสรุปการรักษาอย่างเดียวก่อน
        msgs = [crmReceiptMessage_(s, rowsR)];
        key = crmKey_(s, 'receipt:' + rowsR[0].id); type = 'receipt'; refId = rowsR.map(function (t) { return t.id; }).join(','); detail = 'สรุปการรักษา';
      } else return;                              // ยังไม่มี template ที่อนุมัติสำหรับหัตถการนี้ — รอ
      var t0 = (rowsR.length ? rowsR[0] : rowsA[0]);
      tg.forEach(function (t) {
        if (crmSend_(s, state, { key: key + '>' + t.lineUserId, type: type, hn: t0.hn, patName: t0.patName, lineUserId: t.lineUserId, refId: refId, detail: detail }, msgs)) {
          sentAny = true; if (type === 'receipt') summary.receipt = (summary.receipt || 0) + 1; if (hasAfter) summary.aftercare++;
          if (type === 'receipt' && !s.testMode) {   // แจ้งแอดมินว่าส่งสรุปให้คนไข้แล้ว
            try {
              var rsum = rowsR.map(function (x) { return String(x.proc || '').replace(/\s*,\s*/g, ', ') + ' ' + crmTreatAmt_(x); }).join(' | ');
              crmNotifyStaff_(s, { id: 'RC-' + t0.hn + '-' + Date.now(), type: 'receipt', priority: 'normal', hn: t0.hn, patName: t0.patName, lineUserId: t.lineUserId, detail: rsum.slice(0, 200) });
            } catch (eR) { Logger.log('notify receipt ' + eR); }
          }
        }
      });
      if (crmAllDone_(state, key, tg)) {
        if (type === 'receipt') rowsR.forEach(function (t) { crmMark_(state, crmKey_(s, 'receipt:' + t.id), 'receipt', { hn: t.hn, patName: t.patName, refId: t.id }, 'done', 'amt=' + crmTreatAmt_(t)); });
        if (hasAfter) {
          rowsA.forEach(function (t) { crmMark_(state, crmKey_(s, 'after:' + t.id), 'aftercare', { hn: t.hn, patName: t.patName, refId: t.id }, 'done', ''); });
          if (sentAny && !s.testMode) myNotes.forEach(function (n) { crmUpdate_('casenotes', n._row, { status: 'sent', sentAt: crmNow_() }); n.status = 'sent'; });
        }
      }
    });
    // คำแนะนำพิเศษที่อนุมัติหลังจากส่ง aftercare ไปแล้ว → ส่งแยก
    notes.forEach(function (n) {
      if (!s.aftercareOn || n.status !== 'approved') return;
      var tr = crmFind_(treats, 'id', n.treatId); if (!tr) return;
      if (!crmIsDone_(state, crmKey_(s, 'after:' + n.treatId))) return; // ยังไม่ส่ง aftercare หลัก → จะส่งรวมรอบหน้า
      var tg = targets(n.hn || tr.hn); if (!tg.length) return;
      var nk = crmKey_(s, 'note:' + n.id), ok = false;
      tg.forEach(function (t) {
        if (crmSend_(s, state, { key: nk + '>' + t.lineUserId, type: 'casenote', hn: n.hn, patName: n.patName, lineUserId: t.lineUserId, refId: n.id },
          [crmText_('📝 คำแนะนำเพิ่มเติมจากทันตแพทย์ สำหรับคุณ' + (n.patName || '') + '\n\n' + n.text)])) { ok = true; summary.notes++; }
      });
      if (ok && !s.testMode) crmUpdate_('casenotes', n._row, { status: 'sent', sentAt: crmNow_() });
      if (crmAllDone_(state, nk, tg)) crmMark_(state, nk, 'casenote', { hn: n.hn, refId: n.id }, 'done', '');
    });
  }

  // 3.5) แก้ยอดหลังส่งสรุปไปแล้ว → สร้างงานแจ้งพนักงาน (ไม่ส่งหาคนไข้เอง) พนักงานเลือกส่งการ์ดแก้ไขหรือไม่ส่งก็ได้
  treats.forEach(function (t) {
    if (!t.id || !t.hn || t.status === 'ยกเลิก') return;
    var dd = crmDateOnly_(t.date); if (dd < crmAddDays_(today, -3)) return;
    var rr = state.done[crmKey_(s, 'receipt:' + t.id)];
    if (!rr || String(rr.detail || '').indexOf('amt=') !== 0) return;      // ส่งสรุปก่อนมีระบบนี้ → ไม่มียอดอ้างอิง ข้าม
    var was = +String(rr.detail).slice(4) || 0, cur = crmTreatAmt_(t);
    if (was === cur) return;
    var ck = crmKey_(s, 'amtchg:' + t.id + ':' + cur);
    if (crmIsDone_(state, ck)) return;
    crmCreateTask_({ type: 'amtchange', priority: 'normal', hn: t.hn, patName: t.patName, aptId: t.id, aptDate: dd, aptTime: String(cur),
      detail: 'แก้ยอดหลังส่งสรุปให้คนไข้แล้ว: ' + crmMoney_(was) + ' → ' + crmMoney_(cur) + ' (' + (t.proc || '-') + ') — ต้องการส่งการ์ดแก้ไขให้คนไข้ไหม' });
    crmMark_(state, ck, 'amtchg', { hn: t.hn, patName: t.patName, refId: t.id }, 'done', '');
    summary.amtchange = (summary.amtchange || 0) + 1;
  });

  // 3.6) นัดที่ถูกเปลี่ยนสถานะเป็น "ยกเลิก" (ล่วงหน้า) และคนไข้เคยได้ข้อความนัดไปแล้ว → สร้างงานให้พนักงานเลือกส่งข้อความแจ้งยกเลิก (ไม่ส่งเอง)
  apts.forEach(function (a) {
    if (a._ortho || a.status !== 'ยกเลิก' || !a.id || !a.hn) return;
    var dd = crmDateOnly_(a.date); if (!dd || dd < today) return;
    if (dd === today && a.time && a.time <= hm) return;
    if (!targets(a.hn).length) return;
    if (crmCancelTask_(s, state, a, 'ยกเลิกนัดในตารางนัด')) summary.aptcancel = (summary.aptcancel || 0) + 1;
  });

  // 3.7) นัดจากการ์ดจัดฟันที่เคยส่งยืนยัน/เตือนไปแล้ว แต่ตอนนี้ไม่มีนัดแล้ว (ล้างนัดถัดไป / เปลี่ยนสถานะการ์ดเป็นหยุด-เลิก-เสร็จ)
  //      → สร้างงาน "แจ้งยกเลิกนัด" ให้แอดมินตัดสินใจส่งข้อความ (เหมือนนัดในตารางนัด) · ถ้าเลื่อนไปวันใหม่ คนไข้จะได้ยืนยันนัดใหม่อยู่แล้ว จึงไม่สร้าง
  try {
    var oSeen = {}, oProc = {}, cardFuture = {};
    apts.forEach(function (a) { if (a._ortho) oSeen[a.id] = true; });
    orthoAll.forEach(function (o) {
      var kk = crmHN_(o.hn), nd = crmDateOnly_(o['นัดถัดไป']);
      if ((!o['สถานะ'] || o['สถานะ'] === 'กำลังจัด') && nd && nd >= today) cardFuture[kk] = true;
    });
    var realOpen = {};
    apts.forEach(function (a) { if (!a._ortho && a.hn && a.status !== 'ยกเลิก') realOpen[crmHN_(a.hn) + '|' + crmDateOnly_(a.date)] = true; });
    for (var lk in state.done) {
      var lr = state.done[lk];
      if (!lr || (lr.type !== 'confirm' && lr.type !== 'remind') || (lr.status !== 'sent' && lr.status !== 'test')) continue;
      var mm = String(lr.refId || '').match(/^ORTHO-(.+)-(\d{4}-\d{2}-\d{2})$/); if (!mm) continue;
      var rid = lr.refId, od = mm[2], ok = crmHN_(lr.hn || mm[1]);
      if (oProc[rid] || oSeen[rid] || od < today) continue;
      oProc[rid] = true;
      if (cardFuture[ok] || realOpen[ok + '|' + od]) continue;   // เลื่อนไปวันใหม่แล้ว / มีนัดในตารางนัดแทน
      var otm = String(lr.detail || '').split(' ')[1] || '';
      if (od === today && otm && otm <= hm) continue;
      if (!targets(lr.hn).length) continue;
      if (crmCancelTask_(s, state, { id: rid, hn: lr.hn, patName: lr.patName, date: od, time: otm, proc: 'นัดจัดฟัน', status: 'ยกเลิก' }, 'ล้างนัดถัดไปในการ์ดจัดฟัน'))
        summary.aptcancel = (summary.aptcancel || 0) + 1;
    }
  } catch (eOC) { console.error('ortho cancel check: ' + eOC); }

  // 4) ติดตามอาการวันถัดไป
  if (s.followupOn && hm >= s.followupHour) {
    var yday = crmAddDays_(today, -1), groups = {};
    treats.forEach(function (t) {
      if (!t.hn || crmDateOnly_(t.date) !== yday) return;
      var k = crmHN_(t.hn); (groups[k] = groups[k] || []).push(t);
    });
    Object.keys(groups).forEach(function (k) {
      var fk = crmKey_(s, 'fu:' + k + ':' + yday);
      if (crmIsDone_(state, fk)) return;
      var tg = targets(k); if (!tg.length) return;
      var best = null, procText = '';
      groups[k].forEach(function (t) {
        crmTemplatesFor_(t.proc, templates).forEach(function (tp) {
          if (String(tp.followupEnabled).toUpperCase() !== 'TRUE') return;
          if (!best || (+tp.priority || 99) < (+best.priority || 99)) { best = tp; procText = tp.name; }
        });
      });
      if (!best) return;
      var g0 = groups[k][0];
      var fu = { id: crmId_('FU'), hn: g0.hn, patName: g0.patName, lineUserId: tg[0].lineUserId, treatDate: yday, templateId: best.id, proc: procText,
        sentAt: crmNow_(), answer: '', answerKind: '', answeredAt: '', taskId: '' };
      var docsF = []; groups[k].forEach(function (t2) { if (t2.docName && crmTemplatesFor_(t2.proc, templates).some(function (x) { return x.id === best.id; }) && docsF.indexOf(t2.docName) === -1) docsF.push(t2.docName); });
      var docOkF = crmReviewAllowed_(s, docsF, best.id);
      var ok = false;
      tg.forEach(function (t) {
        if (crmSend_(s, state, { key: fk + '>' + t.lineUserId, type: 'followup', hn: g0.hn, patName: g0.patName, lineUserId: t.lineUserId, refId: fu.id, detail: procText },
          [crmFollowupMessage_(s, fu, best, g0.patName, procText, docOkF)])) { ok = true; summary.followup++; }
      });
      if (ok) { fu.status = s.testMode ? 'test' : 'sent'; crmAppend_('followups', fu); }
      if (crmAllDone_(state, fk, tg)) crmMark_(state, fk, 'followup', { hn: g0.hn, patName: g0.patName, refId: fu.id }, 'done', '');
    });
  }
  // 3.9) อวยพรวันเกิด — เช้าวันเกิด (ในช่วงเวลาที่ส่งได้) ปีละครั้งต่อคนไข้ · พร้อมสิทธิ์ยาสีฟันเมื่อมาตามนัดในเดือนเกิด
  if (s.birthdayOn) {
    try {
      var md0 = today.slice(5, 10), yr0 = today.slice(0, 4);
      crmRead_('links').forEach(function (l) {
        if (l.status !== 'active' || String(l.birthday || '') !== md0) return;
        var tg = (links[crmHN_(l.hn)] || []).filter(function (x) { return x.lineUserId === l.lineUserId && x.consent; });
        if (!tg.length) return;
        var bk = crmKey_(s, 'bday:' + crmHN_(l.hn) + ':' + yr0);
        if (crmIsDone_(state, bk)) return;
        var nm = String(l.patName || '').split(' ')[0];
        var txt = String(s.birthdayText || '').replace(/\{name\}/g, nm).replace(/\{month\}/g, CRM_TH_MONTHS[+md0.slice(0, 2) - 1]).replace(/\{phone\}/g, s.clinicPhone || '').replace(/\{clinic\}/g, s.clinicName || '');
        tg.forEach(function (t) {
          if (crmSend_(s, state, { key: bk + '>' + t.lineUserId, type: 'birthday', hn: l.hn, patName: l.patName, lineUserId: t.lineUserId, refId: 'bday-' + yr0, detail: md0 }, [crmText_(txt)])) summary.birthday = (summary.birthday || 0) + 1;
        });
        if (crmAllDone_(state, bk, tg)) crmMark_(state, bk, 'birthday', { hn: l.hn, patName: l.patName, refId: 'bday-' + yr0 }, 'done', '');
      });
    } catch (eb) {}
  }
  crmFlushMarks_(state);
  summary.at = crmNow_();
  PropertiesService.getScriptProperties().setProperty('CRM_LAST_TICK', JSON.stringify(summary));
  return summary;
}

/* ตอนเปิดระบบครั้งแรก: นัดที่มีอยู่แล้วไม่ต้องส่ง "ยืนยันนัด" ย้อนหลังทั้งหมด (กันส่งรัว) */
function crmBaseline_(s) {
  var state = crmLogKeys_(), today = crmToday_(), n = 0;
  crmAptsWithOrtho_(crmReadByName_('ตารางนัด'), crmReadByName_('ortho')).forEach(function (a) {
    var d = crmDateOnly_(a.date);
    if (!a.id || !d || d < today) return;
    var ck = crmKey_(s, 'confirm:' + a.id + ':' + d + ':' + (a.time || ''));
    if (!state.done[ck]) { crmMark_(state, ck, 'confirm', { hn: a.hn, patName: a.patName, refId: a.id }, 'baseline', 'นัดที่มีอยู่ก่อนเปิดระบบ'); n++; }
  });
  crmReadByName_('บันทึกการรักษา').forEach(function (t) {
    var td0 = crmDateOnly_(t.date);
    if (!t.id || !t.hn || (td0 !== today && td0 !== crmAddDays_(today, -1))) return;   // เมื่อวานด้วย (ระบบส่งย้อนรายการเมื่อวานที่ยังไม่ได้ส่ง)
    var rk = crmKey_(s, 'receipt:' + t.id);
    if (!state.done[rk]) { crmMark_(state, rk, 'receipt', { hn: t.hn, patName: t.patName, refId: t.id }, 'baseline', 'การรักษาที่บันทึกไว้ก่อนเปิดระบบ'); n++; }
    var ak = crmKey_(s, 'after:' + t.id);
    if (td0 !== today && !state.done[ak]) { crmMark_(state, ak, 'aftercare', { hn: t.hn, patName: t.patName, refId: t.id }, 'baseline', 'การรักษาเมื่อวานก่อนเปิดระบบ'); n++; }
  });
  var yday = crmAddDays_(today, -1);
  crmReadByName_('บันทึกการรักษา').forEach(function (t) {
    if (!t.hn || crmDateOnly_(t.date) !== yday) return;
    var fk = crmKey_(s, 'fu:' + crmHN_(t.hn) + ':' + yday);
    if (!state.done[fk]) { crmMark_(state, fk, 'followup', { hn: t.hn, patName: t.patName, refId: t.id }, 'baseline', 'ก่อนเปิดระบบ'); n++; }
  });
  crmFlushMarks_(state);
  return n;
}

/* ============================ WEBHOOK ============================ */
// userId ของบอท (OA) จาก LINE — ใช้ตรวจว่า webhook ส่งมาถึงบอทเราจริง (Apps Script ตรวจลายเซ็น LINE ไม่ได้)
function crmBotId_() {
  var pr = PropertiesService.getScriptProperties(), id = pr.getProperty('CRM_BOT_ID');
  if (id) return id;
  var c = CacheService.getScriptCache(); if (c.get('crm_botid_try')) return '';
  c.put('crm_botid_try', '1', 600);   // ถาม LINE ไม่เกินทุก 10 นาทีถ้ายังไม่สำเร็จ
  try { var r = crmApi_('get', '/v2/bot/info'); if (r.code === 200 && r.data && /^U[0-9a-f]{32}$/.test(r.data.userId || '')) { pr.setProperty('CRM_BOT_ID', r.data.userId); return r.data.userId; } } catch (e) {}
  return '';
}
function crmHandleWebhook_(events, destination) {
  var s = crmSettings_();
  // กัน event ปลอม: ถ้ารู้ userId ของบอทแล้ว event ต้องระบุ destination ตรงกัน (ไม่รู้ = ปล่อยผ่าน กันระบบล่ม)
  var bot = (events && events.length) ? crmBotId_() : '';
  if (bot && destination !== bot) {
    try { var c0 = CacheService.getScriptCache(); if (!c0.get('crm_whrej')) { c0.put('crm_whrej', '1', 3600); crmAppend_('log', { key: 'whrej:' + Date.now(), type: 'webhook_reject', status: 'error', detail: 'destination ไม่ตรงกับบอท: ' + String(destination || '(ไม่มี)').slice(0, 40), createdAt: crmNow_(), pushCount: 0 }); } } catch (e0) {}
    return;
  }
  var cache = CacheService.getScriptCache();
  (events || []).forEach(function (ev) {
    try {
      // LINE ส่งซ้ำ (redelivery) → ทำครั้งเดียว
      var evId = ev.webhookEventId;
      if (evId) { if (cache.get('crm_ev_' + evId)) return; cache.put('crm_ev_' + evId, '1', 21600); }
      // รับเฉพาะแชท 1:1 (ไม่ตอบในกลุ่ม/ห้อง)
      if (ev.source && ev.source.type && ev.source.type !== 'user') return;
      var uid = ev.source && ev.source.userId;
      if (ev.type === 'follow') {
        crmUpsertFollower_(uid, 'follow');
        crmReply_(ev.replyToken, [crmWelcome_(s)]);
      } else if (ev.type === 'unfollow') {
        crmUpsertFollower_(uid, 'unfollow');
      } else if (ev.type === 'postback') {
        crmUpsertFollower_(uid, null);
        crmHandlePostback_(s, ev, uid);
      } else if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        crmUpsertFollower_(uid, null);
        crmHandleText_(s, ev, uid);
      }
    } catch (err) {
      try { crmAppend_('log', { key: 'err:' + Date.now(), type: 'webhook_error', status: 'error', detail: String(err).slice(0, 300), createdAt: crmNow_(), pushCount: 0 }); } catch (e2) {}
    }
  });
}
function crmWelcome_(s) {
  return { type: 'flex', altText: 'ยินดีต้อนรับสู่' + s.clinicName,
    contents: crmBubble_(s, 'ยินดีต้อนรับค่ะ 🦷', 'ขอบคุณที่เป็นเพื่อนกับคลินิกค่ะ ทางคลินิกจะแจ้งเตือนนัดและส่งสรุปการรักษาให้ทาง LINE นี้', [],
      [crmInquiryNote_(s)]) };
}
function crmUpsertFollower_(uid, status) {
  if (!uid) return;
  var rows = crmRead_('followers'), r = crmFind_(rows, 'lineUserId', uid), now = crmNow_();
  if (r) {
    var patch = { lastSeenAt: now };
    if (status) { patch.status = status; patch.updatedAt = now; }
    if (status === 'follow' || !r.displayName) {
      var pf = crmApi_('get', '/v2/bot/profile/' + uid);
      if (pf.code === 200 && pf.data) { patch.displayName = pf.data.displayName || ''; patch.pictureUrl = pf.data.pictureUrl || ''; }
    }
    crmUpdate_('followers', r._row, patch);
    return;
  }
  var p = crmApi_('get', '/v2/bot/profile/' + uid);
  crmAppend_('followers', { lineUserId: uid, displayName: (p.data && p.data.displayName) || '', pictureUrl: (p.data && p.data.pictureUrl) || '',
    status: status || 'follow', followedAt: status === 'follow' ? now : '', updatedAt: now, lastSeenAt: now });
}
/* ----- แจ้งยกเลิกนัด: สร้างงานให้พนักงานตัดสินใจ (ลบเพราะลงซ้ำ/พิมพ์ผิดไม่ควรแจ้งคนไข้) ----- */
function crmCancelTask_(s, state, a, how) {
  var dd = crmDateOnly_(a.date), key = crmKey_(s, 'cancel:' + a.id + ':' + dd);
  if (state.done[key]) return false;
  var informed = false, pre = [crmKey_(s, 'confirm:' + a.id + ':'), crmKey_(s, 'remind:' + a.id + ':')];
  for (var k in state.done) {
    var r = state.done[k]; if (r.status !== 'sent' && r.status !== 'test') continue;
    if (k.indexOf(pre[0]) === 0 || k.indexOf(pre[1]) === 0) { informed = true; break; }
  }
  var ctx = { hn: a.hn, patName: a.patName, refId: a.id };
  if (!informed) { crmMark_(state, key, 'aptcancel', ctx, 'skipped', 'คนไข้ยังไม่เคยได้รับข้อความนัดนี้'); return false; }
  var tm = String(a.time || '').slice(0, 5);
  crmCreateTask_({ type: 'aptcancel', priority: 'high', hn: a.hn, patName: a.patName, aptId: a.id, aptDate: dd, aptTime: tm,
    detail: how + ' · นัดวันที่ ' + crmThaiDate_(dd) + (tm ? ' ' + tm + ' น.' : '') + ((a.proc || a.docName) ? ' (' + [a.proc, a.docName].filter(Boolean).join(' · ') + ')' : '')
      + ' — คนไข้เคยได้รับข้อความนัดนี้แล้ว ต้องการส่งข้อความแจ้งยกเลิกทาง LINE ไหม? (ถ้าลบเพราะลงซ้ำ/พิมพ์ผิด ให้กด "ไม่ต้องแจ้ง")' });
  crmMark_(state, key, 'aptcancel', ctx, 'done', how);
  return true;
}
// เรียกจาก Code.gs ก่อนลบแถวนัดจริง (ลบแล้วระบบเห็นไม่ได้อีก)
function crmOnAptRemoved_(id) {
  var s = crmSettings_(); if (!s.enabled) return;
  var a = crmFind_(crmReadByName_('ตารางนัด'), 'id', String(id));
  if (!a || !a.hn || ['เสร็จสิ้น', 'เสร็จ', 'walk-in'].indexOf(a.status) !== -1) return;
  var today = crmToday_(), dd = crmDateOnly_(a.date); if (!dd || dd < today) return;
  if (dd === today && a.time && String(a.time).slice(0, 5) <= crmHM_()) return;
  var tg = (crmLinkMap_()[crmHN_(a.hn)] || []).filter(function (x) { return x.consent; });
  if (!tg.length) return;
  var state = crmLogKeys_();
  if (crmCancelTask_(s, state, a, 'ลบนัดออกจากตารางนัด')) { crmFlushMarks_(state); crmTouch_(); }
  else crmFlushMarks_(state);
}
// ข้อควรปฏิบัติสำหรับคนไข้จัดฟัน (ข้อความเดียวกับหน้า "ข้อควรปฏิบัติ" ใน LIFF จัดฟัน)
var CRM_ORTHO_CARE_ = [
  'แปรงฟันหลังอาหารทุกมื้อ ใช้แปรงซอกฟัน/แปรงจัดฟันร่วมด้วย',
  'หลีกเลี่ยงของแข็ง เหนียว และกัดของแข็งตรงๆ เช่น น้ำแข็ง กระดูก',
  'ถ้าลวดหลุด/ทิ่มแก้ม ใช้ขี้ผึ้ง (wax) กดไว้ แล้วรีบติดต่อคลินิก',
  'ใส่ยาง (elastic) ตามที่หมอสั่งอย่างสม่ำเสมอ',
  'มาตามนัดทุกครั้ง การขาดนัดทำให้การจัดฟันนานขึ้น',
  'กรณีมาปรับเครื่องมือห่างเกิน 60 วัน ขอสงวนสิทธิ์เปลี่ยนเป็นชำระ 1,500 บาทจนกว่าจะเสร็จค่ะ'
];
// สรุปการมาจัดฟัน: รายการ + ราคา (0 บาท = ฟรี) + ยอดรวม (+ ข้อควรปฏิบัติ)
function crmOrthoVisitMessage_(s, v) {
  var rows = [crmRow_('วัน', crmThaiDate_(v.date))];
  if (v.doc) rows.push(crmRow_('ทันตแพทย์', v.doc));
  var total = 0;
  v.items.forEach(function (x, i) {
    if (x.price !== null) total += x.price;
    rows.push(crmRow_(i === 0 ? 'รายการ' : '', (i + 1) + '. ' + x.name + (x.note ? ' (' + x.note + ')' : '') + (x.price === null ? '' : ' — ' + (x.price > 0 ? crmMoney_(x.price) : 'ฟรี'))));
  });
  rows.push({ type: 'separator', margin: 'md' });
  rows.push(crmRow_('รวม', total > 0 ? crmMoney_(total) : 'ไม่มีค่าใช้จ่าย'));
  var pc = +v.cash || 0, pt = +v.transfer || 0;   // วิธีชำระ: เงินสด / โอน (ระบุเสมอเมื่อมียอด)
  if (total > 0 && (pc > 0 || pt > 0)) {
    if (pc > 0 && pt > 0) { rows.push(crmRow_('  เงินสด', crmMoney_(pc))); rows.push(crmRow_('  โอนเงิน', crmMoney_(pt))); }
    else rows.push(crmRow_('ชำระโดย', pc > 0 ? 'เงินสด' : 'โอนเงิน'));
  }
  if (v.care) {
    rows.push({ type: 'separator', margin: 'md' });
    rows.push({ type: 'text', text: '📝 ข้อควรปฏิบัติ', weight: 'bold', size: 'md', color: '#6B2D5E', margin: 'md' });
    CRM_ORTHO_CARE_.forEach(function (t, i) { rows.push({ type: 'text', text: (i + 1) + '. ' + t, wrap: true, size: 'sm', color: '#1A0A17', margin: 'sm' }); });
  }
  return { type: 'flex', altText: 'สรุปการมาจัดฟันวันนี้ ' + (total > 0 ? crmMoney_(total) : 'ไม่มีค่าใช้จ่าย'),
    contents: crmBubble_(s, '🦷 สรุปการมาจัดฟันวันนี้', 'ขอบคุณที่มาตามนัดค่ะ คุณ' + (v.patName || ''), rows, [crmInquiryNote_(s)]) };
}
function crmCancelMessage_(s, task) {
  var rows = [crmRow_('วัน', crmThaiDate_(task.aptDate))];
  if (task.aptTime) rows.push(crmRow_('เวลา', task.aptTime + ' น.'));
  return { type: 'flex', altText: 'แจ้งยกเลิกนัดหมาย ' + crmThaiDate_(task.aptDate),
    contents: crmBubble_(s, '📌 แจ้งยกเลิกนัดหมาย', 'คุณ' + (task.patName || '') + ' คลินิกขอยกเลิกนัดหมายนี้ค่ะ หากต้องการนัดหมายใหม่ ติดต่อคลินิกได้เลยค่ะ', rows, [crmInquiryNote_(s)]) };
}
function crmCreateTask_(t) {
  var now = crmNow_();
  var task = { id: crmId_('TK'), type: t.type, priority: t.priority || 'normal', status: 'open', hn: t.hn || '', patName: t.patName || '',
    lineUserId: t.lineUserId || '', aptId: t.aptId || '', aptDate: t.aptDate || '', aptTime: t.aptTime || '', detail: t.detail || '',
    preference: '', createdAt: now, updatedAt: now, doneBy: '', resultNote: '' };
  crmAppend_('tasks', task);
  try { crmNotifyStaff_(crmSettings_(), task); } catch (eN) { Logger.log('crmNotifyStaff_ ' + eN); }
  return task;
}
// ---- แจ้งแอดมินทาง LINE (push เข้า LINE ส่วนตัวของแอดมิน) ----
var CRM_STAFF_LABEL = { reschedule: '📅 คนไข้ขอเลื่อนนัด', emergency: '🚨 อาการฉุกเฉิน', callback: '📞 ขอให้คลินิกโทรกลับ', message: '💬 คนไข้พิมพ์เข้ามา', receipt: '🧾 ส่งสรุปการรักษาแล้ว' };
/* รหัสจัดฟัน (A-###) ของ HN จากชีต ortho · ไม่มี/ไม่พบ → '' */
function crmOrthoCodeOf_(hn) {
  var k = crmHN_(hn); if (!k) return '';
  var rows = crmReadByName_('ortho');
  for (var i = 0; i < rows.length; i++) {
    if (crmHN_(rows[i].hn) === k) {
      var c = String(rows[i]['รหัสประจำตัว'] || '').trim().toUpperCase();
      if (c) return c;
    }
  }
  return '';
}
/* ชื่อคนไข้จาก LINE userId: ชื่อที่ผูก HN ไว้ → ไม่มีใช้ชื่อ LINE */
function crmNameOfUid_(uid) {
  var name = '', hn = '';
  try {
    var l = crmRead_('links').filter(function (x) { return x.lineUserId === uid && x.status === 'active'; })[0];
    if (l) { name = l.patName || ''; hn = l.hn || ''; }
    if (!name) { var f = crmRead_('followers').filter(function (x) { return x.lineUserId === uid; })[0]; if (f) name = f.displayName || ''; }
  } catch (e) {}
  return { name: name, hn: hn };
}
function crmStaffSkip_(task, why) {   // บันทึกใน log ว่าทำไมไม่ได้ส่งแจ้งแอดมิน (ไว้ไล่สาเหตุ)
  try { crmAppend_('log', { key: 'staff-skip:' + task.id, type: 'staff', hn: task.hn || '', patName: task.patName || '', lineUserId: '', refId: task.id,
    status: 'skipped', detail: task.type + ' → ไม่ส่ง: ' + why, createdAt: crmNow_(), pushCount: 0 }); } catch (e) {}
  return 0;
}
function crmNotifyStaff_(s, task, force) {
  if (!force && !(s.staffNotifyOn === true || s.staffNotifyOn === 'true' || s.staffNotifyOn === 'TRUE')) return crmStaffSkip_(task, 'สวิตช์ "ส่ง LINE เข้ามือถือแอดมิน" ปิดอยู่ในตั้งค่าที่บันทึกไว้');
  if (!force && crmSplitList_(s.staffNotifyTypes || 'reschedule,emergency,callback,message,receipt').indexOf(task.type) === -1) return crmStaffSkip_(task, 'ประเภทเรื่องนี้ไม่ได้ติ๊กรับแจ้ง');
  var ids = crmSplitList_(s.staffNotifyIds); if (!ids.length) return crmStaffSkip_(task, 'ยังไม่ได้เลือกบัญชีแอดมิน');
  if (task.type !== 'emergency') {   // ฉุกเฉินส่งเสมอ · อย่างอื่นหยุดเมื่อโควตาหมด
    var q = crmQuota_(); if (q && q.remaining !== null && q.remaining !== undefined && q.remaining <= 0) return crmStaffSkip_(task, 'โควตา LINE หมด');
  }
  var lines = [(CRM_STAFF_LABEL[task.type] || ('🔔 ' + task.type)) + (task.priority === 'urgent' ? ' (ด่วน)' : (task.priority === 'high' ? ' (สำคัญ)' : ''))];
  var oc = ''; try { oc = crmOrthoCodeOf_(task.hn); } catch (eO) { Logger.log('crmOrthoCodeOf_ ' + eO); }
  // รหัสจัดฟัน + HN นำหน้าชื่อ
  lines.push((oc ? oc + ' ' : '') + (task.hn ? 'HN ' + task.hn + ' ' : '') + 'คุณ' + (task.patName || 'ไม่ทราบชื่อ') + (task.hn ? '' : ' · ยังไม่ผูก HN'));
  if (task.aptDate && task.type !== 'message' && task.type !== 'receipt') lines.push('นัดเดิม: ' + crmThaiDate_(task.aptDate) + (task.aptTime ? ' ' + task.aptTime + ' น.' : ''));
  if (task.detail) lines.push(String(task.detail).slice(0, 300));
  lines.push(task.type === 'message' ? '➡️ เปิดแชท LINE OA เพื่อตอบ' : (task.type === 'receipt' ? '' : '➡️ เปิดแอปคลินิก › LINE CRM › งานโทรกลับ'));
  if (!lines[lines.length - 1]) lines.pop();
  if (s.testMode) lines.unshift('🧪 (โหมดทดสอบ)');
  var n = 0;
  ids.forEach(function (to) {
    var res = crmApi_('post', '/v2/bot/message/push', { to: to, messages: [crmText_(lines.join('\n'))] });
    var ok = res.code === 200; if (ok) n++;
    crmAppend_('log', { key: 'staff:' + task.id + ':' + to, type: 'staff', hn: task.hn || '', patName: task.patName || '', lineUserId: to, refId: task.id,
      status: ok ? 'sent' : 'failed', detail: ok ? (task.type + ' → แอดมิน') : ('HTTP ' + res.code + ' ' + String(res.text || '').slice(0, 150)), createdAt: crmNow_(), pushCount: ok ? 1 : 0 });
  });
  return n;
}
function crmRatingApplies_(s, fu) {
  if (!(s.ratingOn === true || s.ratingOn === 'true' || s.ratingOn === 'TRUE')) return false;
  return crmSplitList_(s.ratingTpls).indexOf(String(fu.templateId)) !== -1;
}
function crmRatingMessage_(s, fu) {
  var L = [['5', '5 ⭐ ดีมาก'], ['4', '4 ⭐ ดี'], ['3', '3 ⭐ พอใช้'], ['2', '2 ⭐ ควรปรับปรุง'], ['1', '1 ⭐ ไม่พอใจ'], ['0', '0 ⭐ แย่มาก']];
  var directReview = /^https:\/\//i.test(String(s.reviewUrl || '').trim());   // 5 ดาว: เปิดหน้ารีวิวทันที (ผ่านหน้าบันทึกคะแนน rate.html)
  var btn = function (x) { return { type: 'button', height: 'sm', style: x[0] === '5' ? 'primary' : 'secondary', color: x[0] === '5' ? '#1D825C' : undefined,
    action: (x[0] === '5' && directReview) ? { type: 'uri', label: x[1], uri: crmRateUrl_(fu.id) }
      : { type: 'postback', label: x[1], data: 'rate|' + fu.id + '|' + x[0], displayText: x[1] } }; };
  var btns = L.map(btn); btns.forEach(function (b) { if (b.color === undefined) delete b.color; });
  return { type: 'flex', altText: 'คลิกให้คะแนนบริการครั้งนี้ 0-5', contents: crmBubble_(s, '⭐ คลิกให้คะแนนบริการครั้งนี้', 'ความเห็นของคุณช่วยให้เราพัฒนาบริการค่ะ 🙏 กรุณาเลือกคะแนน 0–5', [], btns, '#1D825C') };
}
/* ลิงก์ปุ่ม 5 ดาว → หน้า rate.html บันทึกคะแนน 5 แล้วเด้งไปหน้ารีวิว (ลายเซ็นกันเดา id ของคนอื่น) */
function crmRateSecret_() {
  var pr = PropertiesService.getScriptProperties(), v = pr.getProperty('CRM_RATE_SECRET');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); pr.setProperty('CRM_RATE_SECRET', v); }
  return v;
}
function crmRateToken_(fuId) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('rate|' + fuId, crmRateSecret_())).replace(/=+$/, '').slice(0, 22); }
function crmRateUrl_(fuId) { return 'https://toy113.github.io/Bangluang/rate.html?fu=' + encodeURIComponent(fuId) + '&k=' + crmRateToken_(fuId); }
function crmRateOpen_(p) {
  var s = crmSettings_(), id = String(p.fu || ''), k = String(p.k || '');
  if (!id || k !== crmRateToken_(id)) return { ok: false, error: 'bad_token' };
  var url = String(s.reviewUrl || '').trim();
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'no_review_url' };
  var fr = crmFind_(crmRead_('followups'), 'id', id);
  if (!fr) return { ok: false, error: 'not_found' };
  if (String(p.kind || '') === 'ok') {   // กด "ปกติดี" ในข้อความถามอาการ → บันทึกคำตอบ + วันที่ขอรีวิว แล้วเด้งไปหน้ารีวิว
    var patch = { reviewAt: String(fr.reviewAt || '') || crmNow_() };
    if (!String(fr.answeredAt || '')) {
      var tplO = crmFind_(crmRead_('templates'), 'id', fr.templateId), lblO = 'ปกติดี';
      try { JSON.parse((tplO && tplO.followupOptions) || '[]').forEach(function (o) { if (o.kind === 'ok') lblO = o.label; }); } catch (eL) {}
      patch.answer = lblO; patch.answerKind = 'ok'; patch.answeredAt = crmNow_();
    }
    var firstOk = !String(fr.answeredAt || '');
    crmUpdate_('followups', fr._row, patch); crmTouch_();
    if (firstOk && fr.lineUserId) {   // เด้งไปรีวิวแล้ว → ส่งข้อความขอบคุณ + นัดครั้งถัดไปตามเข้าแชท (คนไข้เห็นตอนกลับมา)
      try {
        var tplR = crmFind_(crmRead_('templates'), 'id', fr.templateId), replyO = '';
        try { JSON.parse((tplR && tplR.followupOptions) || '[]').forEach(function (o) { if (o.kind === 'ok' && o.reply) replyO = o.reply; }); } catch (eR) {}
        var txt = (replyO || CRM_REPLY_OK) + crmNextAptText_(fr.hn, crmAptsWithOrtho_(crmReadByName_('ตารางนัด'), crmReadByName_('ortho')));
        crmSend_(s, { done: {}, fails: {} }, { key: 'fuok:' + fr.id, type: 'followup', hn: fr.hn || '', patName: fr.patName || '', lineUserId: fr.lineUserId, refId: fr.id, detail: 'ตอบ ปกติดี → ขอบคุณ+นัดถัดไป' }, [crmText_(txt)]);
      } catch (eS) { Logger.log('fu ok thanks ' + eS); }
    }
    return { ok: true, url: url, kind: 'ok' };
  }
  if (String(fr.rating || '') === '') { crmUpdate_('followups', fr._row, { rating: '5', ratedAt: crmNow_() }); crmTouch_(); }
  return { ok: true, url: url };
}
function crmReviewMessages_(s) {
  var url = String(s.reviewUrl || '').trim();
  var thanks = crmText_('ขอบคุณมากค่ะ 💚 ดีใจที่คุณพอใจกับบริการของเรา');
  if (!/^https:\/\//i.test(url)) return [thanks];
  return [thanks, { type: 'flex', altText: 'ช่วยรีวิวคลินิกให้เราหน่อยนะคะ', contents: crmBubble_(s, '💬 ช่วยรีวิวให้เราหน่อยนะคะ', 'ถ้าคุณประทับใจ รบกวนแบ่งปันประสบการณ์ให้คนอื่นได้รู้จักเรา ใช้เวลาไม่ถึงนาทีค่ะ 🙏', [],
    [{ type: 'button', style: 'primary', color: '#1D825C', height: 'sm', action: { type: 'uri', label: '⭐ รีวิวให้เรา', uri: url } }], '#1D825C') }];
}
/* คนไข้กดยืนยันนัดทาง LINE → ตั้งสถานะนัดในชีต "ตารางนัด" เป็น คอนเฟิร์ม (เปลี่ยนเฉพาะนัดที่ยัง "ไม่คอนเฟิร์ม"/ว่าง — ไม่แตะ เสร็จสิ้น/ยกเลิก/อื่นๆ)
   นัดจัดฟันที่เป็นนัดเสมือนจากชีต ortho (ไม่มีแถวในตารางนัด) ข้าม — ระบบนับยืนยันจาก confirmedAt อยู่แล้ว */
function crmSetAptConfirmed_(x) {
  if (!x || x._ortho || !x._row || String(x.id || '').indexOf('ORTHO-') === 0) return false;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ตารางนัด'); if (!sh) return false;
  var lc = sh.getLastColumn(), hdr = sh.getRange(1, 1, 1, lc).getValues()[0];
  var cs = hdr.indexOf('status'), ci = hdr.indexOf('id'); if (cs === -1) return false;
  if (ci !== -1 && String(sh.getRange(x._row, ci + 1).getValue()) !== String(x.id)) return false;   // แถวเลื่อนไปแล้ว → ไม่เขียนผิดแถว
  var cur = String(sh.getRange(x._row, cs + 1).getValue() || '').trim();
  if (cur !== '' && cur !== 'ไม่คอนเฟิร์ม') return false;
  sh.getRange(x._row, cs + 1).setValue('คอนเฟิร์ม');
  crmTouch_();
  return true;
}
function crmHandlePostback_(s, ev, uid) {
  var data = String((ev.postback && ev.postback.data) || ''), parts = data.split('|');
  var hns = crmUserHns_(uid);
  var isTester = s.testMode && s.testUserId && uid === s.testUserId; // โหมดทดสอบ: บัญชีทดสอบกดปุ่มแทนคนไข้ได้
  if (parts[0] === 'apt') {
    var allApts = crmAptsWithOrtho_(crmReadByName_('ตารางนัด'), crmReadByName_('ortho'));
    var found = String(parts[2] || '').split(',').filter(Boolean).map(function (id) { return crmFind_(allApts, 'id', id) || crmOrthoIdFallback_(allApts, id); })
      .filter(function (x) { return x && (hns.indexOf(crmHN_(x.hn)) !== -1 || isTester); });   // ปุ่มจากการ์ดเตือนรวมหลายนัดส่ง id คั่นด้วย ,
    if (!found.length) { crmReply_(ev.replyToken, [crmText_('ไม่พบนัดหมายนี้ในบัญชีของคุณ กรุณาติดต่อคลินิก ' + s.clinicPhone)]); return; }
    found.sort(function (x, y) { return String(x.time || '').localeCompare(String(y.time || '')); });
    var apt = found[0], aptId = found.map(function (x) { return x.id; }).join(',');
    var aptRows = crmRead_('apt'), now = crmNow_();
    var aptLine = function (x) { return crmDateOnly_(x.date) + ' ' + (x.time || '') + (x.proc ? ' (' + x.proc + ')' : '') + (x.docName ? ' ' + x.docName : ''); };
    var recAct = function (x, fields) {
      var ar = crmFind_(aptRows, 'aptId', x.id);
      if (ar) crmUpdate_('apt', ar._row, fields);
      else { var o = { aptId: x.id, hn: x.hn }; for (var f in fields) o[f] = fields[f]; crmAppend_('apt', o); }
    };
    if (parts[1] === 'confirm') {
      found.forEach(function (x) { recAct(x, { confirmedAt: now, lastAction: 'confirm', updatedAt: now }); });
      found.forEach(function (x) { try { crmSetAptConfirmed_(x); } catch (eC) { Logger.log('crmSetAptConfirmed_ ' + eC); } });   // อัปเดตสถานะในตารางนัด (ดูนัด) เป็น "คอนเฟิร์ม" อัตโนมัติ
      crmReply_(ev.replyToken, [crmText_(s.confirmThanksText + found.map(function (x) { return '\n\n📅 ' + crmThaiDate_(crmDateOnly_(x.date)) + ' เวลา ' + (x.time || '-') + ' น.' + (found.length > 1 && x.proc ? ' (' + x.proc + ')' : ''); }).join(''))]);
    } else if (parts[1] === 'resched') {
      found.forEach(function (x) { recAct(x, { rescheduleAt: now, lastAction: 'reschedule', updatedAt: now }); });
      var open = crmRead_('tasks').filter(function (t) { return t.type === 'reschedule' && t.status === 'open' && String(t.aptId) === String(aptId); })[0];
      var task = open || crmCreateTask_({ type: 'reschedule', priority: 'normal', hn: apt.hn, patName: apt.patName, lineUserId: uid, aptId: aptId,
        aptDate: crmDateOnly_(apt.date), aptTime: apt.time, detail: 'คนไข้ขอเลื่อนนัด ' + found.map(aptLine).join(' + ') });
      var prefs = ['ช่วงเช้า', 'ช่วงบ่าย', 'ช่วงเย็น', 'วันเสาร์-อาทิตย์', 'ให้โทรคุย'];
      crmReply_(ev.replyToken, [{ type: 'text', text: s.rescheduleText,
        quickReply: { items: prefs.map(function (p) { return { type: 'action', action: { type: 'postback', label: p, data: 'pref|' + task.id + '|' + p, displayText: p } }; }) } }]);
    }
    return;
  }
  if (parts[0] === 'pref') {
    var tasks = crmRead_('tasks'), tk = crmFind_(tasks, 'id', parts[1]);
    if (tk && (tk.lineUserId === uid || isTester)) crmUpdate_('tasks', tk._row, { preference: parts[2], updatedAt: crmNow_() });
    crmReply_(ev.replyToken, [crmText_('รับทราบค่ะ 🙏 พนักงานจะติดต่อกลับเพื่อยืนยันวันเวลาใหม่')]);
    return;
  }
  if (parts[0] === 'fu') {
    var fus = crmRead_('followups'), fu = crmFind_(fus, 'id', parts[1]);
    if (!fu || (fu.lineUserId !== uid && hns.indexOf(crmHN_(fu.hn)) === -1 && !isTester)) { crmReply_(ev.replyToken, [crmText_('ขอบคุณค่ะ หากต้องการติดต่อคลินิกโทร ' + s.clinicPhone)]); return; }
    var tpl = crmFind_(crmRead_('templates'), 'id', fu.templateId), opts = [];
    try { opts = JSON.parse((tpl && tpl.followupOptions) || '[]'); } catch (e) {}
    var opt = opts[+parts[2]] || { label: '?', kind: 'callback', reply: CRM_REPLY_CALLBACK };
    var taskId = fu.taskId;
    if (opt.kind === 'severe' || opt.kind === 'emergency' || opt.kind === 'callback') {
      var pr = opt.kind === 'emergency' ? 'urgent' : (opt.kind === 'severe' ? 'high' : 'normal');
      var tk2 = crmCreateTask_({ type: opt.kind === 'emergency' ? 'emergency' : 'callback', priority: pr, hn: fu.hn, patName: fu.patName, lineUserId: uid,
        detail: 'ติดตามอาการหลัง' + fu.proc + ' (' + fu.treatDate + '): ' + opt.label });
      taskId = tk2.id;
    }
    crmUpdate_('followups', fu._row, { answer: opt.label, answerKind: opt.kind, answeredAt: crmNow_(), taskId: taskId || '' });
    var reply;
    if (opt.kind === 'emergency') reply = crmEmergencyText_(s); // ตอบรับเฉย ๆ + งานด่วน (ไม่แนะนำทางการแพทย์)
    else {
      reply = opt.reply || (opt.kind === 'ok' ? CRM_REPLY_OK : CRM_REPLY_CALLBACK);
      if (opt.kind === 'ok' && reply === CRM_REPLY_OK_OLD) reply = CRM_REPLY_OK;
      if (opt.kind === 'ok') reply += crmNextAptText_(fu.hn, crmAptsWithOrtho_(crmReadByName_('ตารางนัด'), crmReadByName_('ortho')));
    }
    var out = reply ? [crmText_(reply)] : [];
    if (opt.kind === 'ok' && crmRatingApplies_(s, fu)) out.push(crmRatingMessage_(s, fu));
    else if (opt.kind === 'ok' && s.reviewOnOk === true && /^https:\/\//i.test(String(s.reviewUrl || '').trim()) && (function () {
      var dn = []; try { crmReadByName_('บันทึกการรักษา').forEach(function (x) { if (crmHN_(x.hn) === crmHN_(fu.hn) && crmDateOnly_(x.date) === crmDateOnly_(fu.treatDate) && x.docName && dn.indexOf(x.docName) === -1) dn.push(x.docName); }); } catch (eD) {}
      return crmReviewAllowed_(s, dn, fu.templateId); })()) {
      // ปกติดี → การ์ดไปหน้ารีวิว Google (คนไข้คนเดียวกันไม่เกิน 1 ครั้งต่อ 360 วัน กันรบกวน)
      var since = crmAddDays_(crmToday_(), -360), hk = crmHN_(fu.hn);
      var askedRecently = crmRead_('followups').some(function (r) { return crmHN_(r.hn) === hk && r.reviewAt && String(r.reviewAt).slice(0, 10) > since; });
      if (!askedRecently) {
        var rv = crmReviewMessages_(s); if (rv.length > 1) { out.push(rv[1]); crmUpdate_('followups', fu._row, { reviewAt: crmNow_() }); }
      }
    }
    if (out.length) crmReply_(ev.replyToken, out);
    return;
  }
  if (parts[0] === 'rate') {
    var fr = crmFind_(crmRead_('followups'), 'id', parts[1]);
    if (!fr || (fr.lineUserId !== uid && hns.indexOf(crmHN_(fr.hn)) === -1 && !isTester)) { crmReply_(ev.replyToken, [crmText_('ขอบคุณค่ะ 🙏')]); return; }
    if (String(fr.rating || '') !== '') { crmReply_(ev.replyToken, [crmText_('ขอบคุณที่ให้คะแนนแล้วค่ะ 🙏')]); return; }
    var n = parseInt(parts[2], 10);
    if (!(n >= 0 && n <= 5)) return;
    crmUpdate_('followups', fr._row, { rating: String(n), ratedAt: crmNow_() });
    if (n === 5) { crmReply_(ev.replyToken, crmReviewMessages_(s)); return; }
    if (n === 4) { crmReply_(ev.replyToken, [crmText_('ขอบคุณสำหรับคะแนนค่ะ 🙏 เราจะพัฒนาบริการให้ดียิ่งขึ้น')]); return; }
    crmCreateTask_({ type: 'lowrating', priority: 'normal', hn: fr.hn, patName: fr.patName, lineUserId: uid,
      detail: 'คนไข้ให้คะแนนบริการ ' + n + '/5 หลัง' + fr.proc + ' (' + fr.treatDate + ') — ควรโทรสอบถามความไม่พอใจ' });
    crmReply_(ev.replyToken, [crmText_('ขอบคุณที่บอกเราค่ะ 🙏 ขออภัยหากบริการยังไม่ดีพอ ทีมงานจะติดต่อกลับเพื่อรับฟังและปรับปรุงค่ะ')]);
  }
}
function crmEmergencyText_(s) { return String(s.emergencyText || '').trim(); }
function crmHandleText_(s, ev, uid) {
  var text = String(ev.message.text || '');
  if (crmHasWord_(text, crmSplitList_(s.emergencyKeywords))) {
    var hns = crmUserHns_(uid), name = '';
    if (hns.length) { var l = crmRead_('links').filter(function (x) { return x.lineUserId === uid && x.status === 'active'; })[0]; name = l ? l.patName : ''; }
    // ส่งข้อความฉุกเฉินหลายข้อความติดกัน → รวมในงานเดิมที่ยังเปิดอยู่ (ภายใน 30 นาที) ไม่สร้างงานซ้ำ
    var lim = Utilities.formatDate(new Date(Date.now() - 30 * 60000), CRM_TZ, 'yyyy-MM-dd HH:mm');
    var openT = crmRead_('tasks').filter(function (x) { return x.type === 'emergency' && x.status === 'open' && x.lineUserId === uid && String(x.createdAt) >= lim; })[0];
    if (openT) crmUpdate_('tasks', openT._row, { detail: String(openT.detail || '').slice(0, 1500) + '\n+ ' + text.slice(0, 300), updatedAt: crmNow_() });
    else crmCreateTask_({ type: 'emergency', priority: 'urgent', hn: hns[0] || '', patName: name, lineUserId: uid, detail: 'ข้อความจากคนไข้: ' + text.slice(0, 300) });
    var ack = crmEmergencyText_(s);
    if (ack) crmReply_(ev.replyToken, [crmText_(ack)]);
    return;
  }
  // ขอเลื่อนนัด / ยืนยันนัด (ปุ่มในการ์ดส่งเป็นข้อความจริง หรือคนไข้พิมพ์เอง) → จับคู่นัดข้างหน้าของคนไข้แล้วเข้ากระบวนการเดียวกับปุ่มเดิม
  var tm = text.replace(/\s+/g, ' ').trim(), aptWord = /^ขอเลื่อนนัด(\s|$)/.test(tm) ? 'resched' : (/^ยืนยันนัด(\s|$)/.test(tm) ? 'confirm' : '');
  if (aptWord && tm.length <= 40) {
    var hnR = crmUserHns_(uid);
    if (!hnR.length) { crmReply_(ev.replyToken, [crmText_('รับเรื่องแล้วค่ะ 🙏 กรุณาผูกบัญชีคนไข้ก่อน หรือโทร ' + s.clinicPhone)]); return; }
    var today = crmToday_(), allR = crmAptsWithOrtho_(crmReadByName_('ตารางนัด'), crmReadByName_('ortho'));
    var mine = allR.filter(function (x) { return hnR.indexOf(crmHN_(x.hn)) !== -1 && crmDateOnly_(x.date) >= today; });
    var dm = tm.match(/(\d{1,2})\/(\d{1,2})/), pick = [];
    if (dm) pick = mine.filter(function (x) { var d = crmDateOnly_(x.date); return parseInt(d.slice(8, 10), 10) === +dm[1] && parseInt(d.slice(5, 7), 10) === +dm[2]; });
    if (!pick.length) {
      var minD = ''; mine.forEach(function (x) { var d = crmDateOnly_(x.date); if (!minD || d < minD) minD = d; });
      pick = mine.filter(function (x) { return crmDateOnly_(x.date) === minD; });
    }
    if (!pick.length) { crmReply_(ev.replyToken, [crmText_('ไม่พบนัดล่วงหน้าของคุณค่ะ หากมีข้อสงสัย กรุณาโทร ' + s.clinicPhone)]); return; }
    crmHandlePostback_(s, { replyToken: ev.replyToken, postback: { data: 'apt|' + aptWord + '|' + pick.map(function (x) { return x.id; }).join(',') } }, uid);
    return;
  }
  var t = text.replace(/\s/g, '');
  if (/^(นัด|ดูนัด|นัดครั้งถัดไป)$/.test(t)) {
    var hn2 = crmUserHns_(uid);
    if (!hn2.length) { crmReply_(ev.replyToken, [crmWelcome_(s)]); return; }
    var apts = crmAptsWithOrtho_(crmReadByName_('ตารางนัด'), crmReadByName_('ortho')), lines = [];
    hn2.forEach(function (h) { var x = crmNextAptText_(h, apts, crmAddDays_(crmToday_(), -1)); if (x) lines.push(x.trim()); });
    crmReply_(ev.replyToken, [crmText_(lines.length ? lines.join('\n') : 'ยังไม่มีนัดครั้งถัดไปค่ะ ติดต่อนัดได้ที่ ' + s.clinicPhone)]);
  } else if (/^(ผูกบัญชี|ลงทะเบียน)$/.test(t)) {
    crmReply_(ev.replyToken, [crmWelcome_(s)]);
  }
  // ข้อความอื่น ๆ → แจ้งแอดมินทาง LINE (เหมือนจุดเขียวในแชท OA) แล้วให้พนักงานตอบผ่าน LINE OA Chat ตามปกติ
  if (!/^(นัด|ดูนัด|นัดครั้งถัดไป|ผูกบัญชี|ลงทะเบียน)$/.test(t)) {
    try {
      var cacheM = CacheService.getScriptCache(), ck = 'crm_msgn_' + uid;
      if (crmSplitList_(s.staffNotifyIds).indexOf(uid) === -1 && !cacheM.get(ck)) {   // ไม่แจ้งเมื่อแอดมินพิมพ์เอง · คนเดิมพิมพ์ซ้ำภายใน 15 นาที แจ้งครั้งเดียว
        cacheM.put(ck, '1', 900);
        var who = crmNameOfUid_(uid);
        crmNotifyStaff_(s, { id: 'MSG-' + Date.now(), type: 'message', priority: 'normal', hn: who.hn, patName: who.name, lineUserId: uid, detail: 'ข้อความ: ' + text.slice(0, 200) });
      }
    } catch (eM) { Logger.log('notify message ' + eM); }
  }
  // (เดิม) ข้อความอื่น ๆ ปล่อยให้พนักงานตอบผ่าน LINE OA Chat ตามปกติ (ไม่มี AI ตอบแทน)
}

/* ============================ PATIENT PORTAL (LIFF) ============================ */
/* ยืนยันตัวตนจาก LINE ฝั่งเซิร์ฟเวอร์ — ไม่เชื่อ userId ที่หน้าเว็บส่งมาเอง */
function crmVerifyUser_(p) {
  var cache = CacheService.getScriptCache();
  var tok = p.idToken || p.accessToken || '';
  if (!tok) return null;
  var h = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tok)).slice(0, 40);
  var c = cache.get('crm_tok_' + h);
  if (c) { try { return JSON.parse(c); } catch (e) {} }
  var user = null;
  if (p.idToken) {
    var r = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'post', muteHttpExceptions: true,
      payload: { id_token: p.idToken, client_id: crmChannelId_() } });
    if (r.getResponseCode() === 200) { var d = JSON.parse(r.getContentText()); user = { userId: d.sub, name: d.name || '' }; }
  } else {
    var v = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(p.accessToken), { muteHttpExceptions: true });
    if (v.getResponseCode() === 200) {
      var vd = JSON.parse(v.getContentText());
      if (String(vd.client_id) === String(crmChannelId_())) {
        var pr = UrlFetchApp.fetch('https://api.line.me/v2/profile', { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + p.accessToken } });
        if (pr.getResponseCode() === 200) { var pd = JSON.parse(pr.getContentText()); user = { userId: pd.userId, name: pd.displayName || '' }; }
      }
    }
  }
  if (user) cache.put('crm_tok_' + h, JSON.stringify(user), 900);
  return user;
}
/* หน้าคนไข้ (rich menu) แบบแคช 2 นาทีต่อคน · ข้อมูล CRM/ตารางนัด/การรักษาเปลี่ยน (บันทึกจากแอป) = คำนวณใหม่ทันที */
function crmPortalJson_(p) {
  var u = crmVerifyUser_(p);
  if (!u) return JSON.stringify({ ok: false, error: 'auth' });
  var c = CacheService.getScriptCache();
  var g = c.getAll(['crm_gen', 'ga2g:appointments', 'ga2g:treatments']);
  var ver = [g['crm_gen'] || '', g['ga2g:appointments'] || '', g['ga2g:treatments'] || ''].join('|');
  var key = 'crm_portal_' + u.userId;
  try { var hit = JSON.parse(c.get(key) || 'null'); if (hit && hit.v === ver) return hit.j; } catch (e) {}
  var json = JSON.stringify(crmPortal_(p));
  try { if (json.length < 30000) c.put(key, JSON.stringify({ v: ver, j: json }), 120); } catch (e) {}
  return json;
}
function crmPortal_(p) {
  var u = crmVerifyUser_(p);
  if (!u) return { ok: false, error: 'auth' };
  var links = crmRead_('links').filter(function (l) { return l.lineUserId === u.userId; });
  var active = {}, pending = [];
  links.forEach(function (l) {
    if (l.status === 'active') active[crmHN_(l.hn)] = { hn: l.hn, name: l.patName, consent: String(l.consent).toUpperCase() !== 'FALSE', birthday: String(l.birthday || '') };
    else if (l.status === 'pending') pending.push({ name: l.inputName || l.patName, createdAt: l.createdAt });
  });
  var orthoRows = crmReadByName_('ortho');
  orthoRows.forEach(function (o) { if (o.lineUserId === u.userId && !active[crmHN_(o.hn)]) active[crmHN_(o.hn)] = { hn: o.hn, name: o['ชื่อ'], consent: true }; });
  var keys = Object.keys(active);
  var today = crmToday_();
  var hnSet = {}; keys.forEach(function (k) { hnSet[k] = true; });
  var apts = keys.length ? crmReadByNameWhere_('ตารางนัด', crmHnTest_(hnSet)) : [];
  var treats = keys.length ? crmReadByNameWhere_('บันทึกการรักษา', crmHnTest_(hnSet)) : [];
  var logs = keys.length ? crmReadByNameWhere_('ortho_log', crmHnTest_(hnSet)) : [];
  var patients = keys.map(function (k) {
    var a = active[k];
    var next = apts.filter(function (x) { return crmHN_(x.hn) === k && crmDateOnly_(x.date) >= today && ['ยกเลิก', 'เสร็จสิ้น', 'เสร็จ'].indexOf(x.status) === -1; })
      .map(function (x) { return { id: x.id, date: crmDateOnly_(x.date), time: x.time || '', proc: x.proc || '', docName: x.docName || '' }; })
      .sort(function (x, y) { return (x.date + x.time).localeCompare(y.date + y.time); }).slice(0, 5);
    // นัดจัดฟัน (เก็บแยกในชีตจัดฟัน คอลัมน์ นัดถัดไป) รวมเข้ารายการนัด · ซ้ำกับตารางนัดเมื่อวัน+เวลาตรงกัน ให้ใช้รายการตารางนัด
    var oNext = null;
    for (var oi = 0; oi < orthoRows.length; oi++) if (crmHN_(orthoRows[oi].hn) === k) { oNext = orthoRows[oi]; break; }
    if (oNext) {
      var od = crmDateOnly_(oNext['นัดถัดไป']);
      if (od && od >= today) {
        var ot = String(oNext['นัดถัดไปเวลา'] || '').trim().slice(0, 5);
        var dup = apts.some(function (x) { return crmHN_(x.hn) === k && crmDateOnly_(x.date) === od && (!ot || !x.time || String(x.time).slice(0, 5) === ot) && crmSameDoc_(x.docName, oNext['หมอ']); });
        if (!dup) {
          next.push({ id: 'ortho-' + k, date: od, time: ot, proc: oNext['รายการนัดถัดไป'] || 'นัดจัดฟัน', docName: oNext['หมอ'] || '', kind: 'ortho' });
          next.sort(function (x, y) { return (x.date + x.time).localeCompare(y.date + y.time); });
          if (next.length > 5) next = next.slice(0, 5);
        }
      }
    }
    var hist = treats.filter(function (x) { return crmHN_(x.hn) === k && crmDateOnly_(x.date) && crmDateOnly_(x.date) <= today; })
      .map(function (x) { return { date: crmDateOnly_(x.date), proc: x.proc || '', docName: x.docName || '' }; })
      .sort(function (x, y) { return y.date.localeCompare(x.date); }).slice(0, 40);
    var oRow = null;
    for (var i = 0; i < orthoRows.length; i++) if (crmHN_(orthoRows[i].hn) === k) { oRow = orthoRows[i]; break; }
    var ortho = null;
    if (oRow) {
      var prof = {}; for (var f in oRow) if (f !== '_row' && f !== 'lineUserId' && f !== 'ค่ารักษารวม' && f !== 'จ่ายแล้ว' && f !== 'คงเหลือ') prof[f] = oRow[f];
      ortho = { profile: prof, logs: logs.filter(function (l) { return crmHN_(l.hn) === k; }).map(function (l) { var o = {}; for (var f2 in l) if (f2 !== '_row') o[f2] = l[f2]; return o; })
        .sort(function (x, y) { return String(y['วันที่']).localeCompare(String(x['วันที่'])); }) };
    }
    return { hn: a.hn, name: a.name, consent: a.consent, next: next, history: hist, ortho: ortho };
  });
  var s = crmSettings_();
  return { ok: true, user: { name: u.name }, patients: patients, pending: pending, clinicPhone: s.clinicPhone, clinicName: s.clinicName };
}
function crmBind_(p) {
  var r = crmBindCore_(p);
  if (r && r.ok && p.bday) { try { crmBirthdaySave_(crmVerifyUser_(p), p.hn, p.bday); } catch (e) {} }   // วันเกิด (ไม่บังคับ) เพื่อรับสิทธิ์เดือนเกิด
  if (r && r.ok) { try { r.portal = crmPortal_(p); } catch (e) {} }   // ส่งข้อมูลหน้าหลักกลับพร้อมกัน ลดการเรียกเซิร์ฟเวอร์ซ้ำ
  return r;
}
function crmBindCore_(p) {
  var u = crmVerifyUser_(p);
  if (!u) return { ok: false, error: 'auth' };
  if (String(p.consent) !== '1') return { ok: false, error: 'consent_required' };
  var phone = crmPhone_(p.phone), name = crmNameKey_(p.name), code = String(p.code || '').trim().toUpperCase();
  var hnIn = crmHN_(p.hn);                       // ผูกด้วย HN (6-7 หลัก เช่น 65-9385 หรือ 65-12345) + เบอร์โทร
  if (phone.length < 9 || !hnIn) return { ok: false, error: 'missing_field' };   // บังคับ HN + เบอร์เสมอ (ไม่รับผูกด้วยชื่อ)
  if (hnIn && !/^\d{6,7}$/.test(hnIn)) return { ok: false, error: 'hn_format' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = crmSettings_(), now = crmNow_();
    var phIx = -2;
    var pats = crmReadByNameWhere_('คนไข้', function (row, hdr) {
      if (phIx === -2) phIx = crmColIdx_(hdr, ['phone', 'เบอร์โทร', 'เบอร์']);
      return phIx >= 0 && crmPhone_(row[phIx]) === phone;
    });
    var matches = pats.filter(function (r) {
      if (crmPhone_(r.phone || r['เบอร์โทร'] || r['เบอร์'] || '') !== phone) return false;
      if (hnIn) return crmHN_(r.hn) === hnIn;
      var nm = crmNameKey_(r.name || r['ชื่อ'] || '');
      var first = name.split(' ')[0];
      return nm && first && (nm.indexOf(first) !== -1 || first.indexOf(nm.split(' ')[0]) === 0);
    });
    var codeOk = false;
    if (code) {
      var o = crmReadByName_('ortho').filter(function (r) { return String(r['รหัสประจำตัว'] || '').trim().toUpperCase() === code; })[0];
      if (o) {
        var m2 = matches.filter(function (m) { return crmHN_(m.hn) === crmHN_(o.hn); });
        if (m2.length) { matches = m2; codeOk = true; }
      }
    }
    var existing = crmRead_('links').filter(function (l) { return l.lineUserId === u.userId; });
    var auto = matches.length >= 1;   // HN + เบอร์ตรงทะเบียนคนไข้ = ผูกอัตโนมัติเสมอ (ไม่ตรง → รอพนักงาน)
    // คนไข้จัดฟัน: HN + เบอร์ตรงทะเบียนคนไข้ และ HN นั้นมีแถวในชีตจัดฟัน → อนุมัติอัตโนมัติ (ข้อมูลจัดฟันขึ้นทันทีโดยไม่ต้องรอพนักงาน)
    var orthoAuto = {};
    if (hnIn && matches.length) {
      crmReadByName_('ortho').forEach(function (o) { var k = crmHN_(o.hn); if (k) orthoAuto[k] = true; });
    }
    var anyActive = auto;
    var created = [];
    if (!matches.length) {
      if (!existing.some(function (l) { return l.status === 'pending' && crmPhone_(l.inputPhone) === phone; })) {
        crmAppend_('links', { id: crmId_('LK'), lineUserId: u.userId, hn: '', patName: '', status: 'pending', source: 'self', consent: 'TRUE',
          displayName: u.name, inputName: hnIn ? ('HN ' + p.hn) : p.name, inputPhone: p.phone, createdAt: now, note: 'ไม่พบเบอร์+ชื่อที่ตรงกันในรายชื่อคนไข้' });
      }
      return { ok: true, status: 'pending', matched: 0 };
    }
    matches.forEach(function (m) {
      var auto = true;
      if (auto) anyActive = true;
      var by = codeOk ? 'รหัสจัดฟัน' : (orthoAuto[crmHN_(m.hn)] ? 'HN จัดฟัน' : 'HN+เบอร์ตรง');
      var already = existing.filter(function (l) { return crmHN_(l.hn) === crmHN_(m.hn) && l.status !== 'revoked'; })[0];
      if (already) { if (auto && already.status === 'pending') crmUpdate_('links', already._row, { status: 'active', approvedBy: by, approvedAt: now }); return; }
      crmAppend_('links', { id: crmId_('LK'), lineUserId: u.userId, hn: m.hn, patName: m.name || m['ชื่อ'] || '', status: auto ? 'active' : 'pending',
        source: codeOk ? 'ortho-code' : (orthoAuto[crmHN_(m.hn)] ? 'ortho-hn' : 'self'), consent: 'TRUE', displayName: u.name, inputName: hnIn ? ('HN ' + p.hn) : p.name, inputPhone: p.phone, createdAt: now,
        approvedBy: auto ? by : '', approvedAt: auto ? now : '' });
      created.push(m.hn);
    });
    if (codeOk) { try { orthoSetLineId(crmHN_(matches[0].hn), u.userId, matches[0].name || ''); } catch (e) {} }
    return { ok: true, status: anyActive ? 'active' : 'pending', matched: matches.length };
  } finally { lock.releaseLock(); }
}
/* วันเกิด (เก็บเฉพาะ วัน-เดือน รูปแบบ MM-DD ในแถวผูกบัญชีของ HN นั้น) */
function crmBdayNorm_(v) {
  var m = String(v || '').match(/^(\d{1,2})-(\d{1,2})$/); if (!m) return '';
  var mo = +m[1], d = +m[2];
  if (mo < 1 || mo > 12 || d < 1 || d > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]) return '';
  return ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}
function crmBirthdaySave_(u, hn, bday) {
  var md = crmBdayNorm_(bday); if (!u || !md) return 0;
  var k = crmHN_(hn), n = 0;
  crmRead_('links').forEach(function (l) {
    if (l.lineUserId !== u.userId || l.status === 'revoked' || l.status === 'rejected') return;
    if (crmHN_(l.hn) && k && crmHN_(l.hn) !== k) return;
    crmUpdate_('links', l._row, { birthday: md }); n++;
  });
  return n;
}
function crmBirthday_(p) {
  var u = crmVerifyUser_(p);
  if (!u) return { ok: false, error: 'auth' };
  if (!crmBdayNorm_(p.bday)) return { ok: false, error: 'bad_date' };
  var n = crmBirthdaySave_(u, p.hn, p.bday);
  return n ? { ok: true } : { ok: false, error: 'no_link' };
}
var CRM_TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
function crmConsent_(p) {
  var u = crmVerifyUser_(p);
  if (!u) return { ok: false, error: 'auth' };
  var on = String(p.on) === '1' ? 'TRUE' : 'FALSE';
  var links = crmRead_('links'), have = {};
  links.forEach(function (l) {
    if (l.lineUserId !== u.userId || l.status !== 'active') return;
    have[crmHN_(l.hn)] = true; crmUpdate_('links', l._row, { consent: on });
  });
  // คนไข้จัดฟันที่ผูกด้วยระบบเดิม (มีแค่ lineUserId ในชีตจัดฟัน ไม่มีแถว crm_links) → สร้างแถวลิงก์เก็บค่ายินยอม ไม่งั้นปิดรับข้อความไม่ได้ผล
  crmReadByName_('ortho').forEach(function (o) {
    var k = crmHN_(o.hn);
    if (o.lineUserId !== u.userId || !k || have[k]) return;
    have[k] = true;
    crmAppend_('links', { id: crmId_('LK'), lineUserId: u.userId, hn: o.hn, patName: o['ชื่อ'] || '', status: 'active', source: 'ortho-legacy', consent: on,
      displayName: u.name, createdAt: crmNow_(), approvedBy: 'ระบบจัดฟันเดิม', approvedAt: crmNow_() });
  });
  return { ok: true, consent: on === 'TRUE' };
}

/* ============================ STAFF DASHBOARD ============================ */
/* แดชบอร์ดแบบแคช: เก็บผลไว้ใน CacheService (แบ่งก้อน) สูงสุด 90 วิ · มีการเขียนข้อมูล CRM (crmTouch_) = คำนวณใหม่ */
function crmDashboardJson_(fresh) {
  var c = CacheService.getScriptCache(), gen = c.get('crm_gen') || 'g0';
  if (!fresh) {
    try {
      var meta = JSON.parse(c.get('crm_dash_meta') || 'null');
      if (meta && meta.gen === gen && Date.now() - meta.at < 90000) {
        var keys = []; for (var i = 0; i < meta.n; i++) keys.push('crm_dash_' + i);
        var got = c.getAll(keys), parts = [];
        for (var j = 0; j < meta.n; j++) { if (got['crm_dash_' + j] === undefined || got['crm_dash_' + j] === null) { parts = null; break; } parts.push(got['crm_dash_' + j]); }
        if (parts) return parts.join('');
      }
    } catch (e) {}
  }
  var json = JSON.stringify(crmDashboard_());
  try {
    var put = {}, n = 0, CH = 30000;
    for (var k = 0; k < json.length; k += CH) put['crm_dash_' + (n++)] = json.slice(k, k + CH);
    if (n <= 60) { c.putAll(put, 120); c.put('crm_dash_meta', JSON.stringify({ gen: gen, at: Date.now(), n: n }), 120); }
  } catch (e) {}
  return json;
}
function crmDashboard_() {
  var s = crmSettings_();
  var since = crmAddDays_(crmToday_(), -45);
  var stats = {};
  // log: อ่านค่าดิบรอบเดียว — นับสถิติทุกแถว แต่แปลงเป็น object เฉพาะแถวย้อนหลัง 45 วัน (เร็วกว่าแปลงทั้งชีตมาก)
  crmSheet_('log');
  var ci = -2, si = 0, ti = 0, pi = 0;
  var logRows = crmReadByNameWhere_(CRM_SHEET_NAMES.log, function (row, hdr) {
    if (ci === -2) { ci = crmColIdx_(hdr, ['createdAt']); si = crmColIdx_(hdr, ['status']); ti = crmColIdx_(hdr, ['type']); pi = crmColIdx_(hdr, ['pushCount']); }
    if (ci < 0) return false;
    var ca = String(row[ci] || ''), st = String(row[si] || '');
    if (ca) {
      var m = ca.slice(0, 7);
      if (st === 'sent' || st === 'test' || st === 'failed') {
        stats[m] = stats[m] || { sent: 0, test: 0, failed: 0, byType: {} };
        var pc = (st === 'failed') ? 1 : (+row[pi] || 0);
        stats[m][st] += pc;
        if (st === 'sent') stats[m].byType[row[ti]] = (stats[m].byType[row[ti]] || 0) + (+row[pi] || 0);
      }
    }
    return ca.slice(0, 10) >= since && st !== 'done' && st !== 'seen';
  });
  // รวมสถิติของ log ที่ย้ายไป archive แล้ว
  try {
    var arch = JSON.parse(crmProp_('CRM_LOG_STATS', '{}')) || {};
    Object.keys(arch).forEach(function (mo) {
      var a = arch[mo], o = stats[mo] = stats[mo] || { sent: 0, test: 0, failed: 0, byType: {} };
      o.sent += +a.sent || 0; o.test += +a.test || 0; o.failed += +a.failed || 0;
      Object.keys(a.byType || {}).forEach(function (t) { o.byType[t] = (o.byType[t] || 0) + (+a.byType[t] || 0); });
    });
  } catch (e) {}
  var log = logRows.map(function (r) { delete r._row; return r; }).slice(-2500);
  var strip = function (rows) { return rows.map(function (r) { delete r._row; return r; }); };
  var recent = function (key, col, from) {
    crmSheet_(key);
    var ix = -2; return strip(crmReadByNameWhere_(CRM_SHEET_NAMES[key], function (row, hdr) { if (ix === -2) ix = crmColIdx_(hdr, [col]); return ix >= 0 && String(row[ix] || '').slice(0, 10) >= from; }));
  };
  // followups: 45 วันล่าสุด + แถวที่มีคะแนนย้อนหลัง 400 วัน (ไว้ทำสถิติคะแนนแยกหมอ)
  var recentRated = function (key, col, from, ratedFrom) {
    crmSheet_(key);
    var ix = -2, rx = -2;
    return strip(crmReadByNameWhere_(CRM_SHEET_NAMES[key], function (row, hdr) {
      if (ix === -2) { ix = crmColIdx_(hdr, [col]); rx = crmColIdx_(hdr, ['rating']); }
      if (ix < 0) return false;
      var d = String(row[ix] || '').slice(0, 10);
      return d >= from || (rx >= 0 && String(row[rx] === 0 ? '0' : (row[rx] || '')) !== '' && d >= ratedFrom);
    }));
  };
  var tasks = crmRead_('tasks').filter(function (t) { return t.status === 'open' || String(t.updatedAt).slice(0, 10) >= crmAddDays_(crmToday_(), -60); });
  var triggers = null;
  try { var cc = CacheService.getScriptCache().get('crm_trig'); if (cc) triggers = JSON.parse(cc); } catch (e) {}
  if (!triggers) {
    triggers = [];
    try { triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) {}
    try { CacheService.getScriptCache().put('crm_trig', JSON.stringify(triggers), 300); } catch (e) {}
  }
  var lastTick = null; try { lastTick = JSON.parse(crmProp_('CRM_LAST_TICK', 'null')); } catch (e) {}
  var quota = null; try { quota = crmQuota_(); } catch (e) {}
  var links = crmRead_('links'), orthoAll = crmReadByName_('ortho'), followersAll = crmRead_('followers');
  return { ok: true, caps: { orthoTreat: true, confirmOne: true, followerDelete: true }, settings: s, templates: strip(crmRead_('templates')), tasks: strip(tasks),
    followups: recentRated('followups', 'sentAt', since, crmAddDays_(crmToday_(), -400)),
    links: strip(links.slice()), followers: strip(followersAll.slice()), apt: strip(crmRead_('apt')),
    casenotes: recent('casenotes', 'createdAt', since),
    campaigns: strip(crmRead_('campaigns')), log: log, stats: stats, quota: quota, lastTick: lastTick,
    linked: crmLinkMap_(links, orthoAll, followersAll), orthoActive: orthoAll.filter(function (o) { return !o['สถานะ'] || o['สถานะ'] === 'กำลังจัด'; }).map(function (o) { return crmHN_(o.hn); }),
    tickInstalled: triggers.indexOf('crmTick') !== -1, liffUrl: crmLiffUrl_(''), richMenu: crmProp_('CRM_RICHMENU_ID', ''),
    tokenSet: !!crmToken_(), now: crmNow_() };
}

function crmStaffAction_(b) {
  var act = b.crm, by = String(b.by || '').slice(0, 60), now = crmNow_();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (act === 'saveSettings') {
      var old = crmSettings_(), inc = b.settings || {}, s = {};
      for (var k in old) s[k] = old[k];
      var allowed = ['enabled','testMode','testUserId','sendStart','sendEnd','confirmOn','remindOn','remindHour','orthoDays','otherDays','orthoKeywords',
        'receiptOn','receiptWaitMin','aftercareOn','aftercareDelayMin','birthdayOn','birthdayText','followupOn','followupHour','ratingOn','reviewOnOk','reviewDocRules','oaChatBase','ratingTpls','reviewUrl','clinicName','clinicPhone','linkApproval','quotaGuard','emergencyKeywords','emergencyText','rescheduleText','confirmThanksText','staffNotifyOn','staffNotifyIds','staffNotifyTypes'];
      allowed.forEach(function (k2) { if (inc[k2] !== undefined) s[k2] = inc[k2]; });
      ['enabled','testMode','confirmOn','remindOn','receiptOn','aftercareOn','birthdayOn','followupOn','ratingOn','reviewOnOk','staffNotifyOn'].forEach(function (k3) { s[k3] = (s[k3] === true || s[k3] === 'true' || s[k3] === 'TRUE'); });
      if (s.enabled && s.testMode && !s.testUserId) return { ok: false, error: 'โหมดทดสอบต้องเลือกบัญชี LINE สำหรับทดสอบก่อน' };
      var baseline = 0;
      crmSaveSettingsRaw_(s);
      if (s.enabled && (!old.enabled || old.testMode !== s.testMode)) baseline = crmBaseline_(s);
      return { ok: true, baseline: baseline };
    }
    if (act === 'staffNotifyTest') {   // ปุ่ม "ส่งทดสอบ" ในตั้งค่า — ส่งถึงแอดมินที่เลือกไว้ทันที
      var sT = crmSettings_();
      if (!crmSplitList_(sT.staffNotifyIds).length) return { ok: false, error: 'ยังไม่ได้เลือกบัญชีแอดมิน (เลือกแล้วกดบันทึกก่อน)' };
      var nT = crmNotifyStaff_(sT, { id: 'TEST-' + Date.now(), type: 'reschedule', priority: 'normal', patName: 'ทดสอบ ระบบ', hn: '00-00000', aptDate: crmToday_(), aptTime: '10:00', detail: 'ข้อความทดสอบการแจ้งเตือนแอดมิน' }, true);
      return nT ? { ok: true, sent: nT } : { ok: false, error: 'ส่งไม่สำเร็จ — ตรวจว่าแอดมินเพิ่มเพื่อน LINE OA แล้ว' };
    }
    if (act === 'approveEmergency') {
      var s2 = crmSettings_(); s2.emergencyApprovedBy = by; s2.emergencyApprovedAt = now; crmSaveSettingsRaw_(s2); return { ok: true };
    }
    if (act === 'saveTemplate') {
      var t = b.template || {}, rows = crmRead_('templates'), ex = t.id ? crmFind_(rows, 'id', t.id) : null;
      var opts = t.followupOptions; if (typeof opts !== 'string') opts = JSON.stringify(opts || []);
      var rec = { name: t.name || '', procKeywords: t.procKeywords || '', priority: t.priority || 50, aftercareText: t.aftercareText || '',
        followupEnabled: t.followupEnabled ? 'TRUE' : 'FALSE', followupQuestion: t.followupQuestion || '', followupOptions: opts, updatedBy: by, updatedAt: now };
      if (ex) {
        var medChanged = ex.aftercareText !== rec.aftercareText || ex.followupQuestion !== rec.followupQuestion || ex.followupOptions !== rec.followupOptions || ex.procKeywords !== rec.procKeywords;
        if (medChanged) { rec.status = 'draft'; rec.approvedBy = ''; rec.approvedAt = ''; rec.version = (+ex.version || 1) + 1; }
        crmUpdate_('templates', ex._row, rec); return { ok: true, id: ex.id, reapproval: medChanged };
      }
      rec.id = crmId_('tpl_'); rec.status = 'draft'; rec.version = 1; crmAppend_('templates', rec); return { ok: true, id: rec.id };
    }
    if (act === 'approveTemplate') {
      var r2 = crmFind_(crmRead_('templates'), 'id', b.id);
      if (!r2) return { ok: false, error: 'not_found' };
      if (String(r2.version) !== String(b.version)) return { ok: false, error: 'มีการแก้ไขข้อความหลังจากเปิดดู กรุณาโหลดใหม่แล้วตรวจอีกครั้ง' };
      crmUpdate_('templates', r2._row, { status: 'approved', approvedBy: by, approvedAt: now }); return { ok: true };
    }
    if (act === 'setTemplateStatus') {
      var r3 = crmFind_(crmRead_('templates'), 'id', b.id); if (!r3) return { ok: false, error: 'not_found' };
      var st = b.status === 'disabled' ? 'disabled' : 'draft';
      crmUpdate_('templates', r3._row, { status: st, approvedBy: st === 'draft' ? '' : r3.approvedBy, updatedBy: by, updatedAt: now }); return { ok: true };
    }
    if (act === 'deleteTemplate') {
      var r4 = crmFind_(crmRead_('templates'), 'id', b.id); if (!r4) return { ok: false, error: 'not_found' };
      crmSheet_('templates').deleteRow(r4._row); return { ok: true };
    }
    if (act === 'fuCalled') {   // ติดตามอาการที่คนไข้ไม่ตอบ → พนักงานโทรตามแล้ว (บันทึกผล)
      crmSheet_('followups');
      var rf = crmFind_(crmRead_('followups'), 'id', b.id); if (!rf) return { ok: false, error: 'not_found' };
      crmUpdate_('followups', rf._row, { calledAt: now, calledBy: by, callNote: String(b.note || '').slice(0, 300) }); return { ok: true };
    }
    if (act === 'amtResend') {   // ส่งการ์ดแก้ไขยอดให้คนไข้ (จากงาน "แก้ยอดหลังส่งสรุป")
      var tkA = crmFind_(crmRead_('tasks'), 'id', b.id); if (!tkA || tkA.type !== 'amtchange') return { ok: false, error: 'not_found' };
      var trA = crmFind_(crmReadByName_('บันทึกการรักษา'), 'id', tkA.aptId); if (!trA) return { ok: false, error: 'ไม่พบรายการรักษานี้แล้ว' };
      var sA = crmSettings_(), tgA = (crmLinkMap_()[crmHN_(trA.hn)] || []).filter(function (x) { return x.consent; });
      if (!tgA.length) return { ok: false, error: 'คนไข้ไม่ได้ผูก LINE หรือปิดรับข้อความ — แจ้งทางโทรแทน' };
      var cardA = crmReceiptMessage_(sA, trA, { corrected: true }), stA = { done: {}, fails: {} }, okA = false;
      tgA.forEach(function (t) {
        if (crmSend_(sA, stA, { key: 'amtfix:' + trA.id + ':' + now + ':' + t.lineUserId, type: 'receipt', hn: trA.hn, patName: trA.patName, lineUserId: t.lineUserId, refId: trA.id, detail: 'แก้ไขยอด' }, [cardA])) okA = true;
      });
      if (!okA) return { ok: false, error: 'ส่งไม่สำเร็จ (โควตาเต็มหรือ LINE ปฏิเสธ)' };
      crmAppend_('log', { key: crmKey_(sA, 'receipt:' + trA.id), type: 'receipt', hn: trA.hn, patName: trA.patName, lineUserId: '', refId: trA.id, status: 'sent', detail: 'amt=' + crmTreatAmt_(trA), createdAt: now, pushCount: 0 });
      crmUpdate_('tasks', tkA._row, { status: 'done', resultNote: 'ส่งการ์ดแก้ไขยอดให้คนไข้แล้ว', doneBy: by, updatedAt: now });
      return { ok: true };
    }
    if (act === 'cancelSend') {   // ส่งข้อความแจ้งยกเลิกนัดให้คนไข้ (จากงาน "นัดถูกยกเลิก/ลบ")
      var tkC = crmFind_(crmRead_('tasks'), 'id', b.id); if (!tkC || tkC.type !== 'aptcancel') return { ok: false, error: 'not_found' };
      var sC = crmSettings_(), tgC = (crmLinkMap_()[crmHN_(tkC.hn)] || []).filter(function (x) { return x.consent; });
      if (!tgC.length) return { ok: false, error: 'คนไข้ไม่ได้ผูก LINE หรือปิดรับข้อความ — แจ้งทางโทรแทน' };
      var cardC = crmCancelMessage_(sC, { patName: tkC.patName, aptDate: crmDateOnly_(tkC.aptDate), aptTime: String(tkC.aptTime || '').slice(0, 5) }), stC = { done: {}, fails: {} }, okC = false;
      tgC.forEach(function (t) {
        if (crmSend_(sC, stC, { key: 'aptcancel:' + tkC.aptId + ':' + now + ':' + t.lineUserId, type: 'change', hn: tkC.hn, patName: tkC.patName, lineUserId: t.lineUserId, refId: tkC.aptId, detail: 'แจ้งยกเลิกนัด ' + crmDateOnly_(tkC.aptDate) }, [cardC])) okC = true;
      });
      if (!okC) return { ok: false, error: 'ส่งไม่สำเร็จ (โควตาเต็มหรือ LINE ปฏิเสธ)' };
      crmUpdate_('tasks', tkC._row, { status: 'done', resultNote: 'ส่งข้อความแจ้งยกเลิกนัดให้คนไข้แล้ว', doneBy: by, updatedAt: now });
      return { ok: true };
    }
    if (act === 'aptConfirm') {   // แอดมินตั้งนัดเป็น "ยืนยันแล้ว" เอง (คนไข้ยืนยันทางโทร/แชท) — ใช้ได้กับนัดจัดฟันที่ไม่อยู่ในตารางนัดด้วย
      var aid = String(b.aptId || ''); if (!aid) return { ok: false, error: 'missing_id' };
      var arow = crmFind_(crmRead_('apt'), 'aptId', aid);
      if (arow) crmUpdate_('apt', arow._row, { confirmedAt: now, lastAction: 'staff-confirm', updatedAt: now });
      else crmAppend_('apt', { aptId: aid, hn: b.hn || '', confirmedAt: now, lastAction: 'staff-confirm', updatedAt: now });
      crmTouch_(); return { ok: true };
    }
    if (act === 'orthoVisitSend') {   // สรุปการมาจัดฟันวันนี้ (รายการ + ราคา) ส่งให้คนไข้ทันทีหลังพนักงานกดบันทึก "มาตามนัด"
      var hnV = String(b.hn || ''); if (!hnV) return { ok: false, error: 'missing_hn' };
      var sV = crmSettings_(), tgV = (crmLinkMap_()[crmHN_(hnV)] || []).filter(function (x) { return x.consent; });
      if (!tgV.length) return { ok: true, sent: 0, reason: 'no_line' };
      var itemsV = (b.items || []).slice(0, 12).map(function (x) { return { name: String(x.name || '').slice(0, 60), price: (x.price === null || x.price === undefined) ? null : (+x.price || 0), note: String(x.note || '').slice(0, 60) }; });
      if (!itemsV.length) return { ok: false, error: 'no_items' };
      var cardV = crmOrthoVisitMessage_(sV, { patName: String(b.patName || ''), date: crmDateOnly_(b.date), items: itemsV, doc: String(b.doc || '').slice(0, 60), care: b.care !== false, cash: +b.cash || 0, transfer: +b.transfer || 0 });
      var stV = { done: {}, fails: {} }, nV = 0;
      tgV.forEach(function (t) {
        if (crmSend_(sV, stV, { key: 'orthovisit:' + hnV + ':' + crmDateOnly_(b.date) + ':' + now + ':' + t.lineUserId, type: 'receipt', hn: hnV, patName: b.patName || '', lineUserId: t.lineUserId, refId: 'ORTHOVISIT-' + crmHN_(hnV) + '-' + crmDateOnly_(b.date), detail: 'สรุปการมาจัดฟัน' }, [cardV])) nV++;
      });
      if (!nV) return { ok: false, error: 'ส่งไม่สำเร็จ (โควตาเต็มหรือ LINE ปฏิเสธ)' };
      return { ok: true, sent: nV };
    }
    if (act === 'updateTask') {
      var r5 = crmFind_(crmRead_('tasks'), 'id', b.id); if (!r5) return { ok: false, error: 'not_found' };
      crmUpdate_('tasks', r5._row, { status: b.status || r5.status, resultNote: b.resultNote !== undefined ? b.resultNote : r5.resultNote, doneBy: by, updatedAt: now }); return { ok: true };
    }
    if (act === 'linkApprove' || act === 'linkReject' || act === 'linkRevoke') {
      var r6 = crmFind_(crmRead_('links'), 'id', b.id); if (!r6) return { ok: false, error: 'not_found' };
      if (act === 'linkApprove') {
        var hn = b.hn || r6.hn; if (!hn) return { ok: false, error: 'กรุณาเลือก HN ของคนไข้' };
        crmUpdate_('links', r6._row, { status: 'active', hn: hn, patName: b.patName || r6.patName, approvedBy: by, approvedAt: now });
      } else crmUpdate_('links', r6._row, { status: act === 'linkReject' ? 'rejected' : 'revoked', approvedBy: by, approvedAt: now });
      return { ok: true };
    }
    if (act === 'linkManual') {
      if (!b.lineUserId || !b.hn) return { ok: false, error: 'missing_field' };
      var dup = crmRead_('links').filter(function (l) { return l.lineUserId === b.lineUserId && crmHN_(l.hn) === crmHN_(b.hn) && l.status === 'active'; })[0];
      if (dup) return { ok: true, dup: true };
      var fl = crmFind_(crmRead_('followers'), 'lineUserId', b.lineUserId);
      crmAppend_('links', { id: crmId_('LK'), lineUserId: b.lineUserId, hn: b.hn, patName: b.patName || '', status: 'active', source: 'staff', consent: 'TRUE',
        displayName: fl ? fl.displayName : '', createdAt: now, approvedBy: by, approvedAt: now, note: 'ผูกโดยพนักงาน (คนไข้ยินยอมด้วยวาจา)' });
      return { ok: true };
    }
    if (act === 'followerDelete') {   // ลบรายชื่อเพื่อนที่ยังไม่ผูก ออกจากรายการ (ลบแถวในชีต crm_followers) — ถ้าเขาทักมาใหม่จะกลับมาในรายการเอง
      if (!b.lineUserId) return { ok: false, error: 'missing_field' };
      var linkedNow = crmRead_('links').filter(function (l) { return l.lineUserId === b.lineUserId && l.status === 'active'; })[0];
      if (linkedNow) return { ok: false, error: 'คนนี้ผูกกับ HN แล้ว ลบไม่ได้' };
      var flD = crmFind_(crmRead_('followers'), 'lineUserId', b.lineUserId); if (!flD) return { ok: false, error: 'not_found' };
      crmSheet_('followers').deleteRow(flD._row); return { ok: true };
    }
    if (act === 'caseNoteAdd') {
      if (!b.treatId || !b.text) return { ok: false, error: 'missing_field' };
      crmAppend_('casenotes', { id: crmId_('CN'), treatId: b.treatId, hn: b.hn || '', patName: b.patName || '', text: String(b.text).slice(0, 1500), author: by,
        status: b.doctorApproved ? 'approved' : 'pending', approvedBy: b.doctorApproved ? by : '', approvedAt: b.doctorApproved ? now : '', createdAt: now });
      return { ok: true };
    }
    if (act === 'caseNoteApprove' || act === 'caseNoteReject') {
      var r7 = crmFind_(crmRead_('casenotes'), 'id', b.id); if (!r7) return { ok: false, error: 'not_found' };
      crmUpdate_('casenotes', r7._row, { status: act === 'caseNoteApprove' ? 'approved' : 'rejected', approvedBy: by, approvedAt: now }); return { ok: true };
    }
    if (act === 'campaignSend') return crmCampaignSend_(b, by);
    if (act === 'sendTest') return crmSendTest_(b);
    if (act === 'confirmOne') { lock.releaseLock(); lock = null; return { ok: true, result: crmConfirmOne_(b.hn) }; }
    if (act === 'runNow') { lock.releaseLock(); lock = null; return { ok: true, result: crmTick() }; }
    if (act === 'baseline') return { ok: true, marked: crmBaseline_(crmSettings_()) };
    if (act === 'refreshQuota') return { ok: true, quota: crmQuota_(true) };
    return { ok: false, error: 'unknown_crm_action' };
  } finally { if (lock) lock.releaseLock(); }
}

function crmCampaignSend_(b, by) {
  var s = crmSettings_();
  if (!b.text) return { ok: false, error: 'missing_text' };
  var hm = crmHM_(); if (hm < s.sendStart || hm >= s.sendEnd) return { ok: false, error: 'นอกช่วงเวลาส่ง (' + s.sendStart + '–' + s.sendEnd + ')' };
  var links = crmLinkMap_(), uids = [], seen = {};
  (b.hns || []).forEach(function (h) { (links[crmHN_(h)] || []).forEach(function (x) { if (x.consent && !seen[x.lineUserId]) { seen[x.lineUserId] = 1; uids.push(x.lineUserId); } }); });
  var campId = crmId_('CP'), state = crmLogKeys_();
  var rec = { id: campId, name: b.name || 'แคมเปญ', segment: b.segment || '', text: b.text, createdBy: by, createdAt: crmNow_(), targets: uids.length, sent: 0, status: '' };
  if (s.testMode) {
    if (!s.testUserId) return { ok: false, error: 'ยังไม่ได้เลือกบัญชีทดสอบ' };
    var ok = crmSend_(s, state, { key: 'T:camp:' + campId, type: 'campaign', refId: campId, lineUserId: s.testUserId, patName: '(แคมเปญ ' + uids.length + ' คน)' }, [crmText_(b.text)]);
    rec.status = ok ? 'test' : 'failed'; rec.sent = ok ? 1 : 0; crmAppend_('campaigns', rec);
    return { ok: ok, test: true, targets: uids.length };
  }
  var sent = 0;
  for (var i = 0; i < uids.length; i += 500) {
    var batch = uids.slice(i, i + 500);
    var res = crmApi_('post', '/v2/bot/message/multicast', { to: batch, messages: [crmText_(b.text)] });
    if (res.code === 200) sent += batch.length;
    crmAppendMany_('log', batch.map(function (u) { return { key: 'camp:' + campId + ':' + u, type: 'campaign', lineUserId: u, refId: campId,
      status: res.code === 200 ? 'sent' : 'failed', detail: res.code === 200 ? (b.name || '') : ('HTTP ' + res.code), createdAt: crmNow_(), pushCount: res.code === 200 ? 1 : 0 }; }));
  }
  rec.sent = sent; rec.status = sent === uids.length ? 'sent' : 'partial'; crmAppend_('campaigns', rec);
  return { ok: true, targets: uids.length, sent: sent };
}
function crmSendTest_(b) {
  var s = crmSettings_();
  var to = b.to || s.testUserId; if (!to) return { ok: false, error: 'ยังไม่ได้เลือกบัญชีทดสอบ' };
  var demoApt = { id: 'TEST', date: crmAddDays_(crmToday_(), 1), time: '10:30', patName: 'ทดสอบ ระบบ', docName: 'ทพ.สรวิศ สุภาพ', proc: 'ขูดหินปูน' };
  var msgs;
  if (b.kind === 'aftercare') {
    var tp = crmFind_(crmRead_('templates'), 'id', b.templateId);
    if (!tp) return { ok: false, error: 'not_found' };
    msgs = [crmText_('🧪 ตัวอย่างข้อความ (สถานะ: ' + tp.status + ')')].concat(crmAftercareMessages_(s, 'ทดสอบ ระบบ', crmToday_(), [tp], []));
    if (String(tp.followupEnabled).toUpperCase() === 'TRUE') msgs.push(crmFollowupMessage_(s, { id: 'TEST' }, tp, 'ทดสอบ ระบบ', tp.name));
  } else {
    msgs = [crmText_('🧪 ตัวอย่างข้อความยืนยันนัด/เตือนนัด/สรุปการรักษา'), crmAptMessage_(s, demoApt, 'confirm'), crmAptMessage_(s, demoApt, 'remind'),
      crmReceiptMessage_(s, { date: crmToday_(), docName: 'ทพ.สรวิศ สุภาพ', proc: 'ขูดหินปูน, อุดฟัน', cash: 800, transfer: 700, sso: 0, patName: 'ทดสอบ ระบบ' })];
  }
  var res = crmApi_('post', '/v2/bot/message/push', { to: to, messages: msgs.slice(0, 5) });
  crmAppend_('log', { key: 'test:' + Date.now(), type: 'test', lineUserId: to, status: res.code === 200 ? 'test' : 'failed', detail: res.code === 200 ? (b.kind || 'apt') : ('HTTP ' + res.code + ' ' + String(res.text).slice(0, 150)), createdAt: crmNow_(), pushCount: res.code === 200 ? 1 : 0 });
  return { ok: res.code === 200, error: res.code === 200 ? '' : ('LINE ตอบกลับ ' + res.code + ': ' + String(res.text).slice(0, 200)) };
}

/* ============================ SETUP ============================ */
function crmSetup() {
  Object.keys(CRM_SHEETS).forEach(function (k) { crmSheet_(k); });
  var seeded = crmSeedTemplates_();
  var installed = false;
  if (ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'crmTick'; }).length === 0) {
    ScriptApp.newTrigger('crmTick').timeBased().everyMinutes(10).create(); installed = true;
  }
  if (!PropertiesService.getScriptProperties().getProperty('CRM_SETTINGS')) crmSaveSettingsRaw_(crmSettings_());
  var msg = 'สร้างชีต CRM แล้ว | template ร่างใหม่ ' + seeded + ' รายการ | trigger crmTick ' + (installed ? 'ติดตั้งแล้ว' : 'มีอยู่แล้ว') +
    ' | token ' + (crmToken_() ? 'พร้อม' : 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN');
  Logger.log(msg);
  return msg;
}

/* ปรับความถี่รอบส่ง (ค่าที่ Apps Script รับ: 1, 5, 10, 15, 30 นาที) — เลือกฟังก์ชัน crmSetTick5 แล้วกด Run */
function crmSetTickMinutes(n) {
  n = +n; if ([1, 5, 10, 15, 30].indexOf(n) === -1) throw new Error('ใช้ได้เฉพาะ 1, 5, 10, 15 หรือ 30 นาที');
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'crmTick') { ScriptApp.deleteTrigger(t); removed++; } });
  ScriptApp.newTrigger('crmTick').timeBased().everyMinutes(n).create();
  var msg = 'ตั้งรอบส่ง crmTick ทุก ' + n + ' นาทีแล้ว (ลบ trigger เดิม ' + removed + ' อัน)';
  Logger.log(msg); return msg;
}
function crmSetTick5() { return crmSetTickMinutes(5); }
function crmSetTick10() { return crmSetTickMinutes(10); }

/* ลบ rich menu เดิมทั้งหมด แล้วสร้างใหม่ 3 ปุ่ม: นัดครั้งถัดไป / ประวัติการรักษา / จัดฟัน */
function crmSetupRichMenu() {
  if (!crmToken_()) throw new Error('ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');
  var W = 2500, H = 843, cuts = [0, 833, 1667, 2500], tabs = ['next', 'history', 'ortho'], labels = ['นัดครั้งถัดไป', 'ประวัติการรักษา', 'จัดฟัน'];
  var menu = { size: { width: W, height: H }, selected: true, name: 'Bangluang CRM ' + crmToday_(), chatBarText: 'เมนูคนไข้',
    areas: tabs.map(function (t, i) { return { bounds: { x: cuts[i], y: 0, width: cuts[i + 1] - cuts[i], height: H }, action: { type: 'uri', label: labels[i], uri: crmLiffUrl_(t) } }; }) };
  var c = crmApi_('post', '/v2/bot/richmenu', menu);
  if (c.code !== 200 || !c.data || !c.data.richMenuId) throw new Error('สร้าง rich menu ไม่สำเร็จ: ' + c.code + ' ' + c.text);
  var id = c.data.richMenuId;
  var imgUrl = crmProp_('CRM_RICHMENU_IMAGE_URL', CRM_DEFAULT_RICHMENU_IMG);
  var img = UrlFetchApp.fetch(imgUrl, { muteHttpExceptions: true });
  if (img.getResponseCode() !== 200) { crmApi_('delete', '/v2/bot/richmenu/' + id); throw new Error('ดาวน์โหลดรูป rich menu ไม่ได้: ' + imgUrl); }
  var up = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', { method: 'post', contentType: 'image/png',
    payload: img.getBlob().getBytes(), headers: { Authorization: 'Bearer ' + crmToken_() }, muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) { crmApi_('delete', '/v2/bot/richmenu/' + id); throw new Error('อัปโหลดรูปไม่สำเร็จ: ' + up.getResponseCode() + ' ' + up.getContentText()); }
  var d = crmApi_('post', '/v2/bot/user/all/richmenu/' + id);
  if (d.code !== 200) throw new Error('ตั้งเป็นเมนูหลักไม่สำเร็จ: ' + d.code + ' ' + d.text);
  var list = crmApi_('get', '/v2/bot/richmenu/list'), deleted = 0;
  ((list.data && list.data.richmenus) || []).forEach(function (m) {
    if (m.richMenuId !== id) { var r = crmApi_('delete', '/v2/bot/richmenu/' + m.richMenuId); if (r.code === 200) deleted++; }
  });
  PropertiesService.getScriptProperties().setProperty('CRM_RICHMENU_ID', id);
  var msg = '✅ rich menu ใหม่: ' + id + ' | ลบเมนูเดิม ' + deleted + ' อัน';
  Logger.log(msg);
  return msg;
}
