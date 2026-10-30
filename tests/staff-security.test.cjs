const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('all inline admin scripts parse after request migration',()=>{
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){
    if(match[1].trim()) new vm.Script(match[1]);
  }
  for(const file of ['Code.gs','staff-access.gs','patient-backend.gs','ortho-backend.gs'])
    new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
});

function runtime(){
  const key='A'.repeat(64);
  let staffHash='hash:'+key, webhookCalls=0, sheetCalls=0;
  const scope={
    ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return {text,setMimeType(){return this}}}},
    PropertiesService:{getScriptProperties(){return {getProperty(k){return k==='STAFF_API_KEY_HASH'?staffHash:null}}}},
    patientHash_(value){return 'hash:'+value},
    patientRoutePost_(){return null},patientRouteGet_(){return null},
    orthoRoutePost_(e){const b=JSON.parse(e.postData.contents);if(b.events){webhookCalls++;return {text:'OK'}}return null},
    orthoRouteGet_(){return null},
    SpreadsheetApp:{getActiveSpreadsheet(){sheetCalls++;return {getSheetByName(){return null}}}}
  };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(root,'staff-access.gs'),'utf8'),scope);
  vm.runInContext(fs.readFileSync(path.join(root,'Code.gs'),'utf8'),scope);
  return {scope,key,counts(){return {webhookCalls,sheetCalls}}};
}

test('legacy GET and unauthenticated POST cannot read clinic sheets',()=>{
  const r=runtime();
  assert.equal(JSON.parse(r.scope.doGet({parameter:{action:'getAll'}}).text).error,'staff_unauthorized');
  assert.equal(JSON.parse(r.scope.doPost({postData:{contents:JSON.stringify({action:'getAll'})}}).text).error,'staff_unauthorized');
  assert.equal(JSON.parse(r.scope.doPost({postData:{contents:JSON.stringify({type:'patients',data:{hn:'X'}})}}).text).error,'staff_unauthorized');
  assert.deepEqual(r.counts(),{webhookCalls:0,sheetCalls:0});
});

test('valid staff key permits read while preserving LINE webhook route',()=>{
  const r=runtime();
  assert.equal(JSON.parse(r.scope.doPost({postData:{contents:JSON.stringify({action:'staffPing',staffKey:r.key})}}).text).ok,true);
  const rows=JSON.parse(r.scope.doPost({postData:{contents:JSON.stringify({action:'getAll',staffKey:r.key})}}).text);
  assert.deepEqual(Object.keys(rows),['appointments','treatments','labs','settings','patients','day_notes','sch_slots','recall']);
  assert.equal(r.scope.doPost({postData:{contents:'{"events":[]}'}}).text,'OK');
  assert.deepEqual(r.counts(),{webhookCalls:1,sheetCalls:1});
});
