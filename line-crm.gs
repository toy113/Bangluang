/**********************************************************************
 * BANGLUANG DENTAL — LINE CRM  (Google Apps Script)
 * ไฟล์ใหม่ วางในโปรเจกต์ Apps Script เดียวกับ Code.gs / ortho-backend.gs
 *
 * ทำอะไรบ้าง
 *  - ผูกบัญชี LINE กับคนไข้ทุกคน (หน้า LIFF) + ยืนยันตัวตนด้วย LINE token ฝั่งเซิร์ฟเวอร์
 *  - ส่งยืนยันนัด / เตือนก่อนนัด (จัดฟัน 2 วัน, งานอื่น 1 วัน) พร้อมปุ่ม ยืนยัน / ขอเลื่อน / ติดต่อคลินิก
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
var CRM_DEFAULT_LIFF_ID = '2010461984-kt5dSgin';
var CRM_DEFAULT_RICHMENU_IMG = 'https://toy113.github.io/Bangluang/richmenu-crm.png';

var CRM_SHEETS = {
  links:     ['id','lineUserId','hn','patName','status','source','consent','displayName','inputName','inputPhone','createdAt','approvedBy','approvedAt','note'],
  followers: ['lineUserId','displayName','pictureUrl','status','followedAt','updatedAt','lastSeenAt'],
  log:       ['key','type','hn','patName','lineUserId','refId','status','detail','createdAt','pushCount'],
  tasks:     ['id','type','priority','status','hn','patName','lineUserId','aptId','aptDate','aptTime','detail','preference','createdAt','updatedAt','doneBy','resultNote'],
  followups: ['id','hn','patName','lineUserId','treatDate','templateId','proc','sentAt','answer','answerKind','answeredAt','taskId','status'],
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
  sendStart: '08:00', sendEnd: '20:00',
  confirmOn: true,
  remindOn: true, remindHour: '10:00', orthoDays: 2, otherDays: 1,
  orthoKeywords: 'จัดฟัน,ปรับเครื่องมือ,รีเทนเนอร์,ถอดเครื่องมือจัดฟัน',
  aftercareOn: true, aftercareDelayMin: 0,
  followupOn: true, followupHour: '10:00',
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
  var out = {};
  for (var k in CRM_DEFAULT_SETTINGS) out[k] = (s[k] === undefined) ? CRM_DEFAULT_SETTINGS[k] : s[k];
  for (var k2 in s) if (out[k2] === undefined) out[k2] = s[k2];
  return out;
}
function crmSaveSettingsRaw_(s) {
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
function crmSheet_(key) {
  var name = CRM_SHEET_NAMES[key], headers = CRM_SHEETS[key];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), headers.length).setNumberFormat('@');
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var missing = headers.filter(function (h) { return hdr.indexOf(h) === -1; });
  if (missing.length) sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  return sh;
}
function crmCell_(v, col) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    var c = String(col || '').toLowerCase();
    if (c === 'date' || c === 'treatdate' || c === 'aptdate' || c === 'วันที่' || c === 'วันเริ่ม' || c === 'นัดถัดไป' || c === 'ปรับล่าสุด' || c === 'วันใส่รีเทนเนอร์') return Utilities.formatDate(v, CRM_TZ, 'yyyy-MM-dd');
    if (c === 'time' || c === 'apttime' || c === 'นัดถัดไปเวลา') return Utilities.formatDate(v, CRM_TZ, 'HH:mm');
    return Utilities.formatDate(v, CRM_TZ, 'yyyy-MM-dd HH:mm');
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
/* อ่านชีตใด ๆ เป็น array ของ object (+ _row = เลขแถวจริง) */
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
  var sh = crmSheet_(key);
  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = hdr.map(function (h) { var v = obj[h]; return (v === undefined || v === null) ? '' : String(v); });
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return r;
}
function crmAppendMany_(key, objs) {
  if (!objs.length) return;
  var sh = crmSheet_(key);
  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rows = objs.map(function (obj) { return hdr.map(function (h) { var v = obj[h]; return (v === undefined || v === null) ? '' : String(v); }); });
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, rows.length, hdr.length).setNumberFormat('@').setValues(rows);
}
function crmUpdate_(key, rowNum, patch) {
  var sh = crmSheet_(key);
  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
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
    if (a === 'crmPortal')    return crmJson_(crmPortal_(p));
    if (a === 'crmBind')      return crmJson_(crmBind_(p));
    if (a === 'crmConsent')   return crmJson_(crmConsent_(p));
    if (a === 'crmDashboard') return crmJson_(crmDashboard_());
    if (a === 'crmCall')      return crmJson_(crmStaffAction_(JSON.parse(p.data || '{}')));
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
    crmHandleWebhook_(body.events);
    return ContentService.createTextOutput('OK');
  }
  if (body.crm) {
    try { return crmJson_(crmStaffAction_(body)); }
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
function crmLinkMap_() {
  var map = {};
  function add(hn, uid, consent, name) {
    var k = crmHN_(hn);
    if (!k || !uid) return;
    map[k] = map[k] || [];
    for (var i = 0; i < map[k].length; i++) if (map[k][i].lineUserId === uid) return;
    map[k].push({ lineUserId: uid, consent: consent, patName: name || '' });
  }
  crmRead_('links').forEach(function (l) {
    if (l.status === 'active') add(l.hn, l.lineUserId, String(l.consent).toUpperCase() !== 'FALSE', l.patName);
  });
  crmReadByName_('ortho').forEach(function (o) { if (o.lineUserId) add(o.hn, o.lineUserId, true, o['ชื่อ']); });
  return map;
}
function crmUserHns_(uid) {
  var hns = [];
  crmRead_('links').forEach(function (l) { if (l.lineUserId === uid && l.status === 'active' && hns.indexOf(crmHN_(l.hn)) === -1) hns.push(crmHN_(l.hn)); });
  crmReadByName_('ortho').forEach(function (o) { if (o.lineUserId === uid && hns.indexOf(crmHN_(o.hn)) === -1) hns.push(crmHN_(o.hn)); });
  return hns;
}

/* ============================ TEMPLATES ============================ */
function crmOpt_(label, kind, reply) { return { label: label, kind: kind, reply: reply || '' }; }
var CRM_REPLY_OK = 'ดีใจด้วยค่ะ 😊 ดูแลตามคำแนะนำต่อไปนะคะ';
var CRM_REPLY_MILD = 'อาการปวดเล็กน้อยพบได้ในช่วง 1–3 วันแรก รับประทานยาตามที่ทันตแพทย์สั่ง และดูแลตามคำแนะนำค่ะ\nถ้าปวดมากขึ้นหรือไม่ดีขึ้น กดปุ่ม "ให้คลินิกโทรกลับ" ได้เลยค่ะ';
var CRM_REPLY_SEVERE = 'ขอบคุณที่แจ้งค่ะ 🙏 ส่งเรื่องให้ทีมคลินิกติดต่อกลับโดยเร็วแล้ว';
var CRM_REPLY_CALLBACK = 'รับเรื่องแล้วค่ะ 🙏 ทีมคลินิกจะโทรกลับในเวลาทำการ';

function crmSeedTemplates_() {
  var surgOpts = [crmOpt_('ปกติดี', 'ok', CRM_REPLY_OK), crmOpt_('ปวดเล็กน้อย', 'mild', CRM_REPLY_MILD), crmOpt_('ปวดมาก', 'severe', CRM_REPLY_SEVERE),
    crmOpt_('บวมมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('เลือดออกไม่หยุด', 'emergency', ''), crmOpt_('หายใจ/กลืนลำบาก', 'emergency', ''),
    crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var basicOpts = [crmOpt_('ปกติดี', 'ok', CRM_REPLY_OK), crmOpt_('เสียวฟัน/เจ็บเล็กน้อย', 'mild', 'อาการเสียวหรือเจ็บเล็กน้อยพบได้ในช่วงไม่กี่วันแรก และมักดีขึ้นเองค่ะ\nถ้าไม่ดีขึ้นหรือเป็นมากขึ้น กดปุ่ม "ให้คลินิกโทรกลับ" ได้เลยค่ะ'),
    crmOpt_('ปวดมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var endoOpts = [crmOpt_('ปกติดี', 'ok', CRM_REPLY_OK), crmOpt_('เจ็บเวลากัดเล็กน้อย', 'mild', 'อาการเจ็บเวลากัดเล็กน้อยพบได้ 2–3 วันหลังรักษารากฟันค่ะ เลี่ยงเคี้ยวด้านนั้นและรับประทานยาตามที่ทันตแพทย์สั่ง\nถ้าไม่ดีขึ้น กดปุ่ม "ให้คลินิกโทรกลับ" ได้เลยค่ะ'),
    crmOpt_('ปวดมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('บวม', 'severe', CRM_REPLY_SEVERE), crmOpt_('วัสดุอุดหลุด', 'callback', CRM_REPLY_CALLBACK),
    crmOpt_('หายใจ/กลืนลำบาก', 'emergency', ''), crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
  var dentureOpts = [crmOpt_('ใส่ได้ปกติ', 'ok', CRM_REPLY_OK), crmOpt_('เจ็บเหงือกเล็กน้อย', 'mild', 'ช่วงแรกอาจรู้สึกแน่นหรือเจ็บเหงือกเล็กน้อยได้ค่ะ\nถ้าเจ็บจนเป็นแผล อย่าแก้ฟันปลอมเอง กดปุ่ม "ให้คลินิกโทรกลับ" เพื่อนัดปรับได้เลยค่ะ'),
    crmOpt_('เป็นแผล/เจ็บมาก', 'severe', CRM_REPLY_SEVERE), crmOpt_('หลวม/หลุดบ่อย', 'callback', CRM_REPLY_CALLBACK), crmOpt_('ให้คลินิกโทรกลับ', 'callback', CRM_REPLY_CALLBACK)];
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
    { id: 'tpl_filling', name: 'อุดฟัน', procKeywords: 'อุดฟัน,อุดชั่วคราว,onlay,อุดปิดช่องว่าง', priority: 5, followupEnabled: 'FALSE', opts: basicOpts,
      text: 'คำแนะนำหลังอุดฟัน 🦷\n1. ถ้ายังชาอยู่ (ประมาณ 2–3 ชั่วโมง) ระวังกัดแก้มหรือลิ้น และงดของร้อน\n2. อาจเสียวฟันเล็กน้อยได้ในช่วงไม่กี่วันแรก\n3. ถ้าเป็นการอุดชั่วคราว เลี่ยงเคี้ยวของแข็ง/เหนียวด้านนั้น และมาตามนัด\n4. ถ้ารู้สึกว่าฟันที่อุดสูง กัดแล้วชนก่อนซี่อื่น หรือปวดมาก ให้ติดต่อคลินิกเพื่อปรับ' },
    { id: 'tpl_scaling', name: 'ขูดหินปูน', procKeywords: 'ขูดหินปูน,เกลารากฟัน', priority: 6, followupEnabled: 'FALSE', opts: basicOpts,
      text: 'คำแนะนำหลังขูดหินปูน 🦷\n1. อาจเสียวฟันหรือเหงือกมีเลือดออกเล็กน้อย 1–2 วัน ถือว่าปกติ\n2. แปรงฟันเบา ๆ ด้วยแปรงขนนุ่ม ใช้ยาสีฟันลดอาการเสียวได้\n3. เลี่ยงอาหารร้อนจัดหรือเย็นจัดในช่วงแรก\n4. ใช้ไหมขัดฟันทุกวัน\n5. ควรตรวจและขูดหินปูนทุก 6 เดือน' },
    { id: 'tpl_denture', name: 'ฟันปลอม', procKeywords: 'RPD,Valplast,ใส่ฟัน,ฟันปลอม', priority: 7, followupEnabled: 'FALSE', opts: dentureOpts,
      text: 'คำแนะนำการใช้ฟันปลอม 🦷\n1. ช่วงแรกอาจรู้สึกแน่นหรือเจ็บเหงือกเล็กน้อย ค่อย ๆ ฝึกเคี้ยวอาหารอ่อนก่อน\n2. ถอดล้างหลังอาหารทุกครั้ง แปรงทำความสะอาดฟันปลอม\n3. ถอดก่อนนอน แช่ในน้ำสะอาด ห้ามใช้น้ำร้อน\n4. ถ้าเจ็บจนเป็นแผลหรือหลวม ห้ามแก้ไขเอง ให้นัดมาปรับที่คลินิก' }
  ];
  var existing = crmRead_('templates');
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
    { type: 'text', text: k, color: '#83627C', size: 'sm', flex: 2 },
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
  if (buttons && buttons.length) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons };
  return bubble;
}
function crmTelUri_(s) { return 'tel:' + String(s.clinicPhone || '').replace(/[^0-9+]/g, ''); }
function crmAptMessage_(s, apt, kind) {
  var title = kind === 'remind' ? '🔔 เตือนนัดหมาย' : (kind === 'change' ? '📅 นัดหมายมีการเปลี่ยนแปลง' : '📅 ยืนยันการนัดหมาย');
  var sub = 'คุณ' + (apt.patName || '') + (kind === 'remind' ? ' อย่าลืมนัดหมายของคุณนะคะ' : ' คลินิกได้บันทึกนัดหมายของคุณแล้วค่ะ');
  var rows = [crmRow_('วัน', crmThaiDate_(apt.date)), crmRow_('เวลา', (apt.time || '-') + ' น.')];
  if (apt.docName) rows.push(crmRow_('ทันตแพทย์', apt.docName));
  if (apt.proc) rows.push(crmRow_('รายการ', apt.proc));
  var buttons = [
    { type: 'button', style: 'primary', color: '#6B2D5E', height: 'sm', action: { type: 'postback', label: '✅ ยืนยันนัด', data: 'apt|confirm|' + apt.id, displayText: 'ยืนยันนัด' } },
    { type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: '📅 ขอเลื่อนนัด', data: 'apt|resched|' + apt.id, displayText: 'ขอเลื่อนนัด' } },
    { type: 'button', style: 'link', height: 'sm', color: '#6B2D5E', action: { type: 'uri', label: '📞 ติดต่อคลินิก', uri: crmTelUri_(s) } }];
  return { type: 'flex', altText: title.replace(/^\S+\s/, '') + ' ' + crmThaiDate_(apt.date) + ' ' + (apt.time || '') + ' น.',
    contents: crmBubble_(s, title, sub, rows, buttons) };
}
function crmAftercareMessages_(s, patName, date, tpls, notes) {
  var parts = ['คุณ' + (patName || '') + ' ขอบคุณที่มาใช้บริการ' + s.clinicName + 'ค่ะ 🙏\nคำแนะนำหลังการรักษาวันนี้ (' + crmThaiDate_(date) + ')'];
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
function crmFollowupMessage_(s, fu, tpl, patName, procText) {
  var opts = [];
  try { opts = JSON.parse(tpl.followupOptions || '[]'); } catch (e) {}
  var q = String(tpl.followupQuestion || '').replace(/\{name\}/g, patName || '').replace(/\{proc\}/g, procText || tpl.name);
  var buttons = opts.slice(0, 9).map(function (o, i) {
    var em = o.kind === 'emergency', sev = o.kind === 'severe';
    return { type: 'button', height: 'sm', style: em ? 'primary' : (o.kind === 'ok' ? 'primary' : 'secondary'),
      color: em ? '#C0392B' : (o.kind === 'ok' ? '#1D825C' : (sev ? '#F5D7DB' : undefined)),
      action: { type: 'postback', label: String(o.label).slice(0, 20), data: 'fu|' + fu.id + '|' + i, displayText: String(o.label) } };
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
  try { return crmTickInner_(); }
  finally { lock.releaseLock(); }
}
function crmIsOrthoApt_(s, apt, orthoActive) {
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
  var quota = crmQuota_();
  var budget = 150;
  if (quota && quota.remaining !== null && quota.remaining !== undefined) budget = Math.min(budget, Math.max(0, quota.remaining - (+s.quotaGuard || 0)));
  if (budget <= 0) { summary.skipped.push('quota'); return summary; }
  var state = crmLogKeys_(); state.pushBudget = budget;
  var links = crmLinkMap_();
  var apts = crmReadByName_('ตารางนัด');
  var treats = crmReadByName_('บันทึกการรักษา');
  var orthoActive = {};
  crmReadByName_('ortho').forEach(function (o) { if (!o['สถานะ'] || o['สถานะ'] === 'กำลังจัด') orthoActive[crmHN_(o.hn)] = true; });
  var closed = ['ยกเลิก', 'เสร็จสิ้น', 'เสร็จ', 'walk-in'];

  function targets(hn) { return (links[crmHN_(hn)] || []).filter(function (x) { return x.consent; }); }

  // 1) ยืนยันนัด + 2) เตือนนัด
  apts.forEach(function (a) {
    a.date = crmDateOnly_(a.date);
    if (!a.id || !a.date || a.date < today || closed.indexOf(a.status) !== -1) return;
    if (a.date === today && a.time && a.time <= hm) return;
    var tg = targets(a.hn); if (!tg.length) return;
    if (s.confirmOn) {
      var ck = crmKey_(s, 'confirm:' + a.id + ':' + a.date + ':' + (a.time || ''));
      if (!crmIsDone_(state, ck)) {
        var prefix = crmKey_(s, 'confirm:' + a.id + ':'), changed = false;
        for (var k in state.done) if (k.indexOf(prefix) === 0 && k.indexOf(ck) !== 0) { changed = true; break; }
        tg.forEach(function (t) {
          if (crmSend_(s, state, { key: ck + '>' + t.lineUserId, type: 'confirm', hn: a.hn, patName: a.patName, lineUserId: t.lineUserId, refId: a.id, detail: a.date + ' ' + (a.time || '') },
            [crmAptMessage_(s, a, changed ? 'change' : 'confirm')])) summary.confirm++;
        });
        if (crmAllDone_(state, ck, tg)) crmMark_(state, ck, 'confirm', { hn: a.hn, patName: a.patName, refId: a.id }, 'done', '');
      }
    }
    if (s.remindOn && hm >= s.remindHour) {
      var days = crmIsOrthoApt_(s, a, orthoActive) ? (+s.orthoDays || 2) : (+s.otherDays || 1);
      if (a.date === crmAddDays_(today, days)) {
        var rk = crmKey_(s, 'remind:' + a.id + ':' + a.date);
        if (!crmIsDone_(state, rk) && crmSentWithinHours_(state, crmKey_(s, 'confirm:' + a.id + ':' + a.date + ':' + (a.time || '')), 12)) {
          crmMark_(state, rk, 'remind', { hn: a.hn, patName: a.patName, refId: a.id }, 'skipped', 'เพิ่งส่งยืนยันนัดไปไม่เกิน 12 ชม.');
        }
        if (!crmIsDone_(state, rk)) {
          tg.forEach(function (t) {
            if (crmSend_(s, state, { key: rk + '>' + t.lineUserId, type: 'remind', hn: a.hn, patName: a.patName, lineUserId: t.lineUserId, refId: a.id, detail: a.date + ' ' + (a.time || '') + ' (' + days + ' วัน)' },
              [crmAptMessage_(s, a, 'remind')])) summary.remind++;
          });
          if (crmAllDone_(state, rk, tg)) crmMark_(state, rk, 'remind', { hn: a.hn, patName: a.patName, refId: a.id }, 'done', '');
        }
      }
    }
  });

  // 3) คำแนะนำหลังรักษา (วันนี้)
  var templates = crmRead_('templates');
  var notes = crmRead_('casenotes');
  if (s.aftercareOn) {
    var byHn = {};
    treats.forEach(function (t) {
      t.date = crmDateOnly_(t.date);
      if (!t.id || t.date !== today || !t.hn) return;
      var k = crmHN_(t.hn); (byHn[k] = byHn[k] || []).push(t);
    });
    Object.keys(byHn).forEach(function (k) {
      var tg = targets(k); if (!tg.length) return;
      var rows = byHn[k].filter(function (t) { return !crmIsDone_(state, crmKey_(s, 'after:' + t.id)); });
      if (!rows.length) return;
      if (+s.aftercareDelayMin > 0) {
        var ready = rows.filter(function (t) {
          var seenKey = crmKey_(s, 'seen:' + t.id);
          if (!state.done[seenKey]) { crmMark_(state, seenKey, 'seen', { hn: t.hn, patName: t.patName, refId: t.id }, 'seen', ''); return false; }
          var seenAt = new Date(String(state.done[seenKey].createdAt).replace(' ', 'T') + '+07:00');
          return (Date.now() - seenAt.getTime()) >= (+s.aftercareDelayMin) * 60000;
        });
        rows = ready; if (!rows.length) return;
      }
      var tpls = [], ids = {};
      rows.forEach(function (t) { crmTemplatesFor_(t.proc, templates).forEach(function (tp) { if (!ids[tp.id]) { ids[tp.id] = 1; tpls.push(tp); } }); });
      var treatIds = rows.map(function (t) { return String(t.id); });
      var myNotes = notes.filter(function (n) { return n.status === 'approved' && treatIds.indexOf(String(n.treatId)) !== -1; });
      if (!tpls.length && !myNotes.length) return; // ยังไม่มี template ที่อนุมัติสำหรับหัตถการนี้ — รอ
      var t0 = rows[0], sentAny = false;
      var msgs = crmAftercareMessages_(s, t0.patName, today, tpls, myNotes);
      tg.forEach(function (t) {
        if (crmSend_(s, state, { key: crmKey_(s, 'after:' + t0.id) + '>' + t.lineUserId, type: 'aftercare', hn: t0.hn, patName: t0.patName, lineUserId: t.lineUserId, refId: treatIds.join(','),
          detail: tpls.map(function (x) { return x.name; }).join(', ') + (myNotes.length ? ' +คำแนะนำพิเศษ' : '') }, msgs)) { summary.aftercare++; sentAny = true; }
      });
      if (crmAllDone_(state, crmKey_(s, 'after:' + t0.id), tg)) {
        rows.forEach(function (t) { crmMark_(state, crmKey_(s, 'after:' + t.id), 'aftercare', { hn: t.hn, patName: t.patName, refId: t.id }, 'done', ''); });
        if (sentAny && !s.testMode) myNotes.forEach(function (n) { crmUpdate_('casenotes', n._row, { status: 'sent', sentAt: crmNow_() }); n.status = 'sent'; });
      }
    });
    // คำแนะนำพิเศษที่อนุมัติหลังจากส่ง aftercare ไปแล้ว → ส่งแยก
    notes.forEach(function (n) {
      if (n.status !== 'approved') return;
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
      var ok = false;
      tg.forEach(function (t) {
        if (crmSend_(s, state, { key: fk + '>' + t.lineUserId, type: 'followup', hn: g0.hn, patName: g0.patName, lineUserId: t.lineUserId, refId: fu.id, detail: procText },
          [crmFollowupMessage_(s, fu, best, g0.patName, procText)])) { ok = true; summary.followup++; }
      });
      if (ok) { fu.status = s.testMode ? 'test' : 'sent'; crmAppend_('followups', fu); }
      if (crmAllDone_(state, fk, tg)) crmMark_(state, fk, 'followup', { hn: g0.hn, patName: g0.patName, refId: fu.id }, 'done', '');
    });
  }
  crmFlushMarks_(state);
  summary.at = crmNow_();
  PropertiesService.getScriptProperties().setProperty('CRM_LAST_TICK', JSON.stringify(summary));
  return summary;
}

/* ตอนเปิดระบบครั้งแรก: นัดที่มีอยู่แล้วไม่ต้องส่ง "ยืนยันนัด" ย้อนหลังทั้งหมด (กันส่งรัว) */
function crmBaseline_(s) {
  var state = crmLogKeys_(), today = crmToday_(), n = 0;
  crmReadByName_('ตารางนัด').forEach(function (a) {
    var d = crmDateOnly_(a.date);
    if (!a.id || !d || d < today) return;
    var ck = crmKey_(s, 'confirm:' + a.id + ':' + d + ':' + (a.time || ''));
    if (!state.done[ck]) { crmMark_(state, ck, 'confirm', { hn: a.hn, patName: a.patName, refId: a.id }, 'baseline', 'นัดที่มีอยู่ก่อนเปิดระบบ'); n++; }
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
function crmHandleWebhook_(events) {
  var s = crmSettings_();
  (events || []).forEach(function (ev) {
    try {
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
    contents: crmBubble_(s, 'ยินดีต้อนรับค่ะ 🦷', 'ผูกบัญชีคนไข้เพื่อดูนัดครั้งถัดไป ประวัติการรักษา และรับการแจ้งเตือนนัดทาง LINE', [],
      [{ type: 'button', style: 'primary', color: '#6B2D5E', height: 'sm', action: { type: 'uri', label: 'ผูกบัญชีคนไข้', uri: crmLiffUrl_('next') } },
       { type: 'button', style: 'link', height: 'sm', color: '#6B2D5E', action: { type: 'uri', label: '📞 ติดต่อคลินิก', uri: crmTelUri_(s) } }]) };
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
function crmCreateTask_(t) {
  var now = crmNow_();
  var task = { id: crmId_('TK'), type: t.type, priority: t.priority || 'normal', status: 'open', hn: t.hn || '', patName: t.patName || '',
    lineUserId: t.lineUserId || '', aptId: t.aptId || '', aptDate: t.aptDate || '', aptTime: t.aptTime || '', detail: t.detail || '',
    preference: '', createdAt: now, updatedAt: now, doneBy: '', resultNote: '' };
  crmAppend_('tasks', task);
  return task;
}
function crmHandlePostback_(s, ev, uid) {
  var data = String((ev.postback && ev.postback.data) || ''), parts = data.split('|');
  var hns = crmUserHns_(uid);
  var isTester = s.testMode && s.testUserId && uid === s.testUserId; // โหมดทดสอบ: บัญชีทดสอบกดปุ่มแทนคนไข้ได้
  if (parts[0] === 'apt') {
    var aptId = parts[2];
    var apt = crmFind_(crmReadByName_('ตารางนัด'), 'id', aptId);
    if (!apt || (hns.indexOf(crmHN_(apt.hn)) === -1 && !isTester)) { crmReply_(ev.replyToken, [crmText_('ไม่พบนัดหมายนี้ในบัญชีของคุณ กรุณาติดต่อคลินิก ' + s.clinicPhone)]); return; }
    var aptRows = crmRead_('apt'), ar = crmFind_(aptRows, 'aptId', aptId), now = crmNow_();
    if (parts[1] === 'confirm') {
      if (ar) crmUpdate_('apt', ar._row, { confirmedAt: now, lastAction: 'confirm', updatedAt: now });
      else crmAppend_('apt', { aptId: aptId, hn: apt.hn, confirmedAt: now, lastAction: 'confirm', updatedAt: now });
      crmReply_(ev.replyToken, [crmText_(s.confirmThanksText + '\n\n📅 ' + crmThaiDate_(crmDateOnly_(apt.date)) + ' เวลา ' + (apt.time || '-') + ' น.')]);
    } else if (parts[1] === 'resched') {
      if (ar) crmUpdate_('apt', ar._row, { rescheduleAt: now, lastAction: 'reschedule', updatedAt: now });
      else crmAppend_('apt', { aptId: aptId, hn: apt.hn, rescheduleAt: now, lastAction: 'reschedule', updatedAt: now });
      var open = crmRead_('tasks').filter(function (t) { return t.type === 'reschedule' && t.status === 'open' && String(t.aptId) === String(aptId); })[0];
      var task = open || crmCreateTask_({ type: 'reschedule', priority: 'normal', hn: apt.hn, patName: apt.patName, lineUserId: uid, aptId: aptId,
        aptDate: crmDateOnly_(apt.date), aptTime: apt.time, detail: 'คนไข้ขอเลื่อนนัด ' + crmDateOnly_(apt.date) + ' ' + (apt.time || '') + (apt.proc ? ' (' + apt.proc + ')' : '') + (apt.docName ? ' ' + apt.docName : '') });
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
      if (opt.kind === 'ok') reply += crmNextAptText_(fu.hn, crmReadByName_('ตารางนัด'));
    }
    if (reply) crmReply_(ev.replyToken, [crmText_(reply)]);
  }
}
function crmEmergencyText_(s) { return String(s.emergencyText || '').trim(); }
function crmHandleText_(s, ev, uid) {
  var text = String(ev.message.text || '');
  if (crmHasWord_(text, crmSplitList_(s.emergencyKeywords))) {
    var hns = crmUserHns_(uid), name = '';
    if (hns.length) { var l = crmRead_('links').filter(function (x) { return x.lineUserId === uid && x.status === 'active'; })[0]; name = l ? l.patName : ''; }
    crmCreateTask_({ type: 'emergency', priority: 'urgent', hn: hns[0] || '', patName: name, lineUserId: uid, detail: 'ข้อความจากคนไข้: ' + text.slice(0, 300) });
    var ack = crmEmergencyText_(s);
    if (ack) crmReply_(ev.replyToken, [crmText_(ack)]);
    return;
  }
  var t = text.replace(/\s/g, '');
  if (/^(นัด|ดูนัด|นัดครั้งถัดไป)$/.test(t)) {
    var hn2 = crmUserHns_(uid);
    if (!hn2.length) { crmReply_(ev.replyToken, [crmWelcome_(s)]); return; }
    var apts = crmReadByName_('ตารางนัด'), lines = [];
    hn2.forEach(function (h) { var x = crmNextAptText_(h, apts, crmAddDays_(crmToday_(), -1)); if (x) lines.push(x.trim()); });
    crmReply_(ev.replyToken, [crmText_(lines.length ? lines.join('\n') : 'ยังไม่มีนัดครั้งถัดไปค่ะ ติดต่อนัดได้ที่ ' + s.clinicPhone)]);
  } else if (/^(ผูกบัญชี|ลงทะเบียน)$/.test(t)) {
    crmReply_(ev.replyToken, [crmWelcome_(s)]);
  }
  // ข้อความอื่น ๆ ปล่อยให้พนักงานตอบผ่าน LINE OA Chat ตามปกติ (ไม่มี AI ตอบแทน)
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
function crmPortal_(p) {
  var u = crmVerifyUser_(p);
  if (!u) return { ok: false, error: 'auth' };
  var links = crmRead_('links').filter(function (l) { return l.lineUserId === u.userId; });
  var active = {}, pending = [];
  links.forEach(function (l) {
    if (l.status === 'active') active[crmHN_(l.hn)] = { hn: l.hn, name: l.patName, consent: String(l.consent).toUpperCase() !== 'FALSE' };
    else if (l.status === 'pending') pending.push({ name: l.inputName || l.patName, createdAt: l.createdAt });
  });
  var orthoRows = crmReadByName_('ortho');
  orthoRows.forEach(function (o) { if (o.lineUserId === u.userId && !active[crmHN_(o.hn)]) active[crmHN_(o.hn)] = { hn: o.hn, name: o['ชื่อ'], consent: true }; });
  var keys = Object.keys(active);
  var today = crmToday_();
  var apts = keys.length ? crmReadByName_('ตารางนัด') : [];
  var treats = keys.length ? crmReadByName_('บันทึกการรักษา') : [];
  var logs = keys.length ? crmReadByName_('ortho_log') : [];
  var patients = keys.map(function (k) {
    var a = active[k];
    var next = apts.filter(function (x) { return crmHN_(x.hn) === k && crmDateOnly_(x.date) >= today && ['ยกเลิก', 'เสร็จสิ้น', 'เสร็จ'].indexOf(x.status) === -1; })
      .map(function (x) { return { id: x.id, date: crmDateOnly_(x.date), time: x.time || '', proc: x.proc || '', docName: x.docName || '' }; })
      .sort(function (x, y) { return (x.date + x.time).localeCompare(y.date + y.time); }).slice(0, 5);
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
  var u = crmVerifyUser_(p);
  if (!u) return { ok: false, error: 'auth' };
  if (String(p.consent) !== '1') return { ok: false, error: 'consent_required' };
  var phone = crmPhone_(p.phone), name = crmNameKey_(p.name), code = String(p.code || '').trim().toUpperCase();
  if (phone.length < 9 || !name) return { ok: false, error: 'missing_field' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = crmSettings_(), now = crmNow_();
    var pats = crmReadByName_('คนไข้');
    var matches = pats.filter(function (r) {
      if (crmPhone_(r.phone || r['เบอร์โทร'] || r['เบอร์'] || '') !== phone) return false;
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
    var auto = codeOk || (s.linkApproval === 'auto' && matches.length >= 1);
    var created = [];
    if (!matches.length) {
      if (!existing.some(function (l) { return l.status === 'pending' && crmPhone_(l.inputPhone) === phone; })) {
        crmAppend_('links', { id: crmId_('LK'), lineUserId: u.userId, hn: '', patName: '', status: 'pending', source: 'self', consent: 'TRUE',
          displayName: u.name, inputName: p.name, inputPhone: p.phone, createdAt: now, note: 'ไม่พบเบอร์+ชื่อที่ตรงกันในรายชื่อคนไข้' });
      }
      return { ok: true, status: 'pending', matched: 0 };
    }
    matches.forEach(function (m) {
      var already = existing.filter(function (l) { return crmHN_(l.hn) === crmHN_(m.hn) && l.status !== 'revoked'; })[0];
      if (already) { if (auto && already.status === 'pending') crmUpdate_('links', already._row, { status: 'active', approvedBy: codeOk ? 'รหัสจัดฟัน' : 'อัตโนมัติ', approvedAt: now }); return; }
      crmAppend_('links', { id: crmId_('LK'), lineUserId: u.userId, hn: m.hn, patName: m.name || m['ชื่อ'] || '', status: auto ? 'active' : 'pending',
        source: codeOk ? 'ortho-code' : 'self', consent: 'TRUE', displayName: u.name, inputName: p.name, inputPhone: p.phone, createdAt: now,
        approvedBy: auto ? (codeOk ? 'รหัสจัดฟัน' : 'อัตโนมัติ') : '', approvedAt: auto ? now : '' });
      created.push(m.hn);
    });
    if (codeOk) { try { orthoSetLineId(crmHN_(matches[0].hn), u.userId, matches[0].name || ''); } catch (e) {} }
    return { ok: true, status: auto ? 'active' : 'pending', matched: matches.length };
  } finally { lock.releaseLock(); }
}
function crmConsent_(p) {
  var u = crmVerifyUser_(p);
  if (!u) return { ok: false, error: 'auth' };
  var on = String(p.on) === '1' ? 'TRUE' : 'FALSE';
  crmRead_('links').forEach(function (l) { if (l.lineUserId === u.userId && l.status === 'active') crmUpdate_('links', l._row, { consent: on }); });
  return { ok: true, consent: on === 'TRUE' };
}

/* ============================ STAFF DASHBOARD ============================ */
function crmDashboard_() {
  var s = crmSettings_();
  var since = crmAddDays_(crmToday_(), -45);
  var logAll = crmRead_('log');
  var stats = {};
  logAll.forEach(function (r) {
    if (!r.createdAt) return;
    var m = String(r.createdAt).slice(0, 7);
    stats[m] = stats[m] || { sent: 0, test: 0, failed: 0, byType: {} };
    if (r.status === 'sent' || r.status === 'test' || r.status === 'failed') {
      stats[m][r.status] += (r.status === 'failed') ? 1 : (+r.pushCount || 0);
      if (r.status === 'sent') stats[m].byType[r.type] = (stats[m].byType[r.type] || 0) + (+r.pushCount || 0);
    }
  });
  var log = logAll.filter(function (r) { return String(r.createdAt).slice(0, 10) >= since && r.status !== 'done' && r.status !== 'seen'; })
    .map(function (r) { delete r._row; return r; }).slice(-2500);
  var strip = function (rows) { return rows.map(function (r) { delete r._row; return r; }); };
  var tasks = crmRead_('tasks').filter(function (t) { return t.status === 'open' || String(t.updatedAt).slice(0, 10) >= crmAddDays_(crmToday_(), -60); });
  var triggers = [];
  try { triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) {}
  var lastTick = null; try { lastTick = JSON.parse(crmProp_('CRM_LAST_TICK', 'null')); } catch (e) {}
  var quota = null; try { quota = crmQuota_(); } catch (e) {}
  return { ok: true, settings: s, templates: strip(crmRead_('templates')), tasks: strip(tasks),
    followups: strip(crmRead_('followups').filter(function (f) { return String(f.sentAt).slice(0, 10) >= since; })),
    links: strip(crmRead_('links')), followers: strip(crmRead_('followers')), apt: strip(crmRead_('apt')),
    casenotes: strip(crmRead_('casenotes').filter(function (n) { return String(n.createdAt).slice(0, 10) >= since; })),
    campaigns: strip(crmRead_('campaigns')), log: log, stats: stats, quota: quota, lastTick: lastTick,
    linked: crmLinkMap_(), orthoActive: crmReadByName_('ortho').filter(function (o) { return !o['สถานะ'] || o['สถานะ'] === 'กำลังจัด'; }).map(function (o) { return crmHN_(o.hn); }),
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
        'aftercareOn','aftercareDelayMin','followupOn','followupHour','clinicName','clinicPhone','linkApproval','quotaGuard','emergencyKeywords','emergencyText','rescheduleText','confirmThanksText'];
      allowed.forEach(function (k2) { if (inc[k2] !== undefined) s[k2] = inc[k2]; });
      ['enabled','testMode','confirmOn','remindOn','aftercareOn','followupOn'].forEach(function (k3) { s[k3] = (s[k3] === true || s[k3] === 'true' || s[k3] === 'TRUE'); });
      if (s.enabled && s.testMode && !s.testUserId) return { ok: false, error: 'โหมดทดสอบต้องเลือกบัญชี LINE สำหรับทดสอบก่อน' };
      var baseline = 0;
      crmSaveSettingsRaw_(s);
      if (s.enabled && (!old.enabled || old.testMode !== s.testMode)) baseline = crmBaseline_(s);
      return { ok: true, baseline: baseline };
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
  var q = crmQuota_(true);
  if (q.remaining !== null && q.remaining !== undefined && q.remaining - (+s.quotaGuard || 0) < uids.length) return { ok: false, error: 'โควตาไม่พอ (เหลือ ' + q.remaining + ', ต้องใช้ ' + uids.length + ')' };
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
  var demoApt = { id: 'TEST', date: crmAddDays_(crmToday_(), 1), time: '10:30', patName: 'ทดสอบ ระบบ', docName: 'หมอทอย', proc: 'ขูดหินปูน' };
  var msgs;
  if (b.kind === 'aftercare') {
    var tp = crmFind_(crmRead_('templates'), 'id', b.templateId);
    if (!tp) return { ok: false, error: 'not_found' };
    msgs = [crmText_('🧪 ตัวอย่างข้อความ (สถานะ: ' + tp.status + ')')].concat(crmAftercareMessages_(s, 'ทดสอบ ระบบ', crmToday_(), [tp], []));
    if (String(tp.followupEnabled).toUpperCase() === 'TRUE') msgs.push(crmFollowupMessage_(s, { id: 'TEST' }, tp, 'ทดสอบ ระบบ', tp.name));
  } else {
    msgs = [crmText_('🧪 ตัวอย่างข้อความยืนยันนัด/เตือนนัด'), crmAptMessage_(s, demoApt, 'confirm'), crmAptMessage_(s, demoApt, 'remind')];
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
