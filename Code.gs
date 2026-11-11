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

// ============================================================
//  ใบเสร็จรับเงิน (ชีต receipts) — เลขที่รายปี BL69-00001 · รวมหลายรายการรักษาของคนไข้ในวันเดียว
//  key = รหัสรายการรักษาที่รวมในใบ (เรียง) → ออกซ้ำชุดเดิม = ได้เลขเดิม (พิมพ์ซ้ำ)
//  รายการรักษาหนึ่งรายการอยู่ได้ในใบเสร็จที่ยังใช้งานใบเดียว · ยกเลิกแล้วเลขไม่ถูกนำกลับมาใช้
// ============================================================
var RECEIPT_HEADERS_ = ['receiptNo','issuedAt','date','key','hn','patName','address','items','subtotal','sso','paid','cash','transfer','bank','doctors','treatIds','issuedBy','status','voidReason','voidAt','voidBy','printCount','note'];
var RECEIPT_CFG_DEFAULT_ = { name:'คลินิกทันตกรรมบางหลวง', nameEn:'Bangluang Dental Clinic', address:'119/14 ถ.ปทุมธานีสายใน อ.เมืองปทุมธานี จ.ปทุมธานี 12000', phone:'095-947-6759', taxId:'', footer:'ขอบคุณที่ใช้บริการค่ะ' };
function getReceiptSheet_() {
  var sh = orthoGetSheet_('receipts', RECEIPT_HEADERS_);
  try { sh.getRange('A:A').setNumberFormat('@STRING@'); sh.getRange('C:C').setNumberFormat('@STRING@'); } catch (e) {}
  return sh;
}
function receiptCfg_() {
  var c = {}; try { c = JSON.parse(PropertiesService.getScriptProperties().getProperty('RECEIPT_CFG') || '{}'); } catch (e) {}
  var out = {}; for (var k in RECEIPT_CFG_DEFAULT_) out[k] = (c[k] === undefined || c[k] === null) ? RECEIPT_CFG_DEFAULT_[k] : c[k];
  return out;
}
function receiptRowToObj_(hdr, row) {
  var o = {}; hdr.forEach(function (h, i) { o[h] = row[i] instanceof Date ? Utilities.formatDate(row[i], TZ, h === 'date' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss") : row[i]; });
  try { o.items = JSON.parse(o.items || '[]'); } catch (e) { o.items = []; }
  o.treatIds = String(o.treatIds || '').split(',').filter(String);
  o.printCount = +o.printCount || 0;
  return o;
}
function nextReceiptNo_(vals, beYear) {
  var prefix = 'BL' + String(beYear).slice(-2) + '-', maxSeq = 0;
  for (var i = 1; i < vals.length; i++) {
    var no = String(vals[i][0] || '');
    if (no.indexOf(prefix) === 0) { var n = parseInt(no.slice(prefix.length), 10); if (!isNaN(n) && n > maxSeq) maxSeq = n; }
  }
  return prefix + ('00000' + (maxSeq + 1)).slice(-5);
}
function receiptJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function receiptRoute_(p) {
  var a = p.action;
  if (a === 'getReceipts') {
    var sh = getReceiptSheet_(), vals = sh.getDataRange().getValues(), hdr = vals[0], out = [];
    var ids = String(p.treatIds || '').split(',').filter(String), month = String(p.month || ''), hn = String(p.hn || '');
    for (var i = 1; i < vals.length; i++) {
      var r = receiptRowToObj_(hdr, vals[i]);
      if (ids.length && !r.treatIds.some(function (x) { return ids.indexOf(x) !== -1; })) continue;
      if (month && String(r.date).slice(0, 7) !== month) continue;
      if (hn && String(r.hn) !== hn) continue;
      out.push(r);
    }
    return receiptJson_({ ok: true, receipts: out, cfg: receiptCfg_() });
  }
  if (a === 'saveReceiptCfg') {
    var c = {}; try { c = JSON.parse(p.data || '{}'); } catch (e) {}
    var cur = receiptCfg_(); for (var k in RECEIPT_CFG_DEFAULT_) if (c[k] !== undefined) cur[k] = String(c[k]).slice(0, 300);
    PropertiesService.getScriptProperties().setProperty('RECEIPT_CFG', JSON.stringify(cur));
    return receiptJson_({ ok: true, cfg: cur });
  }
  if (a === 'issueReceipt' || a === 'voidReceipt') {
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      var sh = getReceiptSheet_(), vals = sh.getDataRange().getValues(), hdr = vals[0];
      var col = function (h) { return hdr.indexOf(h); };
      if (a === 'voidReceipt') {
        if (AUTH_CTX && AUTH_CTX.role !== 'manager') return receiptJson_({ ok: false, error: 'เฉพาะผู้จัดการยกเลิกใบเสร็จได้' });
        if (!String(p.reason || '').trim()) return receiptJson_({ ok: false, error: 'ต้องระบุเหตุผลการยกเลิก' });
        for (var i = 1; i < vals.length; i++) {
          if (String(vals[i][0]) === String(p.receiptNo)) {
            if (String(vals[i][col('status')]) === 'void') return receiptJson_({ ok: false, error: 'ใบเสร็จนี้ถูกยกเลิกไปแล้ว' });
            sh.getRange(i + 1, col('status') + 1).setValue('void');
            sh.getRange(i + 1, col('voidReason') + 1).setValue(String(p.reason || '').slice(0, 200));
            sh.getRange(i + 1, col('voidAt') + 1).setValue(new Date().toISOString());
            sh.getRange(i + 1, col('voidBy') + 1).setValue(String((AUTH_CTX && AUTH_CTX.id) ? AUTH_CTX.id + ' / ' + (p.by || '') : (p.by || '')).slice(0, 80));
            return receiptJson_({ ok: true });
          }
        }
        return receiptJson_({ ok: false, error: 'ไม่พบใบเสร็จเลขที่ ' + p.receiptNo });
      }
      var d = {}; try { d = JSON.parse(p.data || '{}'); } catch (e) { return receiptJson_({ ok: false, error: 'ข้อมูลไม่ถูกต้อง' }); }
      var ids = (d.treatIds || []).map(String).filter(String).sort();
      if (!ids.length) return receiptJson_({ ok: false, error: 'ไม่มีรายการรักษา' });
      var key = ids.join(',');
      var rowVals = function (no, issuedAt, pc) {
        return RECEIPT_HEADERS_.map(function (h) {
          switch (h) {
            case 'receiptNo': return no; case 'issuedAt': return issuedAt; case 'key': return key; case 'treatIds': return key;
            case 'items': return JSON.stringify(d.items || []); case 'status': return 'active'; case 'printCount': return pc;
            case 'voidReason': case 'voidAt': case 'voidBy': return '';
            case 'date': return String(d.date || '');
            case 'issuedBy': return String((d.issuedBy || '') + ((AUTH_CTX && AUTH_CTX.id) ? ' [' + AUTH_CTX.id + ']' : '')).slice(0, 80);
            default: return (d[h] === undefined || d[h] === null) ? '' : (typeof d[h] === 'object' ? JSON.stringify(d[h]) : d[h]);
          }
        });
      };
      for (var i = 1; i < vals.length; i++) {
        if (String(vals[i][col('status')]) === 'void') continue;
        var tIds = String(vals[i][col('treatIds')] || '').split(',');
        if (String(vals[i][col('key')]) === key) {   // ชุดเดิม = พิมพ์ซ้ำ → เลขเดิม เนื้อหาเดิมตามที่ออกไปแล้ว (ไม่แก้ไขย้อนหลัง) แค่นับครั้งที่พิมพ์ · แก้ไข = ยกเลิกแล้วออกใบใหม่
          var pc = (+vals[i][col('printCount')] || 0) + 1;
          sh.getRange(i + 1, col('printCount') + 1).setValue(pc);
          var cur = vals[i].slice(); cur[col('printCount')] = pc;
          return receiptJson_({ ok: true, reused: true, receipt: receiptRowToObj_(hdr, cur), cfg: receiptCfg_() });
        }
        if (ids.some(function (x) { return tIds.indexOf(x) !== -1; }))
          return receiptJson_({ ok: false, conflict: String(vals[i][0]), error: 'บางรายการอยู่ในใบเสร็จเลขที่ ' + vals[i][0] + ' แล้ว — ยกเลิกใบเดิมก่อนออกใบใหม่' });
      }
      var now = new Date(), beYear = Utilities.formatDate(now, TZ, 'yyyy') * 1 + 543;
      if (/^\d{4}-/.test(String(d.date || ''))) beYear = (+String(d.date).slice(0, 4)) + 543;   // ปีของเลขที่ = ปีของวันที่ใบเสร็จ
      var no = nextReceiptNo_(vals, beYear), row = rowVals(no, now.toISOString(), 1);
      sh.appendRow(row);
      sh.getRange(sh.getLastRow(), 1).setNumberFormat('@STRING@').setValue(no);
      sh.getRange(sh.getLastRow(), col('date') + 1).setNumberFormat('@STRING@').setValue(String(d.date || ''));
      return receiptJson_({ ok: true, reused: false, receipt: receiptRowToObj_(hdr, row), cfg: receiptCfg_() });
    } catch (err) { return receiptJson_({ ok: false, error: err.message }); }
    finally { lock.releaseLock(); }
  }
  return null;
}

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
  // ปิดถาวร (9 พ.ย. 69 ตามที่คลินิกสั่ง): ไม่ส่งข้อมูลคนไข้ออกไปยัง AI ภายนอก ไม่ว่าจะตั้ง CLAUDE_API_KEY ไว้หรือไม่
  throw new Error('ปิดฟีเจอร์แผนเตรียมตัววันนี้แล้ว (ไม่ส่งข้อมูลคนไข้ไปยัง AI)');
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

// ============================================================
//  FAST SYNC — getAll แบบมี cache + ส่งเฉพาะตารางที่เปลี่ยน
//  - เก็บ JSON ของแต่ละชีตไว้ใน CacheService (หมดอายุ GA_TTL วินาที)
//  - ทุกครั้งที่แอปบันทึกข้อมูล (doPost) จะ "เปลี่ยนรุ่น" ของชีตนั้น → cache เก่าใช้ไม่ได้ทันที
//  - หน้าเว็บส่ง hash ของข้อมูลที่มีอยู่ (h=key:hash|...) → ถ้าตรงกัน ไม่ต้องส่งข้อมูลซ้ำ
//  - แก้ชีตด้วยมือใน Google Sheets: แอปจะเห็นภายใน GA_TTL วินาที (หรือกด sync ในแอป = force)
// ============================================================
var GA_TABS = ['ตารางนัด','บันทึกการรักษา','แลป','settings','คนไข้','day_notes','sch_slots','recall'];
var GA_KEYS = ['appointments','treatments','labs','settings','patients','day_notes','sch_slots','recall'];
var GA_TTL = 120;
var GA_CHUNK = 25000; // ตัวอักษรต่อ 1 ช่อง cache (ไทย 3 ไบต์/ตัว → < 100KB)

function gaReadTab_(ss, tab) {
  var sh = ss.getSheetByName(tab);
  if (!sh) return [];
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var hdr = sh.getRange(1,1,1,lastCol).getValues()[0];
  var raw = sh.getRange(2,1,lastRow-1,lastCol).getValues();
  var result = [];
  for (var i = 0; i < raw.length; i++) {
    var row = raw[i], hasData = false;
    for (var c = 0; c < row.length; c++) { if (row[c] !== '' && row[c] !== null) { hasData = true; break; } }
    if (!hasData) continue;
    var obj = {};
    for (var c2 = 0; c2 < hdr.length; c2++) obj[hdr[c2]] = cellToStr(row[c2], hdr[c2]);
    if (tab === 'settings') delete obj.pin;   // ไม่ส่ง PIN ออกไปหน้าเว็บรุ่นใหม่ (รุ่นเก่าที่ยังไม่มีบัตรผ่านยังได้ PIN เดิม ระหว่างเปลี่ยนผ่าน — PIN ที่ตั้งใหม่เก็บแบบ hash ไม่อยู่ในชีต)
    result.push(obj);
  }
  return result;
}
function gaHash_(str) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8), h = '';
  for (var i = 0; i < 8; i++) { var v = (b[i] + 256) % 256; h += (v < 16 ? '0' : '') + v.toString(16); }
  return h;
}
function gaChunksGet_(cache, key, n) {
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push('ga2c:' + key + ':' + i);
  var got = cache.getAll(keys), out = [];
  for (var j = 0; j < n; j++) { var v = got[keys[j]]; if (v === null || v === undefined) return null; out.push(v); }
  return out.join('');
}
function gaChunksPut_(cache, key, json, h, gen) {
  try {
    var obj = {}, n = 0;
    for (var i = 0; i < json.length || n === 0; i += GA_CHUNK) { obj['ga2c:' + key + ':' + n] = json.slice(i, i + GA_CHUNK); n++; }
    cache.putAll(obj, GA_TTL);
    cache.put('ga2m:' + key, JSON.stringify({ h: h, n: n, g: gen }), GA_TTL);
  } catch (e) { /* cache เต็ม/ใหญ่เกิน → ทำงานต่อแบบไม่มี cache */ }
}
// เรียกหลังเขียนชีตสำเร็จ — ทำให้ cache ของชีตนั้นหมดสภาพทันที (ทุกเครื่องจะได้ข้อมูลใหม่รอบถัดไป)
function gaTouch_(key) {
  try { CacheService.getScriptCache().put('ga2g:' + key, String(Date.now()) + '-' + Math.random(), 21600); } catch (e) {}
}
function gaOk_(key) { gaTouch_(key); return ContentService.createTextOutput('ok'); }
/* กันสูตรแฝง: ข้อความที่ขึ้นต้นด้วย = + @ จะถูกชีตตีความเป็นสูตร → ใส่ ' นำหน้าให้เป็นข้อความธรรมดา (อ่านกลับมาได้ค่าเดิม) */
function gaSafe_(v) { return (typeof v === 'string' && /^[=+@]/.test(v)) ? "'" + v : v; }
/* ถังขยะ: เก็บสำเนาแถวก่อนลบถาวร (กู้คืนได้จากชีต "ถังขยะ") */
function gaTrash_(sh, rowNo) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), t = ss.getSheetByName('ถังขยะ');
    if (!t) { t = ss.insertSheet('ถังขยะ'); t.appendRow(['deletedAt', 'by', 'sheet', 'row']); t.getRange('A:D').setNumberFormat('@STRING@'); }
    var lc = Math.max(sh.getLastColumn(), 1), hdr = sh.getRange(1, 1, 1, lc).getValues()[0], vals = sh.getRange(rowNo, 1, 1, lc).getValues()[0], o = {};
    for (var c = 0; c < lc; c++) if (hdr[c] !== '' && vals[c] !== '' && vals[c] !== null) o[String(hdr[c])] = (vals[c] instanceof Date) ? Utilities.formatDate(vals[c], TZ, 'yyyy-MM-dd HH:mm') : vals[c];
    t.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), (AUTH_CTX && AUTH_CTX.id) || '', sh.getName(), gaSafe_(JSON.stringify(o))]);
  } catch (e) {}
}
function gaIds_(sh) {
  var n = sh.getLastRow();
  if (n < 1) return [];
  return sh.getRange(1, 1, n, 1).getValues().map(function(r){ return String(r[0]); });
}
function gaFastGetAll_(p) {
  var cache = CacheService.getScriptCache();
  var force = String(p.force || '') === '1';
  var client = {};
  String(p.h || '').split('|').forEach(function(x){ var i = x.indexOf(':'); if (i > 0) client[x.slice(0, i)] = x.slice(i + 1); });
  var want = [];
  GA_KEYS.forEach(function(k){ want.push('ga2g:' + k, 'ga2m:' + k); });
  var got = {};
  try { got = cache.getAll(want); } catch (e) {}
  var ss = null, parts = [], hashes = {}, same = [];
  for (var t = 0; t < GA_KEYS.length; t++) {
    var k = GA_KEYS[t];
    var gen = got['ga2g:' + k];
    if (!gen) { gen = String(Date.now()) + '-' + Math.random(); try { cache.put('ga2g:' + k, gen, 21600); } catch (e) {} }
    var meta = null;
    try { meta = got['ga2m:' + k] ? JSON.parse(got['ga2m:' + k]) : null; } catch (e) {}
    if (force || (meta && meta.g !== gen) || k === 'settings') meta = null;   // settings อ่านสดเสมอ (ชีตเล็ก · กัน cache เก่าที่ยังมี PIN)
    if (meta && client[k] && client[k] === meta.h) { hashes[k] = meta.h; same.push(k); continue; }
    var json = meta ? gaChunksGet_(cache, k, meta.n) : null;
    var h = meta ? meta.h : '';
    if (json === null) {
      if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
      json = JSON.stringify(gaReadTab_(ss, GA_TABS[t]));
      h = gaHash_(json);
      gaChunksPut_(cache, k, json, h, gen);
    }
    hashes[k] = h;
    if (client[k] && client[k] === h) { same.push(k); continue; }
    parts.push(JSON.stringify(k) + ':' + json);
  }
  var head = '"_v":2,"_h":' + JSON.stringify(hashes) + ',"_same":' + JSON.stringify(same) + (parts.length ? '' : ',"_unchanged":true');
  return ContentService.createTextOutput('{' + head + (parts.length ? ',' + parts.join(',') : '') + '}')
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  AUTH — ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ (ล็อกอินด้วย PIN → ได้บัตรผ่าน token อายุ 24 ชม.)
//  - PIN ใหม่เก็บแบบ hash ใน Script Properties (AUTH_PIN_<id>) ไม่ส่งกลับไปหน้าเว็บ
//  - PIN เดิม (ชีต settings / ค่าเริ่มต้นในโค้ด) ใช้ได้ครั้งเดียวเพื่อเข้าแล้ว "บังคับตั้ง PIN ใหม่" (PIN เดิมรั่วแล้ว)
//  - โหมด: AUTH_ENFORCE != '1' → ยังไม่บังคับ (ปล่อยผ่านแต่นับคำขอที่ไม่มีบัตรผ่าน) · '1' → ปฏิเสธ
//    เปิดบังคับ: รัน authEnforceOn() ใน editor · ดูรายงาน: authReport() · ปิด: authEnforceOff()
// ============================================================
var AUTH_TTL_MS = 24 * 3600 * 1000;
var AUTH_PUBLIC_GET = ['crmPortal', 'crmBind', 'crmConsent', 'crmBirthday', 'crmPortalAct', 'crmRateOpen', 'authLogin'];   // หน้า LINE ของคนไข้ (ยืนยันตัวตนด้วย LINE เอง) + ล็อกอิน
var AUTH_LEGACY_DEFAULT = { toy: '1111', mind: '6465', koi: '9677', pong: '3467', aim: '7699', khao: '8986', ben: '2233', manager: '1234' }; // รั่วแล้ว → ใช้เข้าได้แต่ต้องเปลี่ยนทันที
var AUTH_CTX = null;

function authSecret_() {
  var pr = PropertiesService.getScriptProperties(), s = pr.getProperty('AUTH_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); pr.setProperty('AUTH_SECRET', s); }
  return s;
}
function authB64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function authHashPin_(id, pin) { return authB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, authSecret_() + '|' + id + '|' + pin)); }
function authSign_(payload) { return authB64_(Utilities.computeHmacSha256Signature(payload, authSecret_())).slice(0, 43); }
function authRole_(id) { return (id === 'manager' || id === 'toy') ? 'manager' : 'doctor'; }
function authKnownIds_() {
  var ids = {}; Object.keys(AUTH_LEGACY_DEFAULT).forEach(function (k) { ids[k] = true; });
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings');
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) ids[String(r[0])] = true; });
  } catch (e) {}
  return ids;
}
function authLegacyPin_(id) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings');
    if (sh && sh.getLastRow() > 1) {
      var lc = Math.max(sh.getLastColumn(), 6), hdr = sh.getRange(1, 1, 1, lc).getValues()[0], pc = hdr.indexOf('pin'); if (pc < 0) pc = 5;
      var rows = sh.getRange(2, 1, sh.getLastRow() - 1, lc).getValues();
      for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === String(id) && String(rows[i][pc] || '').length >= 4) return String(rows[i][pc]);
    }
  } catch (e) {}
  return AUTH_LEGACY_DEFAULT[id] || '';
}
function authIssue_(id) {
  var exp = Date.now() + AUTH_TTL_MS, payload = id + '.' + exp;
  return { token: payload + '.' + authSign_(payload), exp: exp, id: id, role: authRole_(id) };
}
function authVerify_(tok) {
  var m = String(tok || '').match(/^([A-Za-z0-9_-]+)\.(\d+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  if (+m[2] < Date.now()) return null;
  if (authSign_(m[1] + '.' + m[2]) !== m[3]) return null;
  return { id: m[1], role: authRole_(m[1]), exp: +m[2] };
}
function authFail_(id) {
  var c = CacheService.getScriptCache(), k = 'authf_' + id, n = (+c.get(k) || 0) + 1;
  c.put(k, String(n), 900); return n;
}
function authLocked_(id) { return (+CacheService.getScriptCache().get('authf_' + id) || 0) >= 5; }
// ตรวจ PIN: คืน 'ok' | 'legacy' (ถูกแต่เป็น PIN เดิม ต้องเปลี่ยน) | 'bad' | 'locked'
function authCheck_(id, pin) {
  id = String(id || ''); pin = String(pin || '');
  if (!id || !authKnownIds_()[id]) return 'bad';
  if (authLocked_(id)) return 'locked';
  var stored = PropertiesService.getScriptProperties().getProperty('AUTH_PIN_' + id);
  var res = 'bad';
  if (stored) res = (stored === authHashPin_(id, pin)) ? 'ok' : 'bad';
  else if (PropertiesService.getScriptProperties().getProperty('AUTH_LEGACY_OFF') === '1') res = 'bad';   // ปิด PIN เดิมแล้ว: บัญชีที่ยังไม่ตั้ง PIN ใหม่เข้าไม่ได้ (ผู้จัดการตั้งให้ได้)
  else { var lg = authLegacyPin_(id); res = (lg && pin === lg) ? 'legacy' : 'bad'; }
  if (res === 'bad') { if (authFail_(id) >= 5) return 'locked'; }
  else CacheService.getScriptCache().remove('authf_' + id);
  return res;
}
function authSetPin_(id, pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) return { ok: false, error: 'PIN ต้องเป็นตัวเลข 4 หลัก' };
  if (String(pin) === String(AUTH_LEGACY_DEFAULT[id] || '') || String(pin) === authLegacyPin_(id)) return { ok: false, error: 'ห้ามใช้ PIN เดิม กรุณาตั้ง PIN ใหม่' };
  if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '0000') return { ok: false, error: 'PIN ง่ายเกินไป กรุณาตั้งใหม่' };
  PropertiesService.getScriptProperties().setProperty('AUTH_PIN_' + id, authHashPin_(id, pin));
  return { ok: true };
}
function authJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
// คำสั่งเกี่ยวกับล็อกอิน · คืน null ถ้าไม่ใช่
function authHandle_(a, p) {
  if (a === 'authLogin') {
    var r = authCheck_(p.id, p.pin);
    if (r === 'locked') return authJson_({ ok: false, error: 'locked' });
    if (r === 'bad') return authJson_({ ok: false, error: 'bad_pin' });
    var t = authIssue_(String(p.id)); t.ok = true; t.mustChange = (r === 'legacy');
    return authJson_(t);
  }
  var me = authVerify_(p._t);
  if (a === 'authChangePin') {
    if (!me) return authJson_({ ok: false, error: 'auth_required' });
    return authJson_(authSetPin_(me.id, p.newPin));
  }
  if (a === 'authSetPin') {   // ผู้จัดการ/แอดมินตั้ง PIN ให้คนอื่น
    if (!me || me.role !== 'manager') return authJson_({ ok: false, error: 'forbidden' });
    if (!authKnownIds_()[String(p.id || '')]) return authJson_({ ok: false, error: 'not_found' });
    return authJson_(authSetPin_(String(p.id), p.pin));
  }
  if (a === 'authCheckPin') { // อนุมัติ template/โน้ต: ทันตแพทย์ยืนยันด้วย PIN ของตัวเอง
    if (!me) return authJson_({ ok: false, error: 'auth_required' });
    var r2 = authCheck_(p.id, p.pin);
    return authJson_({ ok: r2 === 'ok' || r2 === 'legacy', error: r2 === 'locked' ? 'locked' : (r2 === 'bad' ? 'bad_pin' : '') });
  }
  return null;
}
// ประตู: คืน null = ผ่าน · คืน response = ปฏิเสธ
function authGate_(action, tok, isPublic) {
  AUTH_CTX = authVerify_(tok);
  if (isPublic || AUTH_CTX) return null;
  try {   // นับคำขอที่ไม่มีบัตรผ่าน (ดูด้วย authReport)
    var c = CacheService.getScriptCache(), k = 'authmiss', o = {}; try { o = JSON.parse(c.get(k) || '{}'); } catch (e) {}
    var key = (action || '(none)') + (tok ? ' [token ไม่ถูกต้อง/หมดอายุ]' : '');
    o[key] = (o[key] || 0) + 1; o._last = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); c.put(k, JSON.stringify(o), 21600);
  } catch (e) {}
  if (PropertiesService.getScriptProperties().getProperty('AUTH_ENFORCE') === '1') return authJson_({ ok: false, error: 'auth_required' });
  return null;
}
/* ===== จัดการบัญชีที่ไม่ใช้แล้ว (บัญชีที่ยังไม่ตั้ง PIN ใหม่) ===== */
function authNoPinIds_() {
  var pr = PropertiesService.getScriptProperties(), have = {};
  pr.getKeys().forEach(function (k) { if (k.indexOf('AUTH_PIN_') === 0) have[k.slice(9)] = true; });
  return Object.keys(authKnownIds_()).filter(function (k) { return !have[k]; });
}
function authRefCount_(name) {
  var n = 0; name = String(name || '').trim(); if (!name) return 0;
  ['ตารางนัด', 'บันทึกการรักษา'].forEach(function (t) {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(t); if (!sh || sh.getLastRow() < 2) return;
    var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], c = hdr.indexOf('docName'); if (c < 0) return;
    sh.getRange(2, c + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (String(r[0]).trim() === name) n++; });
  });
  return n;
}
/* ดูก่อนลบ: แสดงบัญชีที่ไม่มี PIN ใหม่ + แถวในชีต settings + จำนวนนัด/รักษาที่อ้างชื่อนั้น */
function authAccountsPreview() {
  var ids = authNoPinIds_(), sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings'), rows = (sh && sh.getLastRow() > 1) ? sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 6)).getValues() : [];
  if (!ids.length) { Logger.log('ไม่มีบัญชีที่ค้าง PIN เดิม'); return; }
  ids.forEach(function (id) {
    var hit = rows.filter(function (r) { return String(r[0]) === id; });
    Logger.log('บัญชี [' + id + '] (รหัสตัวอักษร: ' + id.split('').map(function (ch) { return ch.charCodeAt(0).toString(16); }).join(' ') + ') · แถวในชีต settings: ' + hit.length + (hit.length ? ' · ชื่อ: ' + hit[0][1] + ' · ถูกอ้างในนัด/รักษา: ' + authRefCount_(hit[0][1]) + ' รายการ' : ' · (มีแค่ในโค้ดเดิม ไม่มีแถว)'));
  });
}
/* ลบแถวบัญชีที่ไม่มี PIN ใหม่ออกจากชีต settings (เก็บสำเนาในชีต "ถังขยะ") — ข้ามถ้ามีนัด/รักษาอ้างชื่อนั้นอยู่ */
function authRemoveUnusedAccounts() {
  var ids = authNoPinIds_(), sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings'), done = 0;
  if (!sh || sh.getLastRow() < 2) { Logger.log('ไม่มีชีต settings'); return; }
  for (var r = sh.getLastRow(); r >= 2; r--) {
    var id = String(sh.getRange(r, 1).getValue()), nm = String(sh.getRange(r, 2).getValue());
    if (ids.indexOf(id) < 0) continue;
    var ref = authRefCount_(nm);
    /* แถวซ้ำ: ชื่อเดียวกับบัญชีอื่นที่มี PIN ใหม่แล้ว (เช่น id พิมพ์ผิดมีอักขระแปลกนำหน้า) → ประวัติยังอ้างผ่านบัญชีจริง ลบแถวซ้ำได้ */
    var dup = false, pins = PropertiesService.getScriptProperties();
    for (var q = 2; q <= sh.getLastRow(); q++) {
      if (q === r) continue;
      var oid = String(sh.getRange(q, 1).getValue());
      if (String(sh.getRange(q, 2).getValue()) === nm && pins.getProperty('AUTH_PIN_' + oid)) { dup = true; break; }
    }
    if (ref > 0 && !dup) { Logger.log('ข้าม [' + id + '] ' + nm + ': ยังถูกอ้างในนัด/รักษา ' + ref + ' รายการ (ไม่ลบ ปล่อยให้ authLegacyOff ล็อกเข้าไม่ได้แทน)'); continue; }
    gaTrash_(sh, r); sh.deleteRow(r); done++; Logger.log('ลบแล้ว [' + id + '] ' + nm);
  }
  Logger.log('เสร็จ: ลบ ' + done + ' แถว');
}
/* ปิด/เปิดการใช้ PIN เดิม (PIN เดิมเคยรั่วในโค้ด) — รันหลังทุกคนตั้ง PIN ใหม่แล้ว (ดูรายชื่อด้วย authReport) */
function authLegacyOff() {
  var pr = PropertiesService.getScriptProperties();
  if (!pr.getProperty('AUTH_PIN_toy') && !pr.getProperty('AUTH_PIN_manager')) { Logger.log('ยังปิดไม่ได้: บัญชีผู้จัดการ (toy/manager) ต้องตั้ง PIN ใหม่อย่างน้อย 1 บัญชีก่อน ไม่งั้นจะไม่มีใครเข้าไปตั้ง PIN ให้คนอื่นได้'); return; }
  pr.setProperty('AUTH_LEGACY_OFF', '1'); Logger.log('ปิด PIN เดิมแล้ว — บัญชีที่ยังไม่ตั้ง PIN ใหม่จะเข้าไม่ได้จนกว่าผู้จัดการตั้งให้');
}
function authLegacyOn() { PropertiesService.getScriptProperties().deleteProperty('AUTH_LEGACY_OFF'); Logger.log('เปิดให้ใช้ PIN เดิมได้อีกครั้ง'); }
function authEnforceOn() { PropertiesService.getScriptProperties().setProperty('AUTH_ENFORCE', '1'); Logger.log('เปิดบังคับบัตรผ่านแล้ว'); }
function authEnforceOff() { PropertiesService.getScriptProperties().deleteProperty('AUTH_ENFORCE'); Logger.log('ปิดบังคับบัตรผ่านแล้ว'); }
function authReport() {
  var pr = PropertiesService.getScriptProperties(), keys = pr.getKeys().filter(function (k) { return k.indexOf('AUTH_PIN_') === 0; }).map(function (k) { return k.slice(9); });
  Logger.log('โหมดบังคับ: ' + (pr.getProperty('AUTH_ENFORCE') === '1' ? 'เปิด' : 'ยังไม่เปิด'));
  Logger.log('PIN เดิม: ' + (pr.getProperty('AUTH_LEGACY_OFF') === '1' ? 'ปิดแล้ว' : 'ยังใช้เข้าได้ (ควรปิดด้วย authLegacyOff หลังทุกคนตั้ง PIN ใหม่)'));
  Logger.log('ตั้ง PIN ใหม่แล้ว: ' + (keys.join(', ') || '-'));
  Logger.log('ยังใช้ PIN เดิม: ' + Object.keys(authKnownIds_()).filter(function (k) { return keys.indexOf(k) === -1; }).join(', '));
  Logger.log('คำขอที่ไม่มีบัตรผ่าน (6 ชม.ล่าสุด): ' + (CacheService.getScriptCache().get('authmiss') || 'ไม่มี'));
}

function doPost(e) {
  try {
    // ---- AUTH: ล็อกอิน / ประตูตรวจบัตรผ่าน ----
    var _pb = null; try { _pb = JSON.parse((e.postData && e.postData.contents) || 'null'); } catch (eb) {}
    var _pq = (e && e.parameter) || {};
    if (_pb && _pb.action && String(_pb.action).indexOf('auth') === 0) {
      var _ah = authHandle_(_pb.action, Object.assign({ _t: _pq._t }, _pb)); if (_ah) return _ah;
    }
    var _isHook = !!(_pb && Object.prototype.toString.call(_pb.events) === '[object Array]');   // LINE webhook
    var _deny = authGate_(_pb ? (_pb.crm ? 'crm:' + _pb.crm : (_pb.type || _pb.action || 'post')) : 'post', _pq._t || (_pb && _pb._t), _isHook);
    if (_deny) return _deny;

    // ---- LINE CRM: webhook + งานหลังบ้าน CRM (อยู่ในไฟล์ line-crm.gs) — ต้องอยู่ก่อน ortho ----
    var _crm = (typeof crmRoutePost_ === 'function') ? crmRoutePost_(e) : null; // ไม่มีไฟล์ line-crm.gs ก็ยังทำงานได้
    if (_crm) return _crm;

    // ---- ORTHO (อยู่ในไฟล์ ortho-backend.gs) ----
    var _ortho = orthoRoutePost_(e);
    if (_ortho) return _ortho;

    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // DELETE appointments/treatments/labs
    if (data.type === 'delete') {
      var map = { treatments: 'บันทึกการรักษา', labs: 'แลป', appointments: 'ตารางนัด' };
      var sh = ss.getSheetByName(map[data.data.type]);
      if (sh) {
        var delLock = LockService.getScriptLock(); delLock.waitLock(30000);   // ล็อกช่วงค้นหา+ลบ กันลบผิดแถวเมื่อมีคำขอพร้อมกัน
        try {
        var ids = gaIds_(sh);
        var i = ids.indexOf(String(data.data.id));
        if (i > 0) {
          gaTrash_(sh, i + 1);
          if (data.data.type === 'appointments') { try { crmOnAptRemoved_(String(data.data.id)); } catch (eC) {} }   // สร้างงาน "แจ้งยกเลิกนัด" ก่อนแถวหาย
          sh.deleteRow(i + 1);
        }
        } finally { delLock.releaseLock(); }
      }
      return gaOk_(data.data.type);
    }

    // DELETE PATIENT
    if (data.type === 'delete_patient') {
      if (AUTH_CTX && AUTH_CTX.role !== 'manager') return authJson_({ ok: false, error: 'forbidden' });   // ลบคนไข้ได้เฉพาะผู้จัดการ
      var sh = ss.getSheetByName('คนไข้');
      if (sh) {
        var dpLock = LockService.getScriptLock(); dpLock.waitLock(30000);
        try {
          var hns = gaIds_(sh);
          var i = hns.indexOf(String(data.data.hn));
          if (i > 0) { gaTrash_(sh, i + 1); sh.deleteRow(i + 1); }
        } finally { dpLock.releaseLock(); }
      }
      return gaOk_('patients');
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
        var ids = gaIds_(sh);
        var i = ids.indexOf(String(r.id));
        if (PropertiesService.getScriptProperties().getProperty('AUTH_ENFORCE') === '1' && !(AUTH_CTX && AUTH_CTX.role === 'manager')) return authJson_({ ok: false, error: 'forbidden' });
        // PIN ไม่ส่งจากหน้าเว็บแล้ว (ตั้งผ่าน authSetPin) → คงค่าเดิมในคอลัมน์ pin ไว้ (ใช้เป็น PIN เดิมครั้งแรกก่อนบังคับเปลี่ยน)
        var oldPin = i >= 1 ? String(sh.getRange(i+1, 6).getValue() || '') : '';
        var row = [r.id, r.name, r.gender||'', r.specialty||'', r.share||50, oldPin, r.fullName||'', r.licenseNo||''].map(gaSafe_);
        if (i < 1) sh.appendRow(row);
        else sh.getRange(i+1,1,1,row.length).setValues([row]);
      }
      return gaOk_('settings');
    }

    // PATIENTS
    if (data.type === 'patients') {
      var sh = ss.getSheetByName('คนไข้');
      if (sh) {
        var r = data.data;
        var ptLock = LockService.getScriptLock(); ptLock.waitLock(30000);   // กันเพิ่มคนไข้ซ้ำเมื่อคำขอมาพร้อมกัน
        try {
        var hns = gaIds_(sh);
        var i = hns.indexOf(String(r.hn));
        var addedAt = r.addedAt ? String(r.addedAt) : '';
        var row = [String(r.hn||''), String(r.name||''), String(r.phone||''), String(r.lineId||''), r.sso?'TRUE':'FALSE', addedAt, String(r.orthoCode||'')].map(function (v, ix) { return ix === 2 ? v : gaSafe_(v); });   // เบอร์โทรคงรูปแบบเดิม
        if (String(sh.getRange(1,7).getValue()||'') === '') sh.getRange(1,7).setValue('รหัสจัดฟัน');
        if (i < 1) {
          sh.appendRow(row);
          if (addedAt) sh.getRange(sh.getLastRow(),6).setNumberFormat('@STRING@').setValue(addedAt);
        } else {
          sh.getRange(i+1,1,1,row.length).setValues([row]);
          if (addedAt) sh.getRange(i+1,6).setNumberFormat('@STRING@').setValue(addedAt);
        }
        } finally { ptLock.releaseLock(); }
      }
      return gaOk_('patients');
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
          var ids = gaIds_(sh);
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
      return gaOk_('day_notes');
    }

    // SCH_SLOTS
    if (data.type === 'sch_slots') {
      var sh = ss.getSheetByName('sch_slots');
      if (sh) {
        var r = data.data;
        var ids = gaIds_(sh);
        var i = ids.indexOf(String(r.id));
        var row = [String(r.id), String(r.date||''), String(r.slots||'')];
        if (i < 1) sh.appendRow(row);
        else sh.getRange(i+1,1,1,row.length).setValues([row]);
      }
      return gaOk_('sch_slots');
    }

    // RECALL
    if (data.type === 'recall') {
      var sh = ss.getSheetByName('recall');
      if (sh) {
        var r = data.data;
        var hns = gaIds_(sh);
        var i = hns.indexOf(String(r.hn));
        var row = [String(r.hn), String(r.status), String(r.updatedAt||'')];
        if (i < 1) sh.appendRow(row);
        else sh.getRange(i+1,1,1,row.length).setValues([row]);
      }
      return gaOk_('recall');
    }

    // APPOINTMENTS / TREATMENTS / LABS
    var sh;
    if (data.type === 'appointments') sh = ss.getSheetByName('ตารางนัด');
    else if (data.type === 'treatments') sh = ss.getSheetByName('บันทึกการรักษา');
    else if (data.type === 'labs') sh = ss.getSheetByName('แลป');

    if (!sh) return ContentService.createTextOutput('error: unknown type ' + data.type);

    // คำขอจากหน้าเว็บใช้ no-cors จึงอาจถูกส่งซ้ำ/มาพร้อมกันได้
    // ล็อกทั้งช่วงค้นหา ID และ append/update เพื่อไม่ให้สองคำขอเห็นว่า
    // "ยังไม่มี" พร้อมกันแล้ว append แถวซ้ำ
    var recordLock = LockService.getScriptLock();
    recordLock.waitLock(30000);
    try {
      var r = data.data;
      var ids = gaIds_(sh);
      var i = ids.indexOf(String(r.id));
      var duplicateRows = [];
      ids.forEach(function(id, idx){ if(idx > i && id === String(r.id)) duplicateRows.push(idx + 1); });
      var rKeys = Object.keys(r);

      var hdr = sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0];
    // จับคู่แต่ละ key กับคอลัมน์ตาม "ชื่อ header จริง" ไม่ใช่ตามลำดับใน object เหมือนเดิม
    // (ลำดับ key ใน object ไม่รับประกันว่าตรงกับลำดับคอลัมน์ในชีตเสมอไป — โดยเฉพาะถ้ามีคอลัมน์ blank ค้างอยู่)
    // key ไหนยังไม่มี header ให้เข้าไปแทรกในช่อง blank ที่มีอยู่ก่อน ถ้าไม่มีช่อง blank ค่อยเพิ่มคอลัมน์ใหม่ต่อท้าย
      rKeys.forEach(function(k){
        if (hdr.indexOf(k) === -1) {
          // สร้างคอลัมน์ใหม่เฉพาะชื่อฟิลด์ที่ถูกรูปแบบ และไม่เกิน 120 คอลัมน์ (กันคำขอแปลก ๆ สร้างคอลัมน์ขยะ)
          if (!/^[A-Za-z\u0E00-\u0E7F][A-Za-z0-9_\u0E00-\u0E7F]{0,39}$/.test(String(k)) || hdr.length >= 120) return;
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
        return (v===null||v===undefined)?'':gaSafe_(v);
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

      // เก็บแถวแรกไว้เป็นแถวล่าสุด แล้วลบแถวซ้ำจากล่างขึ้นบนเพื่อไม่ให้ index เลื่อน
      for (var d = duplicateRows.length - 1; d >= 0; d--) sh.deleteRow(duplicateRows[d]);
      return gaOk_(data.type);
    } finally {
      recordLock.releaseLock();
    }

  } catch(err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

function doGet(e) {
  try {
    // ---- AUTH ----
    var _gp = (e && e.parameter) || {};
    if (_gp.action && String(_gp.action).indexOf('auth') === 0) { var _ah = authHandle_(_gp.action, _gp); if (_ah) return _ah; }
    var _deny = authGate_(_gp.action || '(none)', _gp._t, AUTH_PUBLIC_GET.indexOf(_gp.action) !== -1);
    if (_deny) return _deny;

    // ---- LINE CRM (อยู่ในไฟล์ line-crm.gs) ----
    var _crm = (typeof crmRouteGet_ === 'function') ? crmRouteGet_(e) : null;
    if (_crm) return _crm;

    // ---- ORTHO (อยู่ในไฟล์ ortho-backend.gs) ----
    var _ortho = orthoRouteGet_(e);
    if (_ortho) return _ortho;

    var p = (e && e.parameter) || {};
    if (p.action === 'getAll') return gaFastGetAll_(p);
    { var _rc = receiptRoute_(p); if (_rc) return _rc; }   // ใบเสร็จรับเงิน

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
        return ContentService.createTextOutput(JSON.stringify({ ok: false, disabled: true, error: 'ปิดฟีเจอร์แผนเตรียมตัววันนี้แล้ว' })).setMimeType(ContentService.MimeType.JSON);   // ปิดถาวร — ไม่ส่งข้อมูลคนไข้ไป AI
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


/* ============================================================================
   ย้ายชื่อรายการรักษาเป็นภาษาไทย (ครั้งเดียว) — ตารางเดียวกับที่หน้าเว็บใช้ (PROC_RENAME ใน index.html)
   วิธีใช้ใน Apps Script (เลือกฟังก์ชันแล้วกด ▶ Run):
     1) migrateProcNamesPreview()  → ดูผลใน Execution log ว่าจะแก้กี่แถว (ยังไม่แก้จริง)
     2) migrateProcNamesRun()      → สำเนาสำรองทั้งไฟล์ Google Sheet ก่อน แล้วค่อยแก้จริง
   รันซ้ำได้ ไม่เสียหาย (ชื่อที่เป็นไทยแล้วจะไม่ถูกแตะ)
   ============================================================================ */
var MIG_PROC_RENAME_ = {
  'x-ray bw':'เอ็กซเรย์ตรวจฟันผุ', 'x-ray':'เอ็กซเรย์ฟัน', 'xray':'เอ็กซเรย์ฟัน', 'tp':'ฟันปลอมถอดได้ฐานพลาสติก', 'rpd':'ฟันปลอมถอดได้โครงโลหะ',
  'valplast':'ฟันปลอมฐานนิ่ม', 'splint':'เฝือกสบฟัน', 'recheck':'ตรวจติดตามอาการ', 'onlay':'ครอบฟันบางส่วน', 'mi':'นัดต่อเนื่องรักษารากฟัน',
  'frc':'อุดคลองรากฟัน', 'bite block':'บันทึกการสบฟัน', 'biteblock':'บันทึกการสบฟัน', 'ใส่ฟัน':'ใส่ฟันปลอม', 'ลองโครง':'ลองโครงฟันปลอม', 'ลองฟัน':'ลองฟันปลอม'
};
// [ชีต, คอลัมน์ข้อความคั่นด้วย ",", คอลัมน์ JSON ที่คีย์เป็นชื่อรายการ]
var MIG_TARGETS_ = [
  ['บันทึกการรักษา', ['proc'], ['procPrices','toothPrices','procTeeth']],
  ['ตารางนัด', ['proc'], []],
  ['ortho_log', ['ทำอะไร'], []],
  ['crm_followups', ['proc'], []],
  ['crm_templates', ['procKeywords'], []]
];
function migRenameToken_(t) {
  var k = String(t).trim().toLowerCase();
  return MIG_PROC_RENAME_.hasOwnProperty(k) ? MIG_PROC_RENAME_[k] : null;
}
function migRenameList_(v) {
  var s = String(v == null ? '' : v); if (!s) return s;
  return s.split(/(\s*,\s*)/).map(function (part, i) {
    if (i % 2 === 1) return part;
    var lead = part.match(/^\s*/)[0], trail = part.match(/\s*$/)[0], core = part.trim();
    var n = core ? migRenameToken_(core) : null;
    return n ? lead + n + trail : part;
  }).join('');
}
function migRenameJson_(v) {
  var s = String(v == null ? '' : v); if (!s || s.charAt(0) !== '{') return s;
  try {
    var o = JSON.parse(s), out = {}, changed = false;
    Object.keys(o).forEach(function (k) {
      var n = migRenameToken_(k), nk = n || k; if (n) changed = true;
      if (out.hasOwnProperty(nk) && n) return;   // มีชื่อใหม่อยู่แล้ว ไม่ทับ
      out[nk] = o[k];
    });
    return changed ? JSON.stringify(out) : s;
  } catch (e) { return s; }
}
function migrateProcNames_(apply) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), report = [];
  MIG_TARGETS_.forEach(function (T) {
    var sh = ss.getSheetByName(T[0]); if (!sh) { report.push(T[0] + ': (ไม่มีชีตนี้ ข้าม)'); return; }
    var lr = sh.getLastRow(), lc = sh.getLastColumn(); if (lr < 2 || lc < 1) { report.push(T[0] + ': ไม่มีข้อมูล'); return; }
    var hdr = sh.getRange(1, 1, 1, lc).getValues()[0], rng = sh.getRange(2, 1, lr - 1, lc), vals = rng.getValues(), rows = 0, cells = 0;
    var cols = [];
    T[1].forEach(function (c) { var i = hdr.indexOf(c); if (i >= 0) cols.push([i, migRenameList_]); });
    T[2].forEach(function (c) { var i = hdr.indexOf(c); if (i >= 0) cols.push([i, migRenameJson_]); });
    vals.forEach(function (r) {
      var hit = false;
      cols.forEach(function (c) { var o = r[c[0]]; if (typeof o !== 'string') return; var n = c[1](o); if (n !== o) { r[c[0]] = n; cells++; hit = true; } });
      if (hit) rows++;
    });
    if (apply && cells) rng.setValues(vals);
    report.push(T[0] + ': ' + rows + ' แถว (' + cells + ' ช่อง)' + (apply ? ' — แก้แล้ว' : ' — จะแก้'));
  });
  return report;
}
function migrateProcNamesPreview() {
  var r = migrateProcNames_(false);
  Logger.log('ตัวอย่าง (ยังไม่แก้จริง)\n' + r.join('\n') + '\n\nถ้าตัวเลขดูถูกต้อง ให้รัน migrateProcNamesRun()');
}
function migrateProcNamesRun() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var copy = DriveApp.getFileById(ss.getId()).makeCopy('สำรองก่อนย้ายชื่อรายการรักษา ' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm'));
  var r = migrateProcNames_(true);
  Logger.log('สำรองไว้ที่: ' + copy.getUrl() + '\n' + r.join('\n') + '\n\nเสร็จแล้ว — บอกคุณ Claude ได้เลยว่าย้ายเสร็จ เพื่อเปิดหน้าเว็บเวอร์ชันใหม่');
}

/* ลบบัญชี part (หมอพาร์ท) ออกจากชีต settings — รันครั้งเดียว เก็บสำเนาในชีต "ถังขยะ"; ไม่แตะนัด/บันทึกการรักษาเดิม */
function authRemovePart() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings'), done = 0;
  if (!sh || sh.getLastRow() < 2) { Logger.log('ไม่มีชีต settings'); return; }
  for (var r = sh.getLastRow(); r >= 2; r--) {
    if (String(sh.getRange(r, 1).getValue()).trim() !== 'part') continue;
    gaTrash_(sh, r); sh.deleteRow(r); done++; Logger.log('ลบแล้ว: แถว part (' + sh.getRange(1, 1).getValue() + ') สำเนาอยู่ในชีต ถังขยะ');
  }
  PropertiesService.getScriptProperties().deleteProperty('AUTH_PIN_part');
  Logger.log('เสร็จ: ลบ ' + done + ' แถว');
}
