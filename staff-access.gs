// Staff API gate. The clinic owner runs setupStaffAccess() from the Sheet editor.
// The generated key is shown once and must never be committed to this repository.
function setupStaffAccess() {
  var key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toUpperCase();
  PropertiesService.getScriptProperties().setProperty('STAFF_API_KEY_HASH', patientHash_(key));
  SpreadsheetApp.getUi().alert('รหัสเจ้าหน้าที่ใหม่ (คัดลอกเก็บไว้):\n' + key + '\n\nรหัสนี้ใช้เข้าหน้าโปรแกรมและไม่แสดงอีก');
}
function staffAuthorized_(body) {
  var stored = PropertiesService.getScriptProperties().getProperty('STAFF_API_KEY_HASH');
  var key = body && body.staffKey;
  if (!stored || typeof key !== 'string' || !/^[A-F0-9]{64}$/i.test(key)) return false;
  var actual = patientHash_(key.toUpperCase());
  var diff = 0;
  for (var i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ actual.charCodeAt(i);
  return stored.length === actual.length && diff === 0;
}
function staffDenied_() {
  return ContentService.createTextOutput(JSON.stringify({ok:false,error:'staff_unauthorized'}))
    .setMimeType(ContentService.MimeType.JSON);
}
