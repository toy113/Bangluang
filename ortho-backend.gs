/**********************************************************************
 * Bangluang Dental — ORTHO / LINE OA Backend  (Google Apps Script)
 * ขั้นที่ 1: backend ระบบจัดฟัน + ผูกบัญชี LINE (HN + เบอร์โทร)
 *
 * วิธีใช้ครั้งแรก:
 *   1) ใส่ LINE_TOKEN (Channel access token จาก LINE Developers Console)
 *   2) รัน setupOrtho() หนึ่งครั้ง  -> สร้าง sheet ortho / ortho_log
 *   3) ดู MERGE comment: ถ้าโปรเจกต์เดิมมี doGet/doPost อยู่แล้ว
 *      ให้ก๊อป branch ของ ortho เข้าไปในของเดิม อย่าสร้างซ้ำ
 **********************************************************************/

/* ============================ CONFIG ============================ */
var LINE_TOKEN      = 'cwTKCta3n3WjIO/ZZ1a6iEwGDMtWQcKuCc6Fd7snhB1Zq734zwa9JL+29IpHM1vBQt/RUv7SYcXDSRvubK4v1GN1i43OyMdZ8pXfA36deWzB4R50NyGAsW+ingrPXMe911z9AIckrrznm98mM95iYQdB04t89/1O/w1cDnyilFU=';
var SHEET_ORTHO     = 'ortho';
var SHEET_ORTHO_LOG = 'ortho_log';
var SHEET_PATIENTS  = 'คนไข้';
// LIFF หน้าผูกบัญชี (จะได้ ID ตอนทำ step 3) — ใช้ตอบกลับคน follow ใหม่
var LIFF_BIND_URL   = 'https://liff.line.me/2010461984-kt5dSgin';

var ORTHO_HEADERS = ['hn','ชื่อ','lineUserId','แบบจัด','หมอ','วันเริ่ม','แผนเดือน',
  'phase','ค่ารักษารวม','จ่ายแล้ว','คงเหลือ','งวดถัดไปวันที่','งวดถัดไปจำนวน',
  'นัดถัดไป','note','updatedAt'];
var ORTHO_LOG_HEADERS = ['hn','วันที่','ทำอะไร','ลวด','ยาง','หมอ','note'];

var TZ = 'Asia/Bangkok';

/* ===================== ROUTING (MERGE จุดนี้) ===================== */
/* ถ้าโปรเจกต์เดิมมี doGet แล้ว ให้ย้าย 3 บรรทัด if(...) ไปไว้ต้น doGet เดิม */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'orthoGet')  return jsonOut_(orthoGetByLineId(p.lineUserId));
  if (p.action === 'orthoBind') return jsonOut_(orthoBind(p.lineUserId, p.hn, p.phone));
  if (p.action === 'orthoList') return jsonOut_(orthoList());      // ใช้ใน admin tab
  return jsonOut_({ ok: true, msg: 'ortho backend alive' });
}

/* ถ้าโปรเจกต์เดิมมี doPost แล้ว ให้รวม branch LINE webhook + action เข้าไป */
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}

  // 1) LINE webhook — body จะมี events[] เสมอ
  if (body && body.events) {
    handleLineWebhook_(body.events);
    return ContentService.createTextOutput('OK');
  }

  // 2) action จาก LIFF / admin tab
  var action = body.action || (e.parameter && e.parameter.action);
  if (action === 'orthoBind')   return jsonOut_(orthoBind(body.lineUserId, body.hn, body.phone));
  if (action === 'orthoGet')    return jsonOut_(orthoGetByLineId(body.lineUserId));
  if (action === 'orthoSave')   return jsonOut_(orthoSave(body.row));     // admin: เพิ่ม/แก้ profile
  if (action === 'orthoLogAdd') return jsonOut_(orthoLogAdd(body.log));   // admin: เพิ่ม log adjust
  if (action === 'orthoSetLine')return jsonOut_(orthoSetLineId(body.hn, body.lineUserId)); // admin ผูกมือ (fallback)

  return jsonOut_({ ok: false, error: 'unknown action' });
}

/* ======================= BINDING (verify) ======================= */
/* คนไข้กรอก HN + เบอร์ใน LIFF -> ตรวจกับชีต คนไข้ -> ผูก lineUserId */
function orthoBind(lineUserId, hn, phone) {
  if (!lineUserId || !hn || !phone) return { ok: false, error: 'missing_field' };

  hn = normHN_(hn);
  var pIn = normPhone_(phone);

  var pats = sheetToObjects_(SHEET_PATIENTS);
  var match = null;
  for (var i = 0; i < pats.length; i++) {
    var r = pats[i];
    if (normHN_(r['hn'] || r['HN'] || r['Hn']) !== hn) continue;
    // หาคอลัมน์เบอร์โทร (เผื่อชื่อหัวต่างกัน)
    var phoneCell = r['เบอร์โทร'] || r['เบอร์'] || r['โทร'] || r['phone'] || r['tel'] || '';
    if (normPhone_(phoneCell) === pIn) { match = r; break; }
  }
  if (!match) return { ok: false, error: 'not_found' }; // HN+เบอร์ ไม่ตรงกัน

  var name = match['ชื่อ'] || match['name'] || match['ชื่อ-นามสกุล'] || '';
  orthoSetLineId(hn, lineUserId, name); // upsert: มี row อยู่แล้ว->อัปเดต, ยังไม่มี->สร้าง
  return { ok: true, hn: hn, name: name };
}

/* ===================== READ (สำหรับ LIFF) ===================== */
function orthoGetByLineId(lineUserId) {
  if (!lineUserId) return { ok: false, error: 'missing_field' };
  var rows = sheetToObjects_(SHEET_ORTHO);
  var rec = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].lineUserId) === String(lineUserId)) { rec = rows[i]; break; }
  }
  if (!rec) return { ok: true, bound: false };

  var logs = sheetToObjects_(SHEET_ORTHO_LOG).filter(function (l) {
    return normHN_(l.hn) === normHN_(rec.hn);
  });
  // เรียง log ใหม่สุดก่อน
  logs.sort(function (a, b) { return String(b['วันที่']).localeCompare(String(a['วันที่'])); });
  return { ok: true, bound: true, profile: rec, logs: logs };
}

/* ===================== WRITE (admin tab) ===================== */
function orthoList() {
  return { ok: true, rows: sheetToObjects_(SHEET_ORTHO) };
}

/* upsert profile ทั้งแถว by hn */
function orthoSave(row) {
  if (!row || !row.hn) return { ok: false, error: 'missing_hn' };
  var sh = getSheet_(SHEET_ORTHO, ORTHO_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data[0];
  var hnCol = head.indexOf('hn');
  var hn = normHN_(row.hn);

  row.updatedAt = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');

  // หาแถวเดิม
  var foundRow = -1;
  for (var r = 1; r < data.length; r++) {
    if (normHN_(data[r][hnCol]) === hn) { foundRow = r + 1; break; }
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
  return { ok: true, hn: hn };
}

function orthoLogAdd(log) {
  if (!log || !log.hn) return { ok: false, error: 'missing_hn' };
  var sh = getSheet_(SHEET_ORTHO_LOG, ORTHO_LOG_HEADERS);
  var head = sh.getDataRange().getValues()[0];
  if (!log['วันที่']) log['วันที่'] = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var rowArr = head.map(function (h) { return (log[h] !== undefined && log[h] !== null) ? log[h] : ''; });
  sh.appendRow(rowArr);
  return { ok: true };
}

/* ผูก/อัปเดต lineUserId ให้ hn (ใช้ทั้งตอน bind อัตโนมัติ และ admin ผูกมือ) */
function orthoSetLineId(hn, lineUserId, nameIfNew) {
  hn = normHN_(hn);
  var sh = getSheet_(SHEET_ORTHO, ORTHO_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data[0];
  var hnCol = head.indexOf('hn');
  var luCol = head.indexOf('lineUserId');

  for (var r = 1; r < data.length; r++) {
    if (normHN_(data[r][hnCol]) === hn) {
      sh.getRange(r + 1, luCol + 1).setValue(lineUserId);
      return { ok: true, updated: true, hn: hn };
    }
  }
  // ยังไม่มี profile -> สร้าง row ขั้นต่ำ ให้ admin มาเติมข้อมูลทีหลัง
  var newRow = head.map(function (h) {
    if (h === 'hn') return hn;
    if (h === 'lineUserId') return lineUserId;
    if (h === 'ชื่อ') return nameIfNew || '';
    if (h === 'updatedAt') return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    return '';
  });
  sh.appendRow(newRow);
  return { ok: true, created: true, hn: hn };
}

/* ===================== LINE WEBHOOK ===================== */
function handleLineWebhook_(events) {
  events.forEach(function (ev) {
    try {
      if (ev.type === 'follow') {
        replyLine_(ev.replyToken, [
          textMsg_('สวัสดีค่ะ 🦷 ยินดีต้อนรับสู่คลินิกทันตกรรมบางหลวง\n\nกดเมนู "ข้อมูลของฉัน" ด้านล่างเพื่อผูกบัญชีคนไข้จัดฟันของคุณค่ะ'),
          textMsg_('ผูกบัญชีที่นี่: ' + LIFF_BIND_URL)
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
function replyLine_(replyToken, messages) {
  if (!replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true
  });
}
function pushLine_(to, messages) {
  if (!to) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({ to: to, messages: messages }),
    muteHttpExceptions: true
  });
}
function textMsg_(t) { return { type: 'text', text: t }; }

/* ===================== UTIL ===================== */
function normHN_(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase();
}
// เก็บเฉพาะตัวเลข, แปลง +66 / 66 ขึ้นต้น -> 0 ; เทียบ 9 หลักท้ายกันพลาด
function normPhone_(v) {
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('66') === 0 && d.length >= 11) d = '0' + d.slice(2);
  return d.slice(-9);
}
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}
function sheetToObjects_(name) {
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
      // แปลง Date -> string เพื่อส่ง JSON
      if (val instanceof Date) val = Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
      o[key] = val;
    }
    out.push(o);
  }
  return out;
}

/* ===================== SETUP (รันครั้งเดียว) ===================== */
function setupOrtho() {
  getSheet_(SHEET_ORTHO, ORTHO_HEADERS);
  getSheet_(SHEET_ORTHO_LOG, ORTHO_LOG_HEADERS);
  Logger.log('สร้าง sheet ortho / ortho_log เรียบร้อย');
}
