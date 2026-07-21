// ============================================================
//  GOOGLE APPS SCRIPT — Bangluang Dental (ปรับปรุงล่าสุด)
//  ใช้ Utilities.formatDate เพื่อแปลง Date → string ให้ตรง timezone ไทย
//
//  หมายเหตุ: งานฝั่งจัดฟัน (ortho) + LINE webhook อยู่ในไฟล์ ortho-backend.gs
//  doGet/doPost ด้านล่างเรียก orthoRouteGet_/orthoRoutePost_ เป็นบรรทัดแรก
//  ถ้าไม่ใช่คำขอของ ortho ทั้งสองจะคืน null แล้วโค้ดเดิมทำงานต่อตามปกติ
// ============================================================

var TZ = 'Asia/Bangkok';

function cellToStr(cell, colName) {
  if (cell === null || cell === undefined || cell === '') return '';
  if (cell instanceof Date) {
    var col = String(colName).toLowerCase();
    if (col === 'date' || col === 'addedat' || col === 'treatdate') {
      return Utilities.formatDate(cell, TZ, 'yyyy-MM-dd');
    }
    if (col === 'time') {
      return Utilities.formatDate(cell, TZ, 'HH:mm');
    }
    return Utilities.formatDate(cell, TZ, 'yyyy-MM-dd HH:mm');
  }
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  // ป้องกัน Sheets auto-detect เลขล้วนๆ (เช่น id ที่เป็น Date.now().toString()) เป็น Number
  // แล้วทำให้ฝั่ง client เทียบ id ด้วย === ไม่ตรงกัน (number !== string)
  return String(cell);
}

// ============================================================
//  ใบรับรองแพทย์ — log เอกสารที่เคยออก + เลขที่รันต่อปี (พ.ศ.)
// ============================================================
var CERT_HEADERS_ = ['docNo','issuedAt','treatId','hn','patName','age','treatDate','proc','docId','docFullName','docLicense','needsRest','restDays','restStart','restEnd','purpose'];

function getCertificateSheet_() {
  return orthoGetSheet_('certificates', CERT_HEADERS_);
}

function nextCertDocNo_(sh, beYear) {
  var vals = sh.getDataRange().getValues();
  var prefix = 'บล.' + beYear + '/';
  var maxSeq = 0;
  for (var i = 1; i < vals.length; i++) {
    var docNo = String(vals[i][0] || '');
    if (docNo.indexOf(prefix) === 0) {
      var seq = parseInt(docNo.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return prefix + ('0000' + (maxSeq + 1)).slice(-4);
}

function certRowToObj_(hdr, row) {
  var obj = {};
  // ใช้ cellToStr เหมือน getAll เพื่อกัน Sheets auto-convert วันที่/ตัวเลขล้วนๆ
  // เป็น Date/Number object แล้วหลุดไปเป็น ISO timestamp ตอน JSON.stringify (เช่น treatDate)
  for (var c = 0; c < hdr.length; c++) obj[hdr[c]] = cellToStr(row[c], hdr[c]);
  return obj;
}

// ============================================================
//  DAILY INSIGHT — แผนเตรียมตัวรายวันต่อหมอ จากตารางนัด (Claude API)
//  ตั้งค่า CLAUDE_API_KEY ใน Apps Script > Project Settings > Script Properties
//  ห้าม hardcode key ในไฟล์นี้ (ไฟล์นี้อยู่ใน git repo)
// ============================================================

function readSheetAsObjects_(sh) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var hdr = sh.getRange(1,1,1,lastCol).getValues()[0];
  var raw = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  var result = [];
  for (var i = 0; i < raw.length; i++) {
    var row = raw[i];
    var hasData = false;
    for (var c = 0; c < row.length; c++) { if (row[c] !== '' && row[c] !== null) { hasData = true; break; } }
    if (!hasData) continue;
    var obj = {};
    for (var c = 0; c < hdr.length; c++) obj[hdr[c]] = cellToStr(row[c], hdr[c]);
    result.push(obj);
  }
  return result;
}

function getDailyInsightSheet_() {
  return orthoGetSheet_('daily_insights', ['date','docId','generatedAt','resultJson']);
}

// รวมตารางนัดวันนี้ของหมอคนนี้ + ประวัติการรักษาล่าสุดของคนไข้แต่ละคน (ก่อนวันนี้)
function computeDailyAppointmentsAndHistory_(docName, dateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aptSh = ss.getSheetByName('ตารางนัด');
  var treatSh = ss.getSheetByName('บันทึกการรักษา');
  var appts = aptSh ? readSheetAsObjects_(aptSh) : [];
  var treatments = treatSh ? readSheetAsObjects_(treatSh) : [];

  var todays = appts.filter(function(a){
    return a.date === dateStr && a.docName === docName && a.status !== 'ยกเลิก';
  }).sort(function(a,b){ return String(a.time||'').localeCompare(String(b.time||'')); });

  var historyByHn = {};
  treatments.forEach(function(t){
    if (!t.hn || !t.date || t.date >= dateStr) return; // เอาแค่ประวัติก่อนวันนี้
    if (!historyByHn[t.hn] || t.date > historyByHn[t.hn].date) {
      historyByHn[t.hn] = { date: t.date, proc: t.proc || '' };
    }
  });

  return { appts: todays, historyByHn: historyByHn };
}

function buildDailyInsightPrompt_(docName, dateStr, appts, historyByHn) {
  var lines = [];
  lines.push('คุณเป็นผู้ช่วยเตรียมความพร้อมให้ทันตแพทย์ก่อนเริ่มวันทำงาน วิเคราะห์ตารางนัดวันนี้ต่อไปนี้');
  lines.push('อิงจากข้อมูลจริงที่ให้มาเท่านั้น ห้ามสมมติอาการ/ประวัติที่ไม่มีในข้อมูล');
  lines.push('');
  lines.push('หมอ: ' + docName);
  lines.push('วันที่: ' + dateStr);
  lines.push('จำนวนนัดวันนี้: ' + appts.length + ' ราย');
  lines.push('');
  lines.push('รายการนัดวันนี้ (เวลา, ชื่อคนไข้, HN, สาเหตุที่นัด, หมายเหตุ, ประวัติล่าสุดก่อนหน้า):');
  appts.forEach(function(a){
    var hist = historyByHn[a.hn];
    var histStr = hist ? ('เคยมาล่าสุดวันที่ ' + hist.date + ' ทำ: ' + hist.proc) : 'ไม่มีประวัติการรักษามาก่อน (คนไข้ใหม่)';
    lines.push('- ' + (a.time||'—') + ' | ' + (a.patName||'ไม่ระบุชื่อ') + ' | HN ' + (a.hn||'—') +
      ' | นัดเพื่อ: ' + (a.proc||'ไม่ระบุ') + (a.note ? (' | หมายเหตุ: '+a.note) : '') + ' | ' + histStr);
  });
  lines.push('');
  lines.push('ตอบกลับเป็น JSON ล้วน ๆ เท่านั้น ห้ามมี markdown code fence หรือข้อความอื่นนอก JSON รูปแบบนี้เป๊ะ ๆ:');
  lines.push('{"overview": "ภาพรวมวันนี้ 1-2 ประโยค ภาษาไทย เช่น จำนวนคนไข้ ความหนาแน่นของตาราง เคสที่ควรระวังเป็นพิเศษ", ' +
    '"patients": [{"time":"เวลานัด","name":"ชื่อคนไข้","note":"1 ประโยคสรุปสิ่งที่ควรรู้ก่อนเจอคนไข้คนนี้ อ้างอิงจากสาเหตุที่นัด+ประวัติที่ให้มา"}], ' +
    '"prep": ["สิ่งที่ควรเตรียมเป็นพิเศษก่อนเริ่มวัน ถ้ามี — ถ้าไม่มีอะไรพิเศษให้เป็น array ว่าง"]}');
  return lines.join('\n');
}

function callClaudeForInsight_(prompt) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า CLAUDE_API_KEY ใน Script Properties');

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var raw = resp.getContentText();
  if (code !== 200) throw new Error('Claude API error ' + code + ': ' + raw.slice(0,300));

  var body;
  try { body = JSON.parse(raw); }
  catch (e) { throw new Error('แปลง response หลักจาก Claude ไม่ได้ (' + code + '): ' + raw.slice(0,300)); }

  // หา content block ที่เป็น type:'text' จริงๆ แทนที่จะเดาว่า content[0] คือ text เสมอ
  // (ถ้ามี thinking block นำหน้า text block จะไม่ได้อยู่ตำแหน่ง [0])
  var contentArr = body.content || [];
  var textBlock = contentArr.filter(function(c){ return c && c.type === 'text'; })[0];
  var text = (textBlock && textBlock.text) || '';
  // กันเผื่อ Claude ห่อ JSON ด้วย ```json ทั้งที่ prompt สั่งห้ามแล้ว
  text = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  var parsed;
  try { parsed = JSON.parse(text); }
  catch (e) {
    var blockTypes = contentArr.map(function(c){ return c && c.type; }).join(',');
    throw new Error('แปลง JSON จากคำตอบ Claude ไม่ได้ — เนื้อหาที่ได้: ' + (text.slice(0,300) || '(ว่างเปล่า)') +
      ' | stop_reason: ' + (body.stop_reason||'-') + ' | content block types: [' + blockTypes + ']');
  }
  if (!parsed.overview || !Array.isArray(parsed.patients)) throw new Error('รูปแบบคำตอบจาก Claude ไม่ถูกต้อง: ' + text.slice(0,300));
  return parsed;
}

function doPost(e) {
  try {
    // ---- ORTHO + LINE webhook (อยู่ในไฟล์ ortho-backend.gs) ----
    var _ortho = orthoRoutePost_(e);
    if (_ortho) return _ortho;

    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // DELETE appointments/treatments/labs
    if (data.type === 'delete') {
      var map = { treatments: 'บันทึกการรักษา', labs: 'แลป', appointments: 'ตารางนัด' };
      var sh = ss.getSheetByName(map[data.data.type]);
      if (sh) {
        var ids = sh.getDataRange().getValues().map(function(r){ return String(r[0]); });
        var i = ids.indexOf(String(data.data.id));
        if (i > 0) sh.deleteRow(i + 1);
      }
      return ContentService.createTextOutput('ok');
    }

    // DELETE PATIENT
    if (data.type === 'delete_patient') {
      var sh = ss.getSheetByName('คนไข้');
      if (sh) {
        var hns = sh.getDataRange().getValues().map(function(r){ return String(r[0]); });
        var i = hns.indexOf(String(data.data.hn));
        if (i > 0) sh.deleteRow(i + 1);
      }
      return ContentService.createTextOutput('ok');
    }

    // SETTINGS
    if (data.type === 'settings') {
      var sh = ss.getSheetByName('settings');
      if (sh) {
        var r = data.data;
        // เพิ่ม header คอลัมน์ fullName/licenseNo อัตโนมัติถ้าชีตเดิมยังไม่มี (self-heal ไม่ต้องแก้ header เอง)
        var hdrRow = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),8)).getValues()[0];
        if (!hdrRow[6]) sh.getRange(1,7).setValue('fullName');
        if (!hdrRow[7]) sh.getRange(1,8).setValue('licenseNo');
        var ids = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
        var i = ids.indexOf(String(r.id));
        var row = [r.id, r.name, r.gender||'', r.specialty||'', r.share||50, r.pin||'', r.fullName||'', r.licenseNo||''];
        if (i < 1) sh.appendRow(row);
        else sh.getRange(i+1,1,1,row.length).setValues([row]);
      }
      return ContentService.createTextOutput('ok');
    }

    // PATIENTS
    if (data.type === 'patients') {
      var sh = ss.getSheetByName('คนไข้');
      if (sh) {
        var r = data.data;
        var hns = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
        var i = hns.indexOf(String(r.hn));
        var addedAt = r.addedAt ? String(r.addedAt) : '';
        var row = [String(r.hn||''), String(r.name||''), String(r.phone||''), String(r.lineId||''), r.sso?'TRUE':'FALSE', addedAt];
        if (i < 1) {
          sh.appendRow(row);
          if (addedAt) sh.getRange(sh.getLastRow(),6).setNumberFormat('@STRING@').setValue(addedAt);
        } else {
          sh.getRange(i+1,1,1,row.length).setValues([row]);
          if (addedAt) sh.getRange(i+1,6).setNumberFormat('@STRING@').setValue(addedAt);
        }
      }
      return ContentService.createTextOutput('ok');
    }

    // DAY NOTES
    if (data.type === 'day_notes') {
      // ล็อกกันสองคำขอพร้อมกัน (พิมพ์รัว ๆ / เปิดหลายเครื่อง) เห็น "ยังไม่มีแถวนี้" พร้อมกัน
      // แล้ว appendRow ซ้อนกันเป็นแถวซ้ำ (สาเหตุที่โน้ตเดือนสิงหาเพี้ยน)
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        var sh = ss.getSheetByName('day_notes');
        if (sh) {
          var r = data.data;
          var ids = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
          var matchRows = []; // sheet row numbers (1-based) ที่ id ตรงกัน ข้ามแถว header (idx 0)
          for (var idx = 1; idx < ids.length; idx++) {
            if (ids[idx] === String(r.id)) matchRows.push(idx + 1);
          }
          var row = [String(r.id), String(r.date||''), String(r.note||'')];
          if (matchRows.length === 0) {
            sh.appendRow(row);
          } else {
            // เขียนค่าล่าสุดลงแถวแรก แล้วลบแถวซ้ำที่เหลือทิ้ง (self-heal ข้อมูลเก่าที่เคยซ้ำ)
            sh.getRange(matchRows[0],1,1,row.length).setValues([row]);
            for (var k = matchRows.length - 1; k >= 1; k--) sh.deleteRow(matchRows[k]);
          }
        }
      } finally {
        lock.releaseLock();
      }
      return ContentService.createTextOutput('ok');
    }

    // SCH_SLOTS
    if (data.type === 'sch_slots') {
      var sh = ss.getSheetByName('sch_slots');
      if (sh) {
        var r = data.data;
        var ids = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
        var i = ids.indexOf(String(r.id));
        var row = [String(r.id), String(r.date||''), String(r.slots||'')];
        if (i < 1) sh.appendRow(row);
        else sh.getRange(i+1,1,1,row.length).setValues([row]);
      }
      return ContentService.createTextOutput('ok');
    }

    // RECALL
    if (data.type === 'recall') {
      var sh = ss.getSheetByName('recall');
      if (sh) {
        var r = data.data;
        var hns = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
        var i = hns.indexOf(String(r.hn));
        var row = [String(r.hn), String(r.status), String(r.updatedAt||'')];
        if (i < 1) sh.appendRow(row);
        else sh.getRange(i+1,1,1,row.length).setValues([row]);
      }
      return ContentService.createTextOutput('ok');
    }

    // APPOINTMENTS / TREATMENTS / LABS
    var sh;
    if (data.type === 'appointments') sh = ss.getSheetByName('ตารางนัด');
    else if (data.type === 'treatments') sh = ss.getSheetByName('บันทึกการรักษา');
    else if (data.type === 'labs') sh = ss.getSheetByName('แลป');

    if (!sh) return ContentService.createTextOutput('error: unknown type ' + data.type);

    var r = data.data;
    var ids = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
    var i = ids.indexOf(String(r.id));
    var rKeys = Object.keys(r);

    var hdr = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0];
    // จับคู่แต่ละ key กับคอลัมน์ตาม "ชื่อ header จริง" ไม่ใช่ตามลำดับใน object เหมือนเดิม
    // (ลำดับ key ใน object ไม่รับประกันว่าตรงกับลำดับคอลัมน์ในชีตเสมอไป — โดยเฉพาะถ้ามีคอลัมน์ blank ค้างอยู่)
    // key ไหนยังไม่มี header ให้เข้าไปแทรกในช่อง blank ที่มีอยู่ก่อน ถ้าไม่มีช่อง blank ค่อยเพิ่มคอลัมน์ใหม่ต่อท้าย
    rKeys.forEach(function(k){
      if (hdr.indexOf(k) === -1) {
        var blankIdx = hdr.indexOf('');
        if (blankIdx !== -1) {
          hdr[blankIdx] = k;
          sh.getRange(1, blankIdx+1).setValue(k);
        } else {
          hdr.push(k);
          sh.getRange(1, hdr.length).setValue(k);
        }
      }
    });
    // สร้าง row ตามตำแหน่งจริงของ header แต่ละคอลัมน์ (ไม่ใช่ตามลำดับ key ใน object)
    var row = hdr.map(function(h){
      if (!h) return '';
      var v = r[h];
      return (v===null||v===undefined)?'':v;
    });
    var dateCol = -1, timeCol = -1;
    for (var c = 0; c < hdr.length; c++) {
      var h = String(hdr[c]).toLowerCase();
      if (h === 'date') dateCol = c;
      if (h === 'time') timeCol = c;
    }

    var targetRow;
    if (i < 1) {
      sh.appendRow(row);
      targetRow = sh.getLastRow();
    } else {
      sh.getRange(i+1,1,1,row.length).setValues([row]);
      targetRow = i + 1;
    }

    // Force date และ time เป็น plain text เพื่อป้องกัน Sheets แปลงเป็น Date object
    if (dateCol >= 0 && r.date) {
      sh.getRange(targetRow, dateCol+1).setNumberFormat('@STRING@').setValue(String(r.date));
    }
    if (timeCol >= 0 && r.time) {
      sh.getRange(targetRow, timeCol+1).setNumberFormat('@STRING@').setValue(String(r.time));
    }

    return ContentService.createTextOutput('ok');

  } catch(err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

function doGet(e) {
  try {
    // ---- ORTHO (อยู่ในไฟล์ ortho-backend.gs) ----
    var _ortho = orthoRouteGet_(e);
    if (_ortho) return _ortho;

    var p = (e && e.parameter) || {};
    if (p.action === 'getAll') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var out = {};

      var tabs = ['ตารางนัด','บันทึกการรักษา','แลป','settings','คนไข้','day_notes','sch_slots','recall'];
      var keys = ['appointments','treatments','labs','settings','patients','day_notes','sch_slots','recall'];

      for (var t = 0; t < tabs.length; t++) {
        var sh = ss.getSheetByName(tabs[t]);
        if (!sh) { out[keys[t]] = []; continue; }

        var lastRow = sh.getLastRow();
        var lastCol = sh.getLastColumn();
        if (lastRow < 2 || lastCol < 1) { out[keys[t]] = []; continue; }

        var hdr = sh.getRange(1,1,1,lastCol).getValues()[0];
        var raw = sh.getRange(2,1,lastRow-1,lastCol).getValues();

        var result = [];
        for (var i = 0; i < raw.length; i++) {
          var row = raw[i];
          var hasData = false;
          for (var c = 0; c < row.length; c++) {
            if (row[c] !== '' && row[c] !== null) { hasData = true; break; }
          }
          if (!hasData) continue;
          var obj = {};
          for (var c = 0; c < hdr.length; c++) {
            obj[hdr[c]] = cellToStr(row[c], hdr[c]);
          }
          result.push(obj);
        }
        out[keys[t]] = result;
      }

      return ContentService
        .createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // เช็คว่าเคยออกใบรับรองแพทย์ให้ treatment นี้แล้วหรือยัง (สำหรับพิมพ์ซ้ำ)
    if (p.action === 'getCertificate') {
      var sh = getCertificateSheet_();
      var vals = sh.getDataRange().getValues();
      var hdr = vals[0];
      for (var i = 1; i < vals.length; i++) {
        if (String(vals[i][2]) === String(p.treatId)) {
          return ContentService.createTextOutput(JSON.stringify({ found: true, cert: certRowToObj_(hdr, vals[i]) })).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ found: false })).setMimeType(ContentService.MimeType.JSON);
    }

    // ออกใบรับรองแพทย์ — GET เหมือน generateInsight (POST ธรรมดาโดน CORS/redirect บล็อกไปไม่ถึง server)
    // idempotent ตาม treatId: ถ้าเคยออกแล้วคืนของเดิม (เลขที่เอกสารต้องคงที่ตอนพิมพ์ซ้ำ ไม่สร้างเลขใหม่)
    if (p.action === 'issueCertificate') {
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        var sh = getCertificateSheet_();
        var reqData = JSON.parse(p.data || '{}');
        var vals = sh.getDataRange().getValues();
        var hdr = vals[0];
        for (var i = 1; i < vals.length; i++) {
          if (String(vals[i][2]) === String(reqData.treatId)) {
            // เคยออกให้ treatment นี้แล้ว — คงเลขที่เอกสาร/วันที่ออกเดิมไว้ (idempotent)
            // แต่อัปเดตข้อมูลที่เหลือด้วยค่าล่าสุด เผื่อผู้ใช้แก้ไข (เช่น หัตถการ, อายุ) ก่อนพิมพ์ซ้ำ
            var updatedRow = [
              vals[i][0], vals[i][1], reqData.treatId||'', reqData.hn||'', reqData.patName||'', reqData.age||'',
              reqData.treatDate||'', reqData.proc||'', reqData.docId||'', reqData.docFullName||'', reqData.docLicense||'',
              reqData.needsRest ? 'TRUE' : 'FALSE', reqData.restDays||'', reqData.restStart||'', reqData.restEnd||'', reqData.purpose||''
            ];
            sh.getRange(i+1, 1, 1, updatedRow.length).setValues([updatedRow]);
            return ContentService.createTextOutput(JSON.stringify({ ok: true, reused: true, cert: certRowToObj_(hdr, updatedRow) })).setMimeType(ContentService.MimeType.JSON);
          }
        }
        var now = new Date();
        var beYear = Utilities.formatDate(now, TZ, 'yyyy') * 1 + 543;
        var docNo = nextCertDocNo_(sh, beYear);
        var row = [
          docNo, now.toISOString(), reqData.treatId||'', reqData.hn||'', reqData.patName||'', reqData.age||'',
          reqData.treatDate||'', reqData.proc||'', reqData.docId||'', reqData.docFullName||'', reqData.docLicense||'',
          reqData.needsRest ? 'TRUE' : 'FALSE', reqData.restDays||'', reqData.restStart||'', reqData.restEnd||'', reqData.purpose||''
        ];
        sh.appendRow(row);
        return ContentService.createTextOutput(JSON.stringify({ ok: true, reused: false, cert: certRowToObj_(hdr, row) })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    // เช็คว่าเคยสร้างแผนเตรียมตัวรายวันให้หมอคนนี้ วันนี้ ไว้แล้วหรือยัง (cache กันเรียก Claude API ซ้ำ)
    // ใช้ cellToStr(...,'date') แทน String(...) ตรงๆ — คอลัมน์ date ถูก Sheets auto-convert เป็น Date object
    // (ยืนยันจาก debug: ค่า "2026-07-21" ที่ appendRow ไปกลายเป็น Date เมื่ออ่านกลับ ทำให้ String() เทียบไม่ตรงกับ p.date เดิม
    // จึงหา cache ไม่เจอทุกครั้ง สร้างซ้ำเรื่อยๆ — เหมือน bug id/treatDate ที่เจอมาก่อนหน้านี้)
    if (p.action === 'getDailyInsight') {
      var sh = getDailyInsightSheet_();
      var vals = sh.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) {
        if (cellToStr(vals[i][0], 'date') === String(p.date) && String(vals[i][1]) === String(p.docId)) {
          return ContentService.createTextOutput(JSON.stringify({
            found: true, result: JSON.parse(vals[i][3]), generatedAt: vals[i][2]
          })).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ found: false })).setMimeType(ContentService.MimeType.JSON);
    }

    // สร้างแผนเตรียมตัวรายวัน — idempotent ตาม (date, docId) เหมือนใบรับรองแพทย์ กันกดซ้ำเปลือง API
    if (p.action === 'generateDailyInsight') {
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        var sh = getDailyInsightSheet_();
        var dateStr = p.date;
        var docId = p.docId;
        var docName = p.docName;
        var vals = sh.getDataRange().getValues();
        for (var i = 1; i < vals.length; i++) {
          if (cellToStr(vals[i][0], 'date') === String(dateStr) && String(vals[i][1]) === String(docId)) {
            return ContentService.createTextOutput(JSON.stringify({
              ok: true, reused: true, result: JSON.parse(vals[i][3]), generatedAt: vals[i][2]
            })).setMimeType(ContentService.MimeType.JSON);
          }
        }
        var data = computeDailyAppointmentsAndHistory_(docName, dateStr);
        if (!data.appts.length) {
          return ContentService.createTextOutput(JSON.stringify({ ok: true, empty: true })).setMimeType(ContentService.MimeType.JSON);
        }
        var prompt = buildDailyInsightPrompt_(docName, dateStr, data.appts, data.historyByHn);
        var result = callClaudeForInsight_(prompt);
        var now = new Date();
        sh.appendRow([dateStr, docId, now.toISOString(), JSON.stringify(result)]);
        // บังคับคอลัมน์ date เป็น plain text กัน Sheets auto-convert เป็น Date object (เหมือน date/time ใน treatments/appointments)
        sh.getRange(sh.getLastRow(), 1).setNumberFormat('@STRING@').setValue(String(dateStr));
        return ContentService.createTextOutput(JSON.stringify({
          ok: true, reused: false, result: result, generatedAt: now.toISOString()
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
    }

    return ContentService.createTextOutput('Bangluang Dental API ready');

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
