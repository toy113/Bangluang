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
    if (col === 'date' || col === 'addedat') {
      return Utilities.formatDate(cell, TZ, 'yyyy-MM-dd');
    }
    if (col === 'time') {
      return Utilities.formatDate(cell, TZ, 'HH:mm');
    }
    return Utilities.formatDate(cell, TZ, 'yyyy-MM-dd HH:mm');
  }
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return cell;
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
        var ids = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
        var i = ids.indexOf(String(r.id));
        var row = [r.id, r.name, r.gender||'', r.specialty||'', r.share||50, r.pin||''];
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
      var sh = ss.getSheetByName('day_notes');
      if (sh) {
        var r = data.data;
        var ids = sh.getDataRange().getValues().map(function(row){ return String(row[0]); });
        var i = ids.indexOf(String(r.id));
        var row = [String(r.id), String(r.date||''), String(r.note||'')];
        if (i < 1) sh.appendRow(row);
        else sh.getRange(i+1,1,1,row.length).setValues([row]);
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
    var row = Object.keys(r).map(function(k){ var v=r[k]; return (v===null||v===undefined)?'':v; });

    // หา index ของ column date และ time จาก header row
    var hdr = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
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

    return ContentService.createTextOutput('Bangluang Dental API ready');

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
