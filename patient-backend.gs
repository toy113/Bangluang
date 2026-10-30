// Patient LIFF API. Add to the existing bound Apps Script project.
// Required Script Property: PATIENT_LINE_CHANNEL_ID (LINE Login channel, not Messaging API).
// Never accept a user ID or HN from the browser as authorization to read a record.
var PATIENT_LINK_HEADERS = ['lineUserId','hn','linkedAt'];

function patientRouteGet_(e) {
  var action = ((e || {}).parameter || {}).action || '';
  return /^patient/.test(action) ? orthoJsonOut_({ok:false,error:'post_required'}) : null;
}
function patientRoutePost_(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (_) { return null; }
  if (!/^patient/.test(body.action || '')) return null;
  try {
    var userId = patientVerifyLine_(body.accessToken);
    if (body.action === 'patientGet') return orthoJsonOut_(patientGet_(userId));
    if (body.action === 'patientBind') return orthoJsonOut_(patientBind_(userId, body));
    return orthoJsonOut_({ok:false,error:'unknown_action'});
  } catch (err) {
    // Do not return upstream responses, tokens, sheet contents or stack traces.
    return orthoJsonOut_({ok:false,error:err.message === 'config_missing' ? 'config_missing' : 'unauthorized'});
  }
}
function patientVerifyLine_(token) {
  var channel = PropertiesService.getScriptProperties().getProperty('PATIENT_LINE_CHANNEL_ID');
  if (!channel) throw new Error('config_missing');
  if (typeof token !== 'string' || !token || token.length > 4096) throw new Error('unauthorized');
  var verify = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(token), {muteHttpExceptions:true});
  if (verify.getResponseCode() !== 200) throw new Error('unauthorized');
  var data = JSON.parse(verify.getContentText());
  if (String(data.client_id) !== String(channel) || !(Number(data.expires_in) > 0) || String(data.scope || '').split(' ').indexOf('profile') < 0) throw new Error('unauthorized');
  var profile = UrlFetchApp.fetch('https://api.line.me/v2/profile', {headers:{Authorization:'Bearer ' + token},muteHttpExceptions:true});
  if (profile.getResponseCode() !== 200) throw new Error('unauthorized');
  var id = JSON.parse(profile.getContentText()).userId;
  if (!/^U[0-9a-f]{32}$/i.test(id || '')) throw new Error('unauthorized');
  return id;
}
function patientHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value)).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function patientPhone_(value) {
  var s = String(value || '').replace(/\D/g,'');
  if (/^66\d{9}$/.test(s)) s = '0' + s.slice(2);
  return /^0\d{8,9}$/.test(s) ? s : '';
}
function patientFind_(hn) {
  return orthoSheetToObjects_('คนไข้').filter(function(p){return orthoNormHN_(p.hn || p.HN) === hn;})[0];
}
function patientLinks_() { return orthoGetSheet_('line_patient_links', PATIENT_LINK_HEADERS); }
function patientLinkOf_(userId) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('line_patient_links');
  if (!sh) return null;
  return orthoSheetToObjects_('line_patient_links').filter(function(l){return String(l.lineUserId) === userId;})[0] || null;
}
function patientBind_(userId, body) {
  var hn = orthoNormHN_(body.hn), phone = patientPhone_(body.phone), code = String(body.code || '').trim().toUpperCase();
  if (!hn || hn.length > 30 || !phone || !/^[A-F0-9]{12}$/.test(code)) return {ok:false,error:'bind_failed'};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache();
    var now = Date.now(), rateKey = 'patient-attempt:' + patientHash_(userId);
    var attempts = Number(cache.get(rateKey) || 0);
    if (attempts >= 5) return {ok:false,error:'too_many_attempts'};
    cache.put(rateKey, String(attempts+1), 900);
    var key = 'patient-code:' + patientHash_(hn);
    var issued = JSON.parse(props.getProperty(key) || '{}');
    var p = patientFind_(hn);
    if (!p || !issued.hash || issued.expires <= now || Number(issued.attempts || 0) >= 5) return {ok:false,error:'bind_failed'};
    issued.attempts = Number(issued.attempts || 0)+1;
    props.setProperty(key, JSON.stringify(issued));
    if (patientHash_(code) !== issued.hash || patientPhone_(p.phone || p['เบอร์โทร']) !== phone) return {ok:false,error:'bind_failed'};
    var links = orthoSheetToObjects_('line_patient_links');
    // Rebinding another patient/LINE requires clinic staff to revoke the old binding first.
    if (links.some(function(l){return (String(l.lineUserId)===userId && orthoNormHN_(l.hn)!==hn) || (orthoNormHN_(l.hn)===hn && String(l.lineUserId)!==userId);})) return {ok:false,error:'already_linked'};
    if (!links.some(function(l){return String(l.lineUserId)===userId && orthoNormHN_(l.hn)===hn;})) {
      patientLinks_().appendRow([userId, hn, new Date().toISOString()]);
    }
    props.deleteProperty(key); cache.remove(rateKey);
    return {ok:true};
  } finally { lock.releaseLock(); }
}
function patientItems_(value) {
  if (Array.isArray(value)) return value.join(', ');
  var str = String(value || '');
  if (str.charAt(0)==='[') {try {var a=JSON.parse(str); if(Array.isArray(a)) return a.join(', ');} catch(_) {}}
  return str;
}
function patientDate_(value) { return String(value || '').slice(0,10); }
function patientIsCancelled_(r) { return ['ยกเลิก','cancelled','canceled'].indexOf(String(r.status || '').toLowerCase()) >= 0; }
function patientData_(hn, patient, appts, treatments, orthos, allLogs, today) {
  function own(r){return orthoNormHN_(r.hn || r.HN) === hn;}
  var ortho = orthos.filter(own)[0] || null;
  var logs = allLogs.filter(own).filter(function(l){return patientDate_(l['วันที่']) && patientDate_(l['วันที่']) <= today;});
  logs.sort(function(a,b){return patientDate_(b['วันที่']).localeCompare(patientDate_(a['วันที่']));});
  var visits = {}, loose = [];
  logs.forEach(function(l){
    var actions = String(l['ทำอะไร'] || '').split(/[,、]/).map(function(s){return s.trim();});
    if (actions.indexOf('ปรับเครื่องมือ') >= 0) visits[patientDate_(l['วันที่'])] = true;
    if (actions.indexOf('เครื่องมือหลุด') >= 0) loose.push(patientDate_(l['วันที่']));
  });
  var next = appts.filter(function(a){
    return own(a) && patientDate_(a.date) >= today && !patientIsCancelled_(a) && ['เสร็จแล้ว','มาตามนัด','รักษาแล้ว'].indexOf(String(a.status || '')) < 0;
  }).map(function(a){return {date:patientDate_(a.date),time:String(a.time || '').slice(0,5),procedure:patientItems_(a.proc),doctor:String(a.docName || '')};});
  // Ortho appointments are maintained separately in the existing manager screen.
  if (ortho && patientDate_(ortho['นัดถัดไป']) >= today && ortho['สถานะ'] !== 'ยกเลิก') {
    var oa = {date:patientDate_(ortho['นัดถัดไป']),time:String(ortho['นัดถัดไปเวลา'] || '').slice(0,5),procedure:String(ortho['รายการนัดถัดไป'] || 'นัดจัดฟัน'),doctor:String(ortho['หมอ'] || '')};
    if (!next.some(function(a){return a.date===oa.date && a.time===oa.time && a.doctor===oa.doctor;})) next.push(oa);
  }
  next.sort(function(a,b){return (a.date+' '+a.time).localeCompare(b.date+' '+b.time);});
  var history = treatments.filter(function(t){return own(t) && !patientIsCancelled_(t) && patientDate_(t.date) && patientDate_(t.date) <= today;}).map(function(t){
    // Deliberate allowlist: internal notes, finances, other patients and staff settings are never returned.
    return {date:patientDate_(t.date),procedure:patientItems_(t.proc),doctor:String(t.docName || '')};
  }).sort(function(a,b){return b.date.localeCompare(a.date);});
  return {ok:true,bound:true,patient:{name:String(patient.name || patient['ชื่อ'] || ''),hn:hn},nextAppointment:next[0] || null,appointments:next,
    history:history,ortho:ortho ? {type:String(ortho['แบบจัด'] || ''),doctor:String(ortho['หมอ'] || ''),status:String(ortho['สถานะ'] || ''),startDate:patientDate_(ortho['วันเริ่ม']),adjustmentCount:Object.keys(visits).length,looseCount:loose.length,looseDates:loose,
      logs:logs.map(function(l){return {date:patientDate_(l['วันที่']),procedure:String(l['ทำอะไร'] || ''),doctor:String(l['หมอ'] || ''),wire:String(l['ลวด'] || ''),elastic:String(l['ยาง'] || '')};})} : null,
    updatedAt:new Date().toISOString()};
}
function patientGet_(userId) {
  var link = patientLinkOf_(userId);
  if (!link) return {ok:true,bound:false};
  var hn = orthoNormHN_(link.hn), p = patientFind_(hn);
  if (!p) return {ok:false,error:'patient_unavailable'};
  return patientData_(hn,p,orthoSheetToObjects_('ตารางนัด'),orthoSheetToObjects_('บันทึกการรักษา'),orthoSheetToObjects_('ortho'),orthoSheetToObjects_('ortho_log'),Utilities.formatDate(new Date(),'Asia/Bangkok','yyyy-MM-dd'));
}
// Run setupPatientPortal once from Apps Script. No new public admin endpoint is added.
function setupPatientPortal() {
  patientLinks_();
  try {patientAddMenu_();} catch (_) {Logger.log('สร้างชีตผูกบัญชีแล้ว กรุณาเปิดชีตใหม่เพื่อแสดงเมนู LINE คนไข้');}
}
function patientAddMenu_() {
  SpreadsheetApp.getUi().createMenu('LINE คนไข้').addItem('ออกรหัสผูกบัญชี (30 นาที)','issuePatientLinkCode').addItem('ยกเลิกการผูก LINE','revokePatientLink').addSeparator().addItem('สร้างรหัสเจ้าหน้าที่ใหม่','setupStaffAccess').addToUi();
}
function onOpen() { patientAddMenu_(); }
function issuePatientLinkCode() {
  var ui=SpreadsheetApp.getUi(), result=ui.prompt('ออกรหัสผูก LINE','กรอก HN ของคนไข้ที่ตรวจสอบตัวตนแล้ว',ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton()!==ui.Button.OK) return;
  var hn=orthoNormHN_(result.getResponseText());
  if (!patientFind_(hn)) {ui.alert('ไม่พบ HN'); return;}
  var lock=LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var code=Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();
    PropertiesService.getScriptProperties().setProperty('patient-code:'+patientHash_(hn),JSON.stringify({hash:patientHash_(code),expires:Date.now()+30*60000,attempts:0}));
    ui.alert('รหัสสำหรับ HN '+hn+' (ใช้ครั้งเดียว ภายใน 30 นาที)',code+'\nแจ้งรหัสนี้ให้คนไข้ที่ตรวจสอบตัวตนแล้วเท่านั้น',ui.ButtonSet.OK);
  } finally {lock.releaseLock();}
}
function revokePatientLink() {
  var ui=SpreadsheetApp.getUi(), result=ui.prompt('ยกเลิกการผูก LINE','กรอก HN ที่ต้องการยกเลิก',ui.ButtonSet.OK_CANCEL);
  if(result.getSelectedButton()!==ui.Button.OK) return;
  var hn=orthoNormHN_(result.getResponseText());
  if (!hn || ui.alert('ยืนยันยกเลิก LINE ของ HN '+hn+'?',ui.ButtonSet.YES_NO)!==ui.Button.YES) return;
  var lock=LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sh=patientLinks_(), data=sh.getDataRange().getValues();
    for(var r=data.length-1;r>0;r--) if(orthoNormHN_(data[r][1])===hn) sh.deleteRow(r+1);
    PropertiesService.getScriptProperties().deleteProperty('patient-code:'+patientHash_(hn));
    ui.alert('ยกเลิกการผูกเรียบร้อย');
  } finally {lock.releaseLock();}
}
