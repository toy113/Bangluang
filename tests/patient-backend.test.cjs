const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=require('node:path').join(__dirname,'..');
const user='U'+'a'.repeat(32),otherUser='U'+'b'.repeat(32);
function fixture(){
 const sheets={คนไข้:[{hn:'62-0001',name:'Fixture One',phone:'0812345678'},{hn:'62-0002',name:'Fixture Two',phone:'0899999999'}],line_patient_links:[]};
 const props=new Map([['PATIENT_LINE_CHANNEL_ID','test-channel']]),cache=new Map();
 const context={Date,console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,v)=>[...crypto.createHash('sha256').update(v).digest()],formatDate:()=> '2026-10-29'},SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>sheets[n]?{}:null})},orthoNormHN_:v=>String(v??'').trim().replace(/\s+/g,'').toUpperCase(),orthoSheetToObjects_:n=>sheets[n]||[],orthoGetSheet_:n=>({appendRow:r=>(sheets[n]??=[]).push({lineUserId:r[0],hn:r[1],linkedAt:r[2]})}),orthoJsonOut_:v=>v};
 let verified={client_id:'test-channel',scope:'profile',expires_in:3600};
 context.UrlFetchApp={fetch:(url,options)=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.includes('/verify?')?verified:{userId:user})})};
 vm.createContext(context);vm.runInContext(fs.readFileSync(root+'/patient-backend.gs','utf8'),context);
 return {c:context,sheets,props,cache,setVerified:v=>verified=v};
}
test('all Apps Script and frontend scripts parse',()=>{
 for(const file of fs.readdirSync(root).filter(f=>/\.(gs|js)$/.test(f))) new vm.Script(fs.readFileSync(root+'/'+file,'utf8'),{filename:file});
});
test('verify LINE channel, expiry and profile scope; fail closed without configuration',()=>{
 const {c,props,setVerified}=fixture();assert.equal(c.patientVerifyLine_('valid'),user);
 for(const data of [{client_id:'wrong',scope:'profile',expires_in:60},{client_id:'test-channel',scope:'profile',expires_in:0},{client_id:'test-channel',scope:'openid',expires_in:60}]){
  setVerified(data);assert.throws(()=>c.patientVerifyLine_('valid'),/unauthorized/);
 }
 assert.throws(()=>c.patientVerifyLine_(''),/unauthorized/);props.clear();assert.throws(()=>c.patientVerifyLine_('valid'),/config_missing/);
});
test('binding requires matching HN and registered phone',()=>{
 const {c,sheets}=fixture();
 assert.equal(c.patientBind_(user,{hn:'62-0001',phone:'0899999999'}).ok,false);
 assert.equal(c.patientBind_(user,{hn:'62-0001',phone:'+66812345678'}).ok,true);
 assert.equal(sheets.line_patient_links.length,1);
 assert.equal(c.patientBind_(otherUser,{hn:'62-0001',phone:'0812345678'}).ok,false);
});
test('excessive guesses are limited by LINE user and HN',()=>{
 const {c}=fixture();
 for(let i=0;i<5;i++) c.patientBind_(user,{hn:'62-0001',phone:'0899999999'});
 assert.equal(c.patientBind_(user,{hn:'62-0001',phone:'0812345678'}).error,'too_many_attempts');
 assert.equal(c.patientBind_(otherUser,{hn:'62-0001',phone:'0812345678'}).error,'too_many_attempts');
});
test('cannot replace another LINE binding or link a second HN',()=>{
 const {c,sheets}=fixture();sheets.line_patient_links.push({lineUserId:otherUser,hn:'62-0001'});
 assert.equal(c.patientBind_(user,{hn:'62-0001',phone:'0812345678'}).error,'already_linked');
 sheets.line_patient_links[0].lineUserId=user;
 assert.equal(c.patientBind_(user,{hn:'62-0002',phone:'0899999999'}).error,'already_linked');
});
test('patientGet ignores a forged HN/userId and returns an allowlist for the verified binding',()=>{
 const {c,sheets}=fixture();sheets.line_patient_links.push({lineUserId:user,hn:'62-0001'});
 sheets['บันทึกการรักษา']=[{hn:'62-0001',date:'2026-10-01',proc:'ตรวจฟัน',note:'PRIVATE',cash:900},{hn:'62-0002',date:'2026-10-02',proc:'OTHER PATIENT'}];
 const out=c.patientRoutePost_({postData:{contents:JSON.stringify({action:'patientGet',accessToken:'valid',hn:'62-0002',lineUserId:otherUser})}});
 assert.equal(out.patient.hn,'62-0001');assert.equal(out.history.length,1);
 const text=JSON.stringify(out);assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('OTHER PATIENT'));assert.ok(!text.includes('cash'));
 assert.equal(c.patientGet_(otherUser).bound,false);
 assert.equal(c.patientRouteGet_({parameter:{action:'patientGet',lineUserId:user}}).error,'post_required');
});
test('counts actual adjustment days, separates loose events, filters and sorts next appointments',()=>{
 const {c}=fixture();const hn='62-0001';
 const data=c.patientData_(hn,{name:'Fixture One'},[
  {hn,date:'2026-10-28',time:'09:00'}, {hn,date:'2026-11-01',time:'09:00',status:'ยกเลิก'},
  {hn,date:'2026-11-02',time:'09:00',proc:'ตรวจ'}, {hn:'62-0002',date:'2026-10-29',time:'08:00'}
 ],[],[{hn,'วันเริ่ม':'2026-01-01','นัดถัดไป':'2026-10-30','นัดถัดไปเวลา':'13:00'}],[
  {hn,'วันที่':'2026-01-01','ทำอะไร':'ติดเครื่องมือ'},
  {hn,'วันที่':'2026-02-01','ทำอะไร':'ปรับเครื่องมือ'}, {hn,'วันที่':'2026-02-01','ทำอะไร':'ปรับเครื่องมือ, เปลี่ยนยาง'},
  {hn,'วันที่':'2026-03-01','ทำอะไร':'เครื่องมือหลุด'}, {hn,'วันที่':'2026-04-01','ทำอะไร':'ปรับเครื่องมือ, เครื่องมือหลุด'},
  {hn:'62-0002','วันที่':'2026-05-01','ทำอะไร':'ปรับเครื่องมือ'},
  {hn,'วันที่':'2027-01-01','ทำอะไร':'ปรับเครื่องมือ'}
 ],'2026-10-29');
 assert.equal(data.ortho.adjustmentCount,2);assert.equal(data.ortho.looseCount,2);assert.equal(data.nextAppointment.date,'2026-10-30');assert.equal(data.appointments.length,2);
 const general=c.patientData_(hn,{name:'General'},[],[],[],[],'2026-10-29');assert.equal(general.ortho,null);assert.equal(general.nextAppointment,null);
});
test('rich menu covers all pixels, uses three LIFF routes, and has no embedded access token',()=>{
 const props=new Map([['PATIENT_LIFF_ID','test-liff']]);const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'/richmenu-setup.gs','utf8'),ctx);
 const menu=ctx.richMenuObject_();assert.equal(menu.areas.reduce((n,a)=>n+a.bounds.width,0),2500);
 for(const [i,v] of ['appt','history','ortho'].entries()){assert.ok(menu.areas[i].action.uri.endsWith('?view='+v));assert.equal(menu.areas[i].bounds.height,843);}
 assert.throws(()=>ctx.patientMenuToken_(),/Set LINE_CHANNEL_ACCESS_TOKEN/);
});
test('spreadsheet time cells keep HH:mm for both general and ortho appointments',()=>{
 const date=new Date('2026-11-05T07:30:00Z');
 const ctx={Date,ORTHO_TZ:'Asia/Bangkok',Utilities:{formatDate:(_,tz,format)=>format==='HH:mm'?'14:30':'2026-11-05'},SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>[['date','time','นัดถัดไปเวลา'],[date,date,date]]})})})}};
 const source=fs.readFileSync(root+'/ortho-backend.gs','utf8');
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function orthoSheetToObjects_('),source.indexOf('/* ===================== SETUP')),ctx);
 const row=ctx.orthoSheetToObjects_('ตารางนัด')[0];assert.equal(row.date,'2026-11-05');assert.equal(row.time,'14:30');assert.equal(row['นัดถัดไปเวลา'],'14:30');
});
test('setup from the Apps Script editor tolerates an unavailable spreadsheet UI',()=>{
 const {c}=fixture();let note='';c.Logger={log:message=>note=message};
 assert.doesNotThrow(()=>c.setupPatientPortal());assert.ok(note.includes('กรุณาเปิดชีตใหม่'));
});
