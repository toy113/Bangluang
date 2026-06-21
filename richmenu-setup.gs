/**********************************************************************
 * Bangluang Dental — ติดตั้ง Rich Menu จัดฟัน (Google Apps Script)
 *
 * ขั้นตอน:
 *   1) อัปโหลด richmenu.png ขึ้น GitHub Pages -> เอา URL มาใส่ RICHMENU_IMAGE_URL
 *      (เช่น https://toy113.github.io/Bangluang/richmenu.png)
 *   2) สร้าง LIFF app ใน LINE Developers (endpoint = หน้า liff-ortho.html)
 *      -> เอา LIFF ID มาใส่ LIFF_ID
 *   3) ใส่ LINE_TOKEN (Channel access token เดียวกับ backend)
 *   4) รัน setupRichMenu() หนึ่งครั้ง  -> สร้าง + อัปรูป + ตั้งเป็นเมนูเริ่มต้น
 *
 *   ถ้าจะแก้เมนูใหม่: รัน deleteAllRichMenus() ก่อน แล้วค่อย setupRichMenu() อีกครั้ง
 *   ⚠️ เมนูนี้มี 3 ช่อง (เดิม 6 ช่อง) — ต้องเตรียม richmenu.png ใหม่ให้ตรงกับ
 *      เลย์เอาต์ 3 คอลัมน์ x 1 แถวด้วย ไม่งั้นรูปเก่ากับพื้นที่กดจะไม่ตรงกัน
 **********************************************************************/

var LINE_TOKEN          = 'cwTKCta3n3WjIO/ZZ1a6iEwGDMtWQcKuCc6Fd7snhB1Zq734zwa9JL+29IpHM1vBQt/RUv7SYcXDSRvubK4v1GN1i43OyMdZ8pXfA36deWzB4R50NyGAsW+ingrPXMe911z9AIckrrznm98mM95iYQdB04t89/1O/w1cDnyilFU=';
var LIFF_ID             = '2010461984-kt5dSgin';
var RICHMENU_IMAGE_URL  = 'https://toy113.github.io/Bangluang/richmenu.png';

function liffUrl_(hash) {
  return 'https://liff.line.me/' + LIFF_ID + (hash ? ('#' + hash) : '');
}

function richMenuObject_() {
  // ภาพ 2500 x 1686, ตาราง 3 คอลัมน์ x 1 แถว (เต็มความสูง)
  var cw = 833, ch = 1686;
  function area(col, row, action) {
    return {
      bounds: { x: col * cw, y: row * ch, width: cw, height: ch },
      action: action
    };
  }
  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'ortho-menu',
    chatBarText: 'เมนูจัดฟัน',
    areas: [
      area(0, 0, { type: 'uri', label: 'ข้อมูลของฉัน',  uri: liffUrl_('') }),
      area(1, 0, { type: 'uri', label: 'นัดครั้งถัดไป',  uri: liffUrl_('appt') }),
      area(2, 0, { type: 'uri', label: 'ความคืบหน้า',   uri: liffUrl_('progress') })
    ]
  };
}

function setupRichMenu() {
  // 1) สร้าง rich menu
  var createRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify(richMenuObject_()),
    muteHttpExceptions: true
  });
  Logger.log('create: ' + createRes.getContentText());
  var richMenuId = JSON.parse(createRes.getContentText()).richMenuId;
  if (!richMenuId) { Logger.log('สร้างไม่สำเร็จ — เช็ค token/payload'); return; }

  // 2) อัปโหลดรูป (ดึงจาก GitHub Pages)
  var img = UrlFetchApp.fetch(RICHMENU_IMAGE_URL).getBlob();
  var upRes = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/richmenu/' + richMenuId + '/content', {
    method: 'post',
    contentType: img.getContentType() || 'image/png',
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    payload: img.getBytes(),
    muteHttpExceptions: true
  });
  Logger.log('upload: ' + upRes.getResponseCode());

  // 3) ตั้งเป็นเมนูเริ่มต้นของทุกคน
  var setRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/user/all/richmenu/' + richMenuId, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    muteHttpExceptions: true
  });
  Logger.log('set default: ' + setRes.getResponseCode());
  Logger.log('✅ เสร็จ! richMenuId = ' + richMenuId);
}

// ลบ rich menu เดิมทั้งหมด (ใช้ก่อนสร้างใหม่)
function deleteAllRichMenus() {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/list', {
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    muteHttpExceptions: true
  });
  var list = (JSON.parse(res.getContentText()).richmenus) || [];
  list.forEach(function (rm) {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/' + rm.richMenuId, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + LINE_TOKEN },
      muteHttpExceptions: true
    });
    Logger.log('ลบ ' + rm.richMenuId);
  });
  Logger.log('ลบทั้งหมด ' + list.length + ' เมนู');
}
