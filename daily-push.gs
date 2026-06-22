/**********************************************************************
 * Bangluang Dental — Daily Push Notifications (Google Apps Script)
 * ไฟล์นี้วางในโปรเจกต์เดียวกับ ortho-backend.gs
 *
 * ฟังก์ชันหลัก:  dailyPush()   ← trigger เรียกทุกเช้า 08:00
 *
 * ติดตั้งครั้งเดียว:
 *   รัน setupDailyTrigger()  → สร้าง trigger อัตโนมัติ
 *   รัน deleteTriggers()     → ลบ trigger เดิมก่อนสร้างใหม่
 *
 * ทดสอบ:
 *   รัน dailyPush()          → ส่งจริงทันที (ใช้วันนี้เป็น base)
 *   รัน dryRun()             → แสดง Logger เท่านั้น ไม่ส่ง LINE
 **********************************************************************/

/* ใช้ ORTHO_LINE_TOKEN / SHEET_ORTHO / SHEET_ORTHO_LOG / TZ จาก ortho-backend.gs / รหัส.gs */

/* ============== CONFIG ============== */
var PUSH_HOUR = 8;   // ส่งเวลา 08:xx น.

// จำนวนวันที่ต้องการเตือน — แก้ได้
var APT_REMIND_DAYS  = [7, 1];    // เตือนก่อนนัด 7 วัน และ 1 วัน
var ADJ_WARN_DAYS    = [35, 45];  // เตือนเมื่อไม่มา adjust นาน 35 / 45 วัน

/* ============== MAIN ============== */
function dailyPush() {
  var today = todayDateStr_();
  Logger.log('=== dailyPush ' + today + ' ===');
  var sent = 0;
  sent += sendAptReminders_(today, false);
  sent += sendAdjustReminders_(today, false);
  Logger.log('รวมส่ง ' + sent + ' ข้อความ');
}

function dryRun() {
  var today = todayDateStr_();
  Logger.log('=== DRY RUN ' + today + ' (ไม่ส่ง LINE) ===');
  sendAptReminders_(today, true);
  sendAdjustReminders_(today, true);
}

/* ============== 1) เตือนนัด ============== */
function sendAptReminders_(today, dry) {
  var rows = orthoSheetToObjects_(SHEET_ORTHO);
  var sent = 0;

  rows.forEach(function (r) {
    if (!r.lineUserId || !r['นัดถัดไป']) return;
    if (r['สถานะ'] && r['สถานะ'] !== 'กำลังจัด') return; // เคสเสร็จ/เลิกแล้ว ไม่ต้องเตือน
    var aptDate = normDateStr_(r['นัดถัดไป']);
    if (!aptDate) return;

    APT_REMIND_DAYS.forEach(function (days) {
      // วันนัด - days = วันที่ควรส่ง
      var sendOn = addDays_(aptDate, -days);
      if (sendOn !== today) return;

      var key = 'apt:' + r.hn + ':' + aptDate + ':d' + days;
      if (alreadySent_(key)) { Logger.log('skip(ส่งแล้ว) ' + key); return; }

      var msg = days === 1
        ? buildAptMsg1_(r, aptDate)
        : buildAptMsg3_(r, aptDate, days);

      Logger.log((dry ? '[DRY] ' : '') + 'ส่งเตือนนัด ' + days + 'วัน → ' + r['ชื่อ'] + ' (' + r.hn + ') นัด ' + aptDate);
      if (!dry) { orthoPushLine_(r.lineUserId, [msg]); markSent_(key); }
      sent++;
    });
  });
  return sent;
}

/* ============== 2) เตือนเกินกำหนด adjust ============== */
function sendAdjustReminders_(today, dry) {
  var orthos   = orthoSheetToObjects_(SHEET_ORTHO);
  var allLogs  = orthoSheetToObjects_(SHEET_ORTHO_LOG);
  var sent = 0;

  // สร้าง map: hn → วันที่ล่าสุดที่มา adjust
  var lastVisit = {};
  allLogs.forEach(function (l) {
    var hn = orthoNormHN_(l.hn);
    var d  = normDateStr_(l['วันที่']);
    if (!hn || !d) return;
    if (!lastVisit[hn] || d > lastVisit[hn]) lastVisit[hn] = d;
  });

  orthos.forEach(function (r) {
    if (!r.lineUserId) return;
    if (r['สถานะ'] && r['สถานะ'] !== 'กำลังจัด') return; // เคสเสร็จ/เลิกแล้ว ไม่ต้องเตือน
    var hn = orthoNormHN_(r.hn);

    // ถ้าไม่มี log เลย ใช้วันเริ่มจัดฟันเป็น baseline
    var base = lastVisit[hn] || normDateStr_(r['วันเริ่ม']);
    if (!base) return;

    var daysSince = diffDays_(base, today);

    ADJ_WARN_DAYS.forEach(function (threshold) {
      if (daysSince !== threshold) return;

      var key = 'adj:' + hn + ':' + base + ':d' + threshold;
      if (alreadySent_(key)) { Logger.log('skip(ส่งแล้ว) ' + key); return; }

      var msg = threshold === ADJ_WARN_DAYS[ADJ_WARN_DAYS.length - 1]
        ? buildAdjUrgent_(r, threshold)   // วันสูงสุด (45) = urgent
        : buildAdjWarn_(r, threshold);    // วันกลาง (35) = แจ้งเตือน

      Logger.log((dry ? '[DRY] ' : '') + 'เตือน adj ' + threshold + 'วัน → ' + r['ชื่อ'] + ' (ไม่มาตั้งแต่ ' + base + ')');
      if (!dry) { orthoPushLine_(r.lineUserId, [msg]); markSent_(key); }
      sent++;
    });
  });
  return sent;
}

/* ============== MESSAGE BUILDERS ============== */
function buildAptMsg1_(r, date) {
  return orthoTextMsg_(
    '🦷 แจ้งเตือนจากคลินิกทันตกรรมบางหลวง\n\n' +
    'คุณ' + (r['ชื่อ']||'') + ' มีนัดจัดฟันพรุ่งนี้\n' +
    '📅 วันที่ ' + thaiDate_(date) + '\n' +
    (r['หมอ'] ? '👩‍⚕️ ' + r['หมอ'] + '\n' : '') +
    '\nหากไม่สะดวกเวลานี้  กรุณาแจ้งคลินิกล่วงหน้าด้วยนะคะ \n' +
    'ทั้งนี้ แอดมินอาจจะทักไปสอบถามเปลี่ยนเวลานัดเพื่อให้เหมาะสมกับวันนั้นๆอีกครั้งค่ะ 🙏'
  );
}

function buildAptMsg3_(r, date, days) {
  return orthoTextMsg_(
    '🦷 แจ้งเตือนจากคลินิกทันตกรรมบางหลวง\n\n' +
    'คุณ' + (r['ชื่อ']||'') + ' มีนัดจัดฟันในอีก ' + days + ' วัน\n' +
    '📅 วันที่ ' + thaiDate_(date) + '\n' +
    (r['หมอ'] ? '👩‍⚕️ ' + r['หมอ'] + '\n' : '') +
    '\nหากไม่สะดวก กรุณาโทรแจ้งล่วงหน้าด้วยนะคะ 🙏'
  );
}

function buildAdjWarn_(r, days) {
  return orthoTextMsg_(
    '🦷 แจ้งเตือนจากคลินิกทันตกรรมบางหลวง(auto)\n\n' +
    'คุณ' + (r['ชื่อ']||'') + ' ผ่านมา ' + days + ' วันแล้ว\n' +
    'นับตั้งแต่ครั้งล่าสุดที่มาปรับเครื่องมือ\n' +
    'หากเกิน 45 วัน  จะเสียสิทธิ์ในการได้โปรชำระ 28ครั้งค่ะ\n\n' +
    'ควรนัดมาพบหมอเพื่อปรับเครื่องมือ ตามแผนการรักษานะคะ\n' +
    'ติดต่อคลินิกเพื่อนัดได้เลยค่ะ 😊'
  );
}

function buildAdjUrgent_(r, days) {
  return orthoTextMsg_(
    '🦷 แจ้งเตือนจากคลินิกทันตกรรมบางหลวง (auto)\n\n\n' +
    'คุณ' + (r['ชื่อ']||'') + ' ผ่านมา ' + days + ' วันแล้ว\n' +
    'นับตั้งแต่ครั้งล่าสุดที่มาปรับเครื่องมือ\n' +
    'ตอนนี้เสียสิทธิ์ในการได้โปรชำระ 28ครั้งค่ะ\n\n' +
    'ควรนัดมาพบหมอเพื่อปรับเครื่องมือต่อโดยชำระรายครั้ง 1,500 บาทจนกว่าจะเสร็จนะคะ\n\n' +
    'ติดต่อคลินิกเพื่อนัดได้เลยค่ะ 😊'
  );
}

/* ============== DEDUP (ScriptProperties) ============== */
// key บันทึกใน ScriptProperties: "sent_{key}" = วันที่ส่ง
// ล้างอัตโนมัติเมื่ออายุเกิน 180 วัน (กันเต็ม quota)
function alreadySent_(key) {
  var props = PropertiesService.getScriptProperties();
  return !!props.getProperty('sent_' + key);
}
function markSent_(key) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('sent_' + key, todayDateStr_());
  // ทำความสะอาด property เก่า (>180 วัน) ทุกครั้งที่เขียน
  try { cleanOldProps_(props); } catch(e) {}
}
function cleanOldProps_(props) {
  var all = props.getProperties();
  var cutoff = addDays_(todayDateStr_(), -180);
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sent_') === 0 && all[k] < cutoff) props.deleteProperty(k);
  });
}

/* ============== DATE HELPERS ============== */
function todayDateStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}
function normDateStr_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var s = String(v).trim();
  // M/D/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    var pts = s.split('/');
    return pts[2] + '-' + pts[0].padStart(2,'0') + '-' + pts[1].padStart(2,'0');
  }
  // already yyyy-MM-dd or ISO
  var m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}
function addDays_(dateStr, days) {
  var d = new Date(dateStr + 'T00:00:00+07:00');
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
function diffDays_(from, to) {
  var a = new Date(from + 'T00:00:00+07:00');
  var b = new Date(to   + 'T00:00:00+07:00');
  return Math.round((b - a) / 86400000);
}
function thaiDate_(dateStr) {
  var d = new Date(dateStr + 'T00:00:00+07:00');
  var months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  var days   = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
  return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + (d.getFullYear()+543);
}

/* ============== TRIGGER SETUP ============== */
function setupDailyTrigger() {
  // ลบ trigger ที่ชี้ dailyPush เดิมก่อน
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyPush') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyPush')
    .timeBased()
    .everyDays(1)
    .atHour(PUSH_HOUR)
    .inTimezone('Asia/Bangkok')
    .create();
  Logger.log('✅ ตั้ง trigger dailyPush ทุกวัน ' + PUSH_HOUR + ':00 น. (Asia/Bangkok) สำเร็จ');
}

function deleteTriggers() {
  var all = ScriptApp.getProjectTriggers();
  all.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('ลบ trigger ทั้งหมด ' + all.length + ' รายการ');
}

/* ============== reuse helpers from ortho-backend.gs ============== */
/* orthoPushLine_, orthoTextMsg_, orthoSheetToObjects_, orthoNormHN_ ถูก define ไว้ใน ortho-backend.gs แล้ว */
