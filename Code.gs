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

// ============================================================
//  WEEKLY INSIGHT (สรุปรายสัปดาห์ + โปรโมชั่นจาก Claude API)
//  ตั้งค่า CLAUDE_API_KEY ใน Apps Script > Project Settings > Script Properties
//  ห้าม hardcode key ในไฟล์นี้ (ไฟล์นี้อยู่ใน git repo)
// ============================================================

function getInsightSheet_() {
  // orthoGetSheet_ อยู่ใน ortho-backend.gs แต่ทุกไฟล์ .gs ใช้ namespace เดียวกัน
  return orthoGetSheet_('insights', ['weekStart','generatedAt','statsJson','summary','promosJson']);
}

// หมายเหตุ: คำนวณทั้งหมดใน UTC-anchored space (ไม่ใช้ new Date(str) แบบ local parse)
// เพื่อไม่ให้ผลลัพธ์ขึ้นกับ default timezone ของ Apps Script runtime — กันเคส
// ที่ project timezone ไม่ตรงกับ TZ='Asia/Bangkok' แล้ววันที่เพี้ยนไป 1 วัน
function dateStrToUtc_(s) {
  var p = s.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1]-1, p[2]));
}
function addDaysUtc_(base, n) {
  return new Date(base.getTime() + n*86400000);
}
function fmtUtc_(x) {
  return Utilities.formatDate(x, 'UTC', 'yyyy-MM-dd');
}

function getWeekBounds_(refDate) {
  var todayStr = Utilities.formatDate(refDate, TZ, 'yyyy-MM-dd'); // วันที่ตามปฏิทินไทย (Bangkok) ล้วนๆ
  var dUtc = dateStrToUtc_(todayStr); // เที่ยงคืน UTC ของเลขปฏิทินเดียวกัน — ใช้แค่คำนวณวันในสัปดาห์/บวกลบวัน
  var dow = dUtc.getUTCDay(); // 0=อาทิตย์..6=เสาร์
  var isoDow = dow === 0 ? 7 : dow; // 1=จันทร์..7=อาทิตย์
  var thisMonUtc = addDaysUtc_(dUtc, -(isoDow - 1));
  var thisSunUtc = addDaysUtc_(thisMonUtc, 6);
  var lastMonUtc = addDaysUtc_(thisMonUtc, -7);
  var lastSunUtc = addDaysUtc_(thisMonUtc, -1);
  return {
    today: todayStr,
    thisWeekStart: fmtUtc_(thisMonUtc),
    thisWeekEnd: fmtUtc_(thisSunUtc),
    lastWeekStart: fmtUtc_(lastMonUtc),
    lastWeekEnd: fmtUtc_(lastSunUtc),
    daysSoFar: isoDow // 1..7 วันแล้วของสัปดาห์นี้ (จันทร์=1)
  };
}

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

function computeWeeklyStats_(bounds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var treatSh = ss.getSheetByName('บันทึกการรักษา');
  var aptSh = ss.getSheetByName('ตารางนัด');
  var patSh = ss.getSheetByName('คนไข้');

  var treatments = treatSh ? readSheetAsObjects_(treatSh) : [];
  var appointments = aptSh ? readSheetAsObjects_(aptSh) : [];
  var patients = patSh ? readSheetAsObjects_(patSh) : [];

  // ช่วงเทียบแบบ fair: เอาจำนวนวันเท่ากับสัปดาห์นี้ (daysSoFar) จากสัปดาห์ก่อน
  // (UTC-anchored เหมือน getWeekBounds_ กันวันเพี้ยนจาก timezone ของ runtime)
  var sameLastEnd = fmtUtc_(addDaysUtc_(dateStrToUtc_(bounds.lastWeekStart), bounds.daysSoFar - 1));

  function inRange(dateStr, start, end) { return dateStr && dateStr >= start && dateStr <= end; }
  function totalPrice(t) { return (+t.cash||0) + (+t.transfer||0) + (+t.sso||0); }

  function aggregate(rows, start, end) {
    var inWin = rows.filter(function(t){ return inRange(t.date, start, end); });
    var byDoc = {}, byProc = {}, revenue = 0;
    inWin.forEach(function(t){
      var price = totalPrice(t);
      revenue += price;
      var doc = t.docName || 'ไม่ระบุ';
      if (!byDoc[doc]) byDoc[doc] = { cases:0, revenue:0 };
      byDoc[doc].cases++; byDoc[doc].revenue += price;
      var procs = String(t.proc||'').split(',').map(function(p){return p.trim();}).filter(Boolean);
      procs.forEach(function(p){
        if (!byProc[p]) byProc[p] = { cases:0, revenue:0 };
        byProc[p].cases++; byProc[p].revenue += price;
      });
    });
    var topProcs = Object.keys(byProc).map(function(p){ return { name:p, cases:byProc[p].cases, revenue:byProc[p].revenue }; })
      .sort(function(a,b){ return b.cases - a.cases; }).slice(0,5);
    return { cases: inWin.length, revenue: revenue, byDoc: byDoc, topProcs: topProcs };
  }

  function aggregateAppointments(rows, start, end) {
    var inWin = rows.filter(function(a){ return inRange(a.date, start, end); });
    var cancelled = inWin.filter(function(a){ return a.status === 'ยกเลิก'; }).length;
    return { total: inWin.length, cancelled: cancelled, cancelRate: inWin.length ? cancelled/inWin.length : 0 };
  }

  // recall ค้างนาน (snapshot ปัจจุบัน) — logic เดียวกับ renderRecall() ฝั่ง client: THRESHOLD_DAYS=335
  var THRESHOLD_DAYS = 335;
  var lastTreatByHn = {};
  treatments.forEach(function(t){
    if (!t.hn || !t.date) return;
    if (!lastTreatByHn[t.hn] || t.date > lastTreatByHn[t.hn]) lastTreatByHn[t.hn] = t.date;
  });
  var nowMs = new Date(bounds.today + 'T00:00:00').getTime();
  var overdueCount = 0;
  patients.forEach(function(p){
    var isSso = p.sso === true || String(p.sso).toUpperCase() === 'TRUE';
    if (!isSso) return;
    var lastDate = lastTreatByHn[p.hn];
    var diffDays = lastDate ? Math.floor((nowMs - new Date(lastDate+'T00:00:00').getTime())/86400000) : 9999;
    if (diffDays >= THRESHOLD_DAYS && diffDays < 9999) overdueCount++;
  });

  return {
    meta: { today: bounds.today, thisWeekStart: bounds.thisWeekStart, daysSoFar: bounds.daysSoFar,
            lastWeekStart: bounds.lastWeekStart, lastWeekEnd: bounds.lastWeekEnd },
    thisWeek: aggregate(treatments, bounds.thisWeekStart, bounds.today),
    lastWeekSameDays: aggregate(treatments, bounds.lastWeekStart, sameLastEnd),
    lastWeekFull: aggregate(treatments, bounds.lastWeekStart, bounds.lastWeekEnd),
    appointments: {
      thisWeek: aggregateAppointments(appointments, bounds.thisWeekStart, bounds.today),
      lastWeekSameDays: aggregateAppointments(appointments, bounds.lastWeekStart, sameLastEnd)
    },
    ssoRecallOverdueCount: overdueCount
  };
}

function buildInsightPrompt_(stats) {
  var tw = stats.thisWeek, lwS = stats.lastWeekSameDays, lwF = stats.lastWeekFull;
  var procStr = function(list){ return list.map(function(p){ return p.name+' ('+p.cases+' ครั้ง)'; }).join(', ') || '—'; };
  var lines = [];
  lines.push('คุณเป็นผู้ช่วยวิเคราะห์ข้อมูลคลินิกทันตกรรม วิเคราะห์สถิติจริงต่อไปนี้แล้วให้คำแนะนำ อิงจากตัวเลขจริงเท่านั้น ห้ามสมมติข้อมูลที่ไม่มีในสถิติ');
  lines.push('');
  lines.push('สัปดาห์นี้ (' + stats.meta.thisWeekStart + ' ถึง ' + stats.meta.today + ', ' + stats.meta.daysSoFar + ' วัน):');
  lines.push('- เคสรักษา: ' + tw.cases + ' ครั้ง, รายได้รวม: ' + Math.round(tw.revenue) + ' บาท');
  lines.push('- นัดหมาย: ' + stats.appointments.thisWeek.total + ' นัด, ยกเลิก: ' + stats.appointments.thisWeek.cancelled + ' นัด (' + Math.round(stats.appointments.thisWeek.cancelRate*100) + '%)');
  lines.push('- หัตถการยอดนิยม: ' + procStr(tw.topProcs));
  lines.push('');
  lines.push('สัปดาห์ก่อน ช่วงเดียวกัน (' + stats.meta.daysSoFar + ' วันแรก เทียบแบบ fair):');
  lines.push('- เคสรักษา: ' + lwS.cases + ' ครั้ง, รายได้รวม: ' + Math.round(lwS.revenue) + ' บาท');
  lines.push('- นัดหมาย: ' + stats.appointments.lastWeekSameDays.total + ' นัด, ยกเลิก: ' + stats.appointments.lastWeekSameDays.cancelled + ' นัด');
  lines.push('');
  lines.push('สัปดาห์ก่อนทั้งสัปดาห์ (' + stats.meta.lastWeekStart + ' ถึง ' + stats.meta.lastWeekEnd + ', 7 วันเต็ม):');
  lines.push('- เคสรักษา: ' + lwF.cases + ' ครั้ง, รายได้รวม: ' + Math.round(lwF.revenue) + ' บาท');
  lines.push('- หัตถการยอดนิยม: ' + procStr(lwF.topProcs));
  lines.push('');
  lines.push('คนไข้ประกันสังคมที่ค้าง recall (ไม่มาเกิน ~11 เดือน): ' + stats.ssoRecallOverdueCount + ' คน');
  lines.push('');
  var docs = {};
  Object.keys(tw.byDoc).forEach(function(d){ docs[d] = true; });
  Object.keys(lwS.byDoc).forEach(function(d){ docs[d] = true; });
  lines.push('รายได้แยกตามหมอ (สัปดาห์นี้ vs สัปดาห์ก่อนช่วงเดียวกัน):');
  Object.keys(docs).forEach(function(d){
    var a = tw.byDoc[d] || {cases:0,revenue:0};
    var b = lwS.byDoc[d] || {cases:0,revenue:0};
    lines.push('- ' + d + ': ' + a.cases + ' ครั้ง/' + Math.round(a.revenue) + ' บาท (ก่อนหน้า ' + b.cases + ' ครั้ง/' + Math.round(b.revenue) + ' บาท)');
  });
  lines.push('');
  lines.push('ตอบกลับเป็น JSON ล้วน ๆ เท่านั้น ห้ามมี markdown code fence หรือข้อความอื่นนอก JSON รูปแบบนี้เป๊ะ ๆ:');
  lines.push('{"summary": "สรุปภาพรวมสัปดาห์นี้ 2-4 ประโยค ภาษาไทย", "promos": [{"title": "ชื่อโปรสั้นๆ", "detail": "รายละเอียด 1-2 ประโยค อ้างอิงตัวเลขข้างต้น"}, ... รวม 2 ถึง 4 รายการ]}');
  return lines.join('\n');
}

function generateWeeklyInsight_(stats) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) throw new Error('ยังไม่ได้ตั้งค่า CLAUDE_API_KEY ใน Script Properties');

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: buildInsightPrompt_(stats) }]
    }),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code !== 200) throw new Error('Claude API error ' + code + ': ' + resp.getContentText().slice(0,300));

  var body = JSON.parse(resp.getContentText());
  var text = (body.content && body.content[0] && body.content[0].text) || '';
  // กันเผื่อ Claude ห่อ JSON ด้วย ```json ทั้งที่ prompt สั่งห้ามแล้ว
  text = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  var parsed = JSON.parse(text);
  if (!parsed.summary || !Array.isArray(parsed.promos)) throw new Error('รูปแบบคำตอบจาก Claude ไม่ถูกต้อง');
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

    // GENERATE WEEKLY INSIGHT (เรียก Claude API วิเคราะห์ + เสนอโปรโมชั่น — manager กดเองเท่านั้น)
    if (data.type === 'generate_insight') {
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        var bounds = getWeekBounds_(new Date());
        var sh = getInsightSheet_();
        var vals = sh.getDataRange().getValues();
        var rowIdx = -1;
        for (var vi = 1; vi < vals.length; vi++) {
          if (String(vals[vi][0]) === bounds.thisWeekStart) { rowIdx = vi + 1; break; }
        }
        var force = !!(data.data && data.data.force);
        // กันสร้างซ้ำถี่เกินไป (กดรัว / สองคนกดพร้อมกัน) เว้นแต่ client ยืนยัน force มา
        if (rowIdx > 0 && !force) {
          var existingGeneratedAt = vals[rowIdx-1][1];
          var ageMs = new Date() - new Date(existingGeneratedAt);
          if (ageMs < 5*60*1000) {
            return ContentService.createTextOutput(JSON.stringify({
              alreadyRecent: true, weekStart: bounds.thisWeekStart, generatedAt: existingGeneratedAt,
              stats: JSON.parse(vals[rowIdx-1][2]||'{}'), summary: vals[rowIdx-1][3], promos: JSON.parse(vals[rowIdx-1][4]||'[]')
            })).setMimeType(ContentService.MimeType.JSON);
          }
        }
        var stats = computeWeeklyStats_(bounds);
        var result = generateWeeklyInsight_(stats);
        var generatedAt = new Date().toISOString(); // UTC ISO ชัดเจน กัน client แปลผิดเป็น local time ของเครื่องดู
        var row = [bounds.thisWeekStart, generatedAt, JSON.stringify(stats), result.summary, JSON.stringify(result.promos)];
        if (rowIdx < 1) sh.appendRow(row);
        else sh.getRange(rowIdx,1,1,row.length).setValues([row]);
        return ContentService.createTextOutput(JSON.stringify({
          ok: true, weekStart: bounds.thisWeekStart, generatedAt: generatedAt, stats: stats, summary: result.summary, promos: result.promos
        })).setMimeType(ContentService.MimeType.JSON);
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
      } finally {
        lock.releaseLock();
      }
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

    // สรุปรายสัปดาห์ล่าสุดที่ generate ไว้แล้ว — endpoint แยกจาก getAll ตั้งใจ ไม่ให้โหลดหนักขึ้นทุก 4 วิ
    if (p.action === 'getInsight') {
      var sh = getInsightSheet_();
      var vals = sh.getDataRange().getValues();
      if (vals.length < 2) {
        return ContentService.createTextOutput(JSON.stringify({ found: false })).setMimeType(ContentService.MimeType.JSON);
      }
      var last = vals[vals.length - 1];
      return ContentService.createTextOutput(JSON.stringify({
        found: true, weekStart: last[0], generatedAt: last[1],
        stats: JSON.parse(last[2]||'{}'), summary: last[3], promos: JSON.parse(last[4]||'[]')
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput('Bangluang Dental API ready');

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
