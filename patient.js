'use strict';
const el = id => document.getElementById(id);
const safe = value => String(value == null ? '' : value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let patientBusy = false;
function patientDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'ยังไม่ระบุวันที่';
  const date=new Date(value+'T12:00:00+07:00');
  return isNaN(date) ? 'ยังไม่ระบุวันที่' : new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(date);
}
function patientShow(view) {
  ['status','bindView','errorView','dataView'].forEach(id=>el(id).classList.toggle('hidden',id!==view));
}
function patientView() {
  const raw=location.hash.replace('#','') || new URLSearchParams(location.search).get('view') || 'appt';
  const view=({progress:'ortho',log:'history'})[raw] || raw;
  const selected=['appt','history','ortho'].includes(view) ? view : 'appt';
  document.querySelectorAll('[data-view]').forEach(button=>{
    if(button.dataset.view===selected) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  ['appt','history','ortho'].forEach(name=>el('panel-'+name).classList.toggle('hidden',name!==selected));
}
async function patientRequest(action, fields={}) {
  const token=liff.getAccessToken();
  if(!token) throw new Error('unauthorized');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try {
    // text/plain is a CORS simple request; no token, phone or HN in the URL/history.
    const res=await fetch(window.PATIENT_CONFIG.api,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({...fields,action,accessToken:token}),redirect:'follow',cache:'no-store',credentials:'omit',signal:controller.signal});
    if(!res.ok) throw new Error('network');
    const data=await res.json();
    if(!data || typeof data.ok!=='boolean') throw new Error('invalid_response');
    return data;
  } finally {clearTimeout(timer);}
}
function patientError(message) {el('errorText').textContent=message;patientShow('errorView');}
function appointmentMarkup(a,first) {
  return '<article class="card '+(first?'appointment':'')+'">'+(first?'<span class="badge">นัดที่ใกล้ที่สุด</span>':'<h3>นัดหมายถัดไป</h3>')+'<div class="appointment-date">'+safe(patientDate(a.date))+'</div><div class="appointment-time">'+safe(a.time || 'รอยืนยันเวลา')+(a.time?' <small>น.</small>':'')+'</div><dl class="details"><div><dt>รายการนัด</dt><dd>'+safe(a.procedure || 'ติดต่อคลินิกเพื่อสอบถาม')+'</dd></div><div><dt>ทันตแพทย์</dt><dd>'+safe(a.doctor || 'รอยืนยัน')+'</dd></div></dl></article>';
}
function historyMarkup(rows) {
  return rows.map(r=>'<article class="history-item"><time datetime="'+safe(r.date)+'">'+safe(patientDate(r.date))+'</time><h3>'+safe(r.procedure || 'รายการรักษา')+'</h3><p>'+safe(r.doctor || '')+'</p>'+(r.wire?'<p>ลวด '+safe(r.wire)+'</p>':'')+(r.elastic?'<p>ยาง '+safe(r.elastic)+'</p>':'')+'</article>').join('');
}
function emptyMarkup(title,message) {return '<div class="card empty"><h3>'+safe(title)+'</h3><p>'+safe(message)+'</p></div>';}
function renderPatient(data) {
  el('patientName').textContent='คุณ'+(data.patient.name || 'คนไข้');
  el('patientMeta').textContent='HN '+data.patient.hn+' · คลินิกทันตกรรมบางหลวง';
  const appointments=data.appointments || [];
  el('nextAppointment').innerHTML=data.nextAppointment ? appointmentMarkup(data.nextAppointment,true) : emptyMarkup('ยังไม่มีนัดครั้งถัดไป','ติดต่อคลินิกเพื่อตรวจสอบหรือนัดหมาย');
  el('otherAppointments').innerHTML=appointments.slice(1).map(a=>appointmentMarkup(a,false)).join('');
  el('historyList').innerHTML=(data.history || []).length ? historyMarkup(data.history) : emptyMarkup('ยังไม่มีประวัติรายการรักษา','จะแสดงเมื่อคลินิกบันทึกข้อมูลการรักษา');
  const o=data.ortho;
  el('orthoContent').innerHTML=o ? '<div class="card"><span class="badge">'+safe(o.status || 'ข้อมูลจัดฟัน')+'</span><h3>'+safe(o.type || 'การจัดฟัน')+'</h3><dl class="details"><div><dt>วันติดเครื่องมือ</dt><dd>'+safe(patientDate(o.startDate))+'</dd></div><div><dt>ทันตแพทย์</dt><dd>'+safe(o.doctor || 'ยังไม่ระบุ')+'</dd></div></dl></div><div class="stats"><div class="stat"><strong>'+safe(o.adjustmentCount)+'</strong><span>ครั้งที่ปรับเครื่องมือ</span></div><div class="stat"><strong>'+safe(o.looseCount)+'</strong><span>ครั้งที่เครื่องมือหลุด</span></div></div><p class="field-help">นับการปรับเครื่องมือจากวันที่มาปรับจริง (วันเดียวกันนับ 1 ครั้ง) และนับเครื่องมือหลุดจากรายการที่คลินิกบันทึก</p><h3>ประวัติจัดฟัน</h3>'+((o.logs || []).length ? historyMarkup(o.logs) : emptyMarkup('ยังไม่มีบันทึกจัดฟัน','กรุณาสอบถามคลินิกหากข้อมูลยังไม่ครบ')) : emptyMarkup('ยังไม่มีข้อมูลจัดฟันในระบบ','คุณยังดูนัดหมายและประวัติรักษาได้ตามปกติ');
  el('updatedAt').textContent='อัปเดตล่าสุด '+new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(data.updatedAt));
  patientView();patientShow('dataView');
}
async function loadPatient() {
  if(patientBusy) return;
  patientBusy=true;el('refreshButton').disabled=true;el('status').textContent='กำลังโหลดข้อมูลของคุณ…';patientShow('status');
  try {
    const data=await patientRequest('patientGet');
    if(!data.ok) throw new Error(data.error);
    if(data.bound) renderPatient(data); else patientShow('bindView');
  } catch(err) {
    patientError(err.message==='unauthorized' ? 'การเข้าสู่ระบบหมดอายุ กรุณาปิดหน้านี้แล้วเปิดจากเมนู LINE ใหม่' : 'เชื่อมต่อข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง หากยังมีปัญหาให้ติดต่อคลินิก');
  } finally {patientBusy=false;el('refreshButton').disabled=false;}
}
async function bindPatient(event) {
  event.preventDefault();if(patientBusy) return;
  const hn=el('bindHn').value.trim(),phone=el('bindPhone').value.replace(/[^\d+]/g,''),code=el('bindCode').value.trim().toUpperCase();
  el('bindError').classList.add('hidden');
  if(!hn || !/^(?:0\d{8,9}|\+?66\d{9})$/.test(phone) || !/^[A-F0-9]{12}$/.test(code)) {
    el('bindError').textContent='กรุณาตรวจสอบ HN เบอร์โทร และรหัสยืนยัน 12 ตัวอักษร';el('bindError').classList.remove('hidden');return;
  }
  patientBusy=true;el('bindButton').disabled=true;el('bindButton').textContent='กำลังยืนยันตัวตน…';
  let bound=false;
  try {
    const data=await patientRequest('patientBind',{hn,phone,code});
    if(!data.ok) throw new Error(data.error);
    bound=true;el('bindForm').reset();
  } catch(err) {
    el('bindError').textContent=err.message==='too_many_attempts'?'ลองหลายครั้งเกินไป กรุณารอ 15 นาที หรือติดต่อคลินิก':err.message==='already_linked'?'บัญชีนี้มีการผูกข้อมูลอยู่แล้ว กรุณาให้คลินิกตรวจสอบก่อนเปลี่ยนบัญชี':'ยืนยันไม่สำเร็จ กรุณาตรวจสอบข้อมูลและรหัสที่ยังไม่หมดอายุ หรือติดต่อคลินิก';el('bindError').classList.remove('hidden');
  } finally {patientBusy=false;el('bindButton').disabled=false;el('bindButton').textContent='เชื่อมบัญชีและดูข้อมูล';}
  if(bound) await loadPatient();
}
async function bootPatient() {
  try {
    if(!window.PATIENT_CONFIG || !PATIENT_CONFIG.liffId || !PATIENT_CONFIG.api) throw new Error('config');
    await liff.init({liffId:PATIENT_CONFIG.liffId});
    if(!liff.isLoggedIn()) {liff.login({redirectUri:location.href});return;}
    await loadPatient();
  } catch(_) {patientError('ยังเชื่อมต่อ LINE ไม่สำเร็จ กรุณาเปิดจากเมนูใน LINE ของคลินิก แล้วลองอีกครั้ง');}
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{location.hash=button.dataset.view;patientView();}));
window.addEventListener('hashchange',patientView);
el('bindForm').addEventListener('submit',bindPatient);
el('refreshButton').addEventListener('click',loadPatient);
el('retryButton').addEventListener('click',bootPatient);
bootPatient();
