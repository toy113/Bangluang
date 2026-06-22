/**********************************************************************
 * Bangluang Dental — ORTHO / LINE OA Backend  (Google Apps Script)
 * ระบบจัดฟัน + ผูกบัญชี LINE (HN + เบอร์โทร)
 *
 * ⚠️ สำคัญ — ไฟล์นี้ "ไม่มี" doGet/doPost ของตัวเองแล้ว (กันชนกับไฟล์หลัก)
 *    ให้แทรก 2 บรรทัดนี้ไว้บนสุดของ doGet / doPost ในไฟล์หลักของโปรเจกต์:
 *
 *    function doGet(e) {
 *      var _ortho = orthoRouteGet_(e);   if (_ortho) return _ortho;   // <-- เพิ่ม
 *      ... โค้ด doGet เดิม (getAll ฯลฯ) ...
 *    }
 *
 *    function doPost(e) {
 *      var _ortho = orthoRoutePost_(e);  if (_ortho) return _ortho;   // <-- เพิ่ม
 *      ... โค้ด doPost เดิม (type/data sync ฯลฯ) ...
 *    }
 *
 *    orthoRouteGet_ / orthoRoutePost_ จะ "คืน null" ถ้าไม่ใช่คำขอของ ortho
 *    → doGet/doPost เดิมทำงานต่อตามปกติ ไม่กระทบของเดิม
 *
 * วิธีติดตั้งครั้งแรก:
 *   1) วาง 2 บรรทัดข้างบนลงใน doGet/doPost ไฟล์หลัก
 *   2) ใส่ ORTHO_LINE_TOKEN (Channel access token จาก LINE Developers)
 *   3) รัน setupOrtho() หนึ่งครั้ง  -> สร้าง sheet ortho / ortho_log
 *   4) Deploy ใหม่:  Deploy > Manage deployments > (ดินสอ) > Version: New version > Deploy
 *      *** ถ้าไม่ deploy เวอร์ชันใหม่ URL /exec จะยังเสิร์ฟโค้ดเก่าที่ไม่มี ortho ***
 **********************************************************************/

/* ============================ CONFIG ============================ */
var ORTHO_LINE_TOKEN  = 'cwTKCta3n3WjIO/ZZ1a6iEwGDMtWQcKuCc6Fd7snhB1Zq734zwa9JL+29IpHM1vBQt/RUv7SYcXDSRvubK4v1GN1i43OyMdZ8pXfA36deWzB4R50NyGAsW+ingrPXMe911z9AIckrrznm98mM95iYQdB04t89/1O/w1cDnyilFU=';
var SHEET_ORTHO          = 'ortho';
var SHEET_ORTHO_LOG      = 'ortho_log';
var ORTHO_SHEET_PATIENTS = 'คนไข้';
// LIFF หน้าผูกบัญชี — ใช้ตอบกลับคน follow ใหม่
var LIFF_BIND_URL   = 'https://liff.line.me/2010461984-kt5dSgin';

var ORTHO_HEADERS = ['hn','ชื่อ','lineUserId','แบบจัด','หมอ','วันเริ่ม','แผนเดือน',
  'phase','ค่ารักษารวม','จ่ายแล้ว','คงเหลือ','งวดถัดไปวันที่','งวดถัดไปจำนวน',
  'นัดถัดไป','note','updatedAt'];
var ORTHO_LOG_HEADERS = ['hn','วันที่','ทำอะไร','ลวด','ยาง','หมอ','note'];

var ORTHO_TZ = 'Asia/Bangkok';

/* ===================== ROUTING (เรียกจาก doGet/doPost ไฟล์หลัก) =====================
 * คืน ContentService ถ้าเป็นคำขอของ ortho, คืน null ถ้าไม่ใช่ (ให้ของเดิมทำต่อ) */
function orthoRouteGet_(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'orthoGet')  return orthoJsonOut_(orthoGetByLineId(p.lineUserId));
  if (p.action === 'orthoBind') return orthoJsonOut_(orthoBind(p.lineUserId, p.idcode, p.phone));
  if (p.action === 'orthoList') return orthoJsonOut_(orthoList());      // ใช้ใน admin tab
  if (p.action === 'orthoLogsAll') return orthoJsonOut_(orthoLogsAll()); // admin: log ทั้งหมด (นับครั้งจริงจาก log)
  if (p.action === 'orthoLogsByHn') return orthoJsonOut_(orthoLogsByHn(p.hn)); // admin: ดูประวัติการรักษา
  return null; // ไม่ใช่งานของ ortho
}

function orthoRoutePost_(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}

  // 1) LINE webhook — body จะมี events[] เสมอ
  if (body && body.events) {
    orthoHandleLineWebhook_(body.events);
    return ContentService.createTextOutput('OK');
  }

  // 2) action จาก LIFF / admin tab
  var action = body.action || (e.parameter && e.parameter.action);
  if (action === 'orthoBind')   return orthoJsonOut_(orthoBind(body.lineUserId, body.idcode, body.phone));
  if (action === 'orthoGet')    return orthoJsonOut_(orthoGetByLineId(body.lineUserId));
  if (action === 'orthoSave')   return orthoJsonOut_(orthoSave(body.row));     // admin: เพิ่ม/แก้ profile
  if (action === 'orthoLogAdd') return orthoJsonOut_(orthoLogAdd(body.log));   // admin: เพิ่ม log adjust
  if (action === 'orthoLogAddBatch') return orthoJsonOut_(orthoLogAddBatch(body.logs)); // admin: บันทึกย้อนหลายวันในคำสั่งเดียว
  if (action === 'orthoSetLine')return orthoJsonOut_(orthoSetLineId(body.hn, body.lineUserId)); // admin ผูกมือ (fallback)

  return null; // ไม่ใช่งานของ ortho
}

/* ======================= BINDING (verify) ======================= */
/* คนไข้กรอก HN + เบอร์ใน LIFF -> ตรวจกับชีต คนไข้ -> ผูก lineUserId */
function orthoBind(lineUserId, idcode, phone) {
  if (!lineUserId || !idcode || !phone) return { ok: false, error: 'missing_field' };

  var codeIn = String(idcode).trim().toUpperCase();
  var pIn = orthoNormPhone_(phone);

  // 1) หา hn จากรหัสประจำตัวในชีต ortho
  var orthos = orthoSheetToObjects_(SHEET_ORTHO);
  var orow = null;
  for (var i = 0; i < orthos.length; i++) {
    var code = String(orthos[i]['รหัสประจำตัว'] || '').trim().toUpperCase();
    if (code && code === codeIn) { orow = orthos[i]; break; }
  }
  if (!orow) return { ok: false, error: 'not_found' };
  var hn = orthoNormHN_(orow['hn']);

  // 2) ยืนยันด้วยเบอร์โทรจากชีตคนไข้ (กันคนอื่นเดารหัสมาผูกบัญชีสวมรอย)
  var pats = orthoSheetToObjects_(ORTHO_SHEET_PATIENTS);
  var match = null;
  for (var j = 0; j < pats.length; j++) {
    var r = pats[j];
    if (orthoNormHN_(r['hn'] || r['HN'] || r['Hn']) !== hn) continue;
    // หาคอลัมน์เบอร์โทร (เผื่อชื่อหัวต่างกัน)
    var phoneCell = r['เบอร์โทร'] || r['เบอร์'] || r['โทร'] || r['phone'] || r['tel'] || '';
    if (orthoNormPhone_(phoneCell) === pIn) { match = r; break; }
  }
  if (!match) return { ok: false, error: 'not_found' }; // รหัส+เบอร์ ไม่ตรงกัน

  var name = match['ชื่อ'] || match['name'] || match['ชื่อ-นามสกุล'] || orow['ชื่อ'] || '';
  orthoSetLineId(hn, lineUserId, name); // upsert: มี row อยู่แล้ว->อัปเดต, ยังไม่มี->สร้าง
  return { ok: true, hn: hn, name: name };
}

/* ===================== READ (สำหรับ LIFF) ===================== */
function orthoGetByLineId(lineUserId) {
  if (!lineUserId) return { ok: false, error: 'missing_field' };
  var rows = orthoSheetToObjects_(SHEET_ORTHO);
  var rec = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].lineUserId) === String(lineUserId)) { rec = rows[i]; break; }
  }
  if (!rec) return { ok: true, bound: false };

  var logs = orthoSheetToObjects_(SHEET_ORTHO_LOG).filter(function (l) {
    return orthoNormHN_(l.hn) === orthoNormHN_(rec.hn);
  });
  // เรียง log ใหม่สุดก่อน
  logs.sort(function (a, b) { return String(b['วันที่']).localeCompare(String(a['วันที่'])); });
  return { ok: true, bound: true, profile: rec, logs: logs };
}

/* ===================== WRITE (admin tab) ===================== */
function orthoList() {
  return { ok: true, rows: orthoSheetToObjects_(SHEET_ORTHO) };
}

function orthoLogsAll() {
  return { ok: true, logs: orthoSheetToObjects_(SHEET_ORTHO_LOG) };
}

function orthoLogsByHn(hn) {
  if (!hn) return { ok: false, error: 'missing_hn' };
  hn = orthoNormHN_(hn);
  var logs = orthoSheetToObjects_(SHEET_ORTHO_LOG).filter(function (l) {
    return orthoNormHN_(l.hn) === hn;
  });
  logs.sort(function (a, b) { return String(b['วันที่']).localeCompare(String(a['วันที่'])); });
  return { ok: true, logs: logs };
}

/* upsert profile ทั้งแถว by hn */
function orthoSave(row) {
  if (!row || !row.hn) return { ok: false, error: 'missing_hn' };
  var sh = orthoGetSheet_(SHEET_ORTHO, ORTHO_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data[0];
  var hnCol = head.indexOf('hn');
  var hn = orthoNormHN_(row.hn);

  row.updatedAt = Utilities.formatDate(new Date(), ORTHO_TZ, 'yyyy-MM-dd HH:mm:ss');

  // หาแถวเดิม
  var foundRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (orthoNormHN_(data[r][hnCol]) === hn) { foundRow = r + 1; break; }
  }
  var rowArr = head.map(function (h) { return (row[h] !== undefined && row[h] !== null) ? row[h] : ''; });

  if (foundRow > 0) {
    // อัปเดต — แต่คง lineUserId เดิมไว้ถ้า row ที่ส่งมาไม่ได้ส่ง lineUserId
    var luCol = head.indexOf('lineUserId');
    if (luCol >= 0 && (row.lineUserId === undefined || row.lineUserId === '')) {
      rowArr[luCol] = data[foundRow - 1][luCol];
    }
    sh.getRange(foundRow, 1, 1, head.length).setValues([rowArr]);
  } else {
    sh.appendRow(rowArr);
  }
  var targetRow = foundRow > 0 ? foundRow : sh.getLastRow();

  // กัน Sheets แปลง "14:30" เป็น serial time อัตโนมัติ -> บังคับเป็นข้อความล้วน
  var timeCol = head.indexOf('นัดถัดไปเวลา');
  if (timeCol >= 0 && rowArr[timeCol] !== '') {
    sh.getRange(targetRow, timeCol + 1).setNumberFormat('@STRING@').setValue(String(rowArr[timeCol]));
  }

  return { ok: true, hn: hn };
}

// บันทึกหลาย log พร้อมกันในคำสั่งเดียว (กัน race condition จากยิง orthoLogAdd พร้อมกันหลาย request
// ซึ่งแต่ละ request จะแย่งกันหาแถวว่างถัดไป ทำให้ข้อมูลทับกัน/หาย — ใช้กับ "บันทึกย้อน" หลายวัน)
function orthoLogAddBatch(logs) {
  if (!Array.isArray(logs) || !logs.length) return { ok: false, error: 'missing_logs' };
  var sh = orthoGetSheet_(SHEET_ORTHO_LOG, ORTHO_LOG_HEADERS);
  var head = sh.getDataRange().getValues()[0];
  var rows = logs.map(function (log) {
    if (!log['วันที่']) log['วันที่'] = Utilities.formatDate(new Date(), ORTHO_TZ, 'yyyy-MM-dd');
    return head.map(function (h) { return (log[h] !== undefined && log[h] !== null) ? log[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
  return { ok: true, count: rows.length };
}

function orthoLogAdd(log) {
  if (!log || !log.hn) return { ok: false, error: 'missing_hn' };
  var sh = orthoGetSheet_(SHEET_ORTHO_LOG, ORTHO_LOG_HEADERS);
  var head = sh.getDataRange().getValues()[0];
  if (!log['วันที่']) log['วันที่'] = Utilities.formatDate(new Date(), ORTHO_TZ, 'yyyy-MM-dd');
  var rowArr = head.map(function (h) { return (log[h] !== undefined && log[h] !== null) ? log[h] : ''; });
  sh.appendRow(rowArr);
  return { ok: true };
}

/* ผูก/อัปเดต lineUserId ให้ hn (ใช้ทั้งตอน bind อัตโนมัติ และ admin ผูกมือ) */
function orthoSetLineId(hn, lineUserId, nameIfNew) {
  hn = orthoNormHN_(hn);
  var sh = orthoGetSheet_(SHEET_ORTHO, ORTHO_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data[0];
  var hnCol = head.indexOf('hn');
  var luCol = head.indexOf('lineUserId');

  for (var r = 1; r < data.length; r++) {
    if (orthoNormHN_(data[r][hnCol]) === hn) {
      sh.getRange(r + 1, luCol + 1).setValue(lineUserId);
      return { ok: true, updated: true, hn: hn };
    }
  }
  // ยังไม่มี profile -> สร้าง row ขั้นต่ำ ให้ admin มาเติมข้อมูลทีหลัง
  var newRow = head.map(function (h) {
    if (h === 'hn') return hn;
    if (h === 'lineUserId') return lineUserId;
    if (h === 'ชื่อ') return nameIfNew || '';
    if (h === 'updatedAt') return Utilities.formatDate(new Date(), ORTHO_TZ, 'yyyy-MM-dd HH:mm:ss');
    return '';
  });
  sh.appendRow(newRow);
  return { ok: true, created: true, hn: hn };
}

/* ===================== LINE WEBHOOK ===================== */
function orthoHandleLineWebhook_(events) {
  events.forEach(function (ev) {
    try {
      if (ev.type === 'follow') {
        orthoReplyLine_(ev.replyToken, [
          orthoTextMsg_('สวัสดีค่ะ 🦷 ยินดีต้อนรับสู่คลินิกทันตกรรมบางหลวง\n\nกดเมนู "ข้อมูลของฉัน" ด้านล่างเพื่อผูกบัญชีคนไข้จัดฟันของคุณค่ะ'),
          orthoTextMsg_('ผูกบัญชีที่นี่: ' + LIFF_BIND_URL)
        ]);
      } else if (ev.type === 'message' && ev.message.type === 'text') {
        // เผื่ออนาคต: คีย์เวิร์ดง่ายๆ เช่น "นัด"
        // ตอนนี้ปล่อยผ่าน (rich menu จะเป็นทางหลัก)
      } else if (ev.type === 'postback') {
        // เผื่ออนาคต: ปุ่ม rich menu แบบ postback
      }
    } catch (err) { /* กัน event เดียวพังทั้ง batch */ }
  });
}

/* ===================== LINE API helpers ===================== */
function orthoReplyLine_(replyToken, messages) {
  if (!replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ORTHO_LINE_TOKEN },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true
  });
}
function orthoPushLine_(to, messages) {
  if (!to) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ORTHO_LINE_TOKEN },
    payload: JSON.stringify({ to: to, messages: messages }),
    muteHttpExceptions: true
  });
}
function orthoTextMsg_(t) { return { type: 'text', text: t }; }

/* ===================== UTIL ===================== */
function orthoNormHN_(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase();
}
// เก็บเฉพาะตัวเลข, แปลง +66 / 66 ขึ้นต้น -> 0 ; เทียบ 9 หลักท้ายกันพลาด
function orthoNormPhone_(v) {
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('66') === 0 && d.length >= 11) d = '0' + d.slice(2);
  return d.slice(-9);
}
function orthoJsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function orthoGetSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}
function orthoSheetToObjects_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var head = data[0];
  var out = [];
  for (var r = 1; r < data.length; r++) {
    var o = {};
    for (var c = 0; c < head.length; c++) {
      var key = String(head[c]).trim();
      var val = data[r][c];
      // แปลง Date -> string เพื่อส่ง JSON (คอลัมน์เวลาล้วน เช่นเผลอถูก Sheets แปลงเป็น serial time ฟอร์แมตแบบ HH:mm ไม่ใช่วันที่)
      if (val instanceof Date) {
        val = Utilities.formatDate(val, ORTHO_TZ, key === 'นัดถัดไปเวลา' ? 'HH:mm' : 'yyyy-MM-dd');
      }
      o[key] = val;
    }
    out.push(o);
  }
  return out;
}

/* ===================== SETUP (รันครั้งเดียว) ===================== */
function setupOrtho() {
  orthoGetSheet_(SHEET_ORTHO, ORTHO_HEADERS);
  orthoGetSheet_(SHEET_ORTHO_LOG, ORTHO_LOG_HEADERS);
  Logger.log('สร้าง sheet ortho / ortho_log เรียบร้อย');
}
