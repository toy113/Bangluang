// Run with PLAYWRIGHT_MODULE_PATH set when Playwright isn't installed locally.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const fixture={ok:true,bound:true,patient:{name:'คนไข้ตัวอย่าง',hn:'DEMO-001'},nextAppointment:{date:'2026-11-05',time:'14:30',procedure:'ปรับเครื่องมือจัดฟัน',doctor:'ทันตแพทย์ตัวอย่าง'},appointments:[],history:[{date:'2026-10-05',procedure:'ตรวจสุขภาพช่องปากและขูดหินปูน',doctor:'ทันตแพทย์ตัวอย่าง'},{date:'2026-09-05',procedure:'ปรับเครื่องมือ',doctor:'ทันตแพทย์ตัวอย่าง'}],ortho:{type:'จัดฟันโลหะ',doctor:'ทันตแพทย์ตัวอย่าง',status:'กำลังจัด',startDate:'2025-03-05',adjustmentCount:18,looseCount:2,logs:[{date:'2026-10-05',procedure:'ปรับเครื่องมือ',doctor:'ทันตแพทย์ตัวอย่าง',wire:'016',elastic:'สีม่วง'}]},updatedAt:'2026-10-29T14:00:00Z'};
fixture.appointments=[fixture.nextAppointment];
const server=http.createServer((req,res)=>{
 const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
 try{res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(fs.readFileSync(file));}catch(_){res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  let response=fixture,requests=[];
  await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url.startsWith(origin+'/')) return route.continue();
   if(url.includes('sdk.js')) return route.fulfill({contentType:'application/javascript',body:'window.liff={init:async()=>{},isLoggedIn:()=>true,getAccessToken:()=>"test-token"};'});
   if(url.includes('script.google.com')){
    const body=JSON.parse(route.request().postData());requests.push(body);
    assert.equal(body.accessToken,'test-token');assert.ok(!url.includes('test-token'));assert.ok(!body.lineUserId);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body.action==='patientBind'?{ok:true}:response)});
   }
   return route.fulfill({status:200,body:'',contentType:'text/css'});
  });
  await page.goto(origin+'/patient.html?view=ortho');
  await page.locator('#orthoContent .stat').first().waitFor();
  assert.ok((await page.locator('#orthoContent').innerText()).includes('18'));
  assert.ok(await page.locator('#panel-ortho').isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(root,'..','patient-ortho-preview.png'),fullPage:true});
  await page.getByRole('button',{name:'นัดครั้งต่อไป',exact:true}).click();
  assert.ok((await page.locator('#nextAppointment').innerText()).includes('14:30'));
  await page.screenshot({path:path.join(root,'..','patient-appointment-preview.png'),fullPage:true});
  await page.getByRole('button',{name:'ประวัติรักษา',exact:true}).click();
  assert.equal(await page.locator('#historyList .history-item').count(),2);
  response={...fixture,history:[{date:'2026-10-01',procedure:'<img src=x onerror=alert(1)>',doctor:'<script>bad</script>'}],ortho:null,nextAppointment:null,appointments:[]};
  await page.getByRole('button',{name:'อัปเดตข้อมูล'}).click();
  await page.locator('#dataView:not(.hidden)').waitFor();
  assert.equal(await page.locator('#historyList img').count(),0);
  assert.ok((await page.locator('#historyList').innerText()).includes('<img'));
  await page.getByRole('button',{name:'ข้อมูลจัดฟัน',exact:true}).click();
  assert.ok((await page.locator('#orthoContent').innerText()).includes('ยังไม่มีข้อมูลจัดฟัน'));
  response={ok:true,bound:false};await page.getByRole('button',{name:'อัปเดตข้อมูล'}).click();
  await page.locator('#bindView:not(.hidden)').waitFor();
  await page.getByLabel('HN / เลขประจำตัวคนไข้').fill('DEMO-001');await page.getByLabel('เบอร์โทรที่ลงทะเบียนกับคลินิก').fill('0812345678');await page.getByLabel('รหัสยืนยันจากคลินิก').fill('ABCDEF123456');
  response=fixture;await page.getByRole('button',{name:'เชื่อมบัญชีและดูข้อมูล',exact:true}).click();await page.locator('#dataView:not(.hidden)').waitFor();
  assert.ok(requests.some(r=>r.action==='patientBind'&&r.hn==='DEMO-001'));
  assert.equal(await page.evaluate(()=>localStorage.length),0);
  response={ok:false,error:'unauthorized'};await page.getByRole('button',{name:'อัปเดตข้อมูล'}).click();await page.locator('#errorView:not(.hidden)').waitFor();
  assert.ok((await page.locator('#errorText').innerText()).includes('หมดอายุ'));
  // Deterministic export from the repo-native vector source, not an edit of existing artwork.
  await page.setViewportSize({width:2500,height:843});await page.goto(origin+'/richmenu-patient.svg');
  await page.screenshot({path:path.join(root,'richmenu-patient.png'),scale:'css'});
  const png=fs.readFileSync(path.join(root,'richmenu-patient.png'));
  assert.ok(png.length<1000000);assert.equal(png.readUInt32BE(16),2500);assert.equal(png.readUInt32BE(20),843);
  console.log('PASS: mobile routing/layout, appointments/history/ortho, HTML escaping, non-ortho empty state, bind/reload flow, expired session, no localStorage, rich menu PNG under 1 MB. Previews use synthetic data only.');
 }finally{await browser.close();server.close();}
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
