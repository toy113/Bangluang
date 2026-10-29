// Bangluang Dental patient rich menu. Tokens are server-side Script Properties only.
// Set LINE_CHANNEL_ACCESS_TOKEN (new token), PATIENT_LIFF_ID before running.
function patientMenuToken_() {
  var token=PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if(!token) throw new Error('Set LINE_CHANNEL_ACCESS_TOKEN in Script Properties');
  return token;
}
function patientMenuRequest_(path,options,dataHost) {
  var opts=options || {};
  opts.headers={Authorization:'Bearer '+patientMenuToken_()};
  opts.muteHttpExceptions=true;
  var res=UrlFetchApp.fetch((dataHost ? 'https://api-data.line.me' : 'https://api.line.me')+path,opts);
  if(res.getResponseCode()<200 || res.getResponseCode()>=300) {
    var error=new Error('LINE request failed: HTTP '+res.getResponseCode()); error.httpStatus=res.getResponseCode(); throw error;
  }
  var text=res.getContentText();
  return text ? JSON.parse(text) : {};
}
function richMenuObject_() {
  var id=PropertiesService.getScriptProperties().getProperty('PATIENT_LIFF_ID');
  if(!id) throw new Error('Set PATIENT_LIFF_ID in Script Properties');
  var labels=['นัดครั้งต่อไป','ประวัติรักษา','ข้อมูลจัดฟัน'],views=['appt','history','ortho'],edges=[0,833,1666,2500];
  return {size:{width:2500,height:843},selected:true,name:'Bangluang patient portal',chatBarText:'เมนูคนไข้',areas:views.map(function(view,i){
    return {bounds:{x:edges[i],y:0,width:edges[i+1]-edges[i],height:843},action:{type:'uri',label:labels[i],uri:'https://liff.line.me/'+id+'?view='+view}};
  })};
}
// Create and upload only: the existing menu stays active until activatePatientRichMenu.
function preparePatientRichMenu() {
  var props=PropertiesService.getScriptProperties(),menu=richMenuObject_();
  patientMenuRequest_('/v2/bot/richmenu/validate',{method:'post',contentType:'application/json',payload:JSON.stringify(menu)});
  var imageUrl=props.getProperty('PATIENT_RICHMENU_IMAGE_URL') || 'https://toy113.github.io/Bangluang/richmenu-patient.png';
  var image=UrlFetchApp.fetch(imageUrl);
  if(image.getResponseCode()!==200) throw new Error('Rich menu image is unavailable');
  var blob=image.getBlob(),bytes=blob.getBytes();
  if(bytes.length>1000000) throw new Error('Rich menu PNG must be under 1 MB');
  var created=patientMenuRequest_('/v2/bot/richmenu',{method:'post',contentType:'application/json',payload:JSON.stringify(menu)});
  if(!created.richMenuId) throw new Error('No rich menu ID returned');
  patientMenuRequest_('/v2/bot/richmenu/'+created.richMenuId+'/content',{method:'post',contentType:'image/png',payload:bytes},true);
  patientMenuRequest_('/v2/bot/richmenu/'+created.richMenuId);
  props.setProperty('PATIENT_PENDING_RICHMENU',created.richMenuId);
  Logger.log('Prepared menu: '+created.richMenuId+' (not active)');
  return created.richMenuId;
}
function activatePatientRichMenu() {
  var props=PropertiesService.getScriptProperties(),id=props.getProperty('PATIENT_PENDING_RICHMENU');
  if(!id) throw new Error('Run preparePatientRichMenu first');
  var old={};
  try {old=patientMenuRequest_('/v2/bot/user/all/richmenu');} catch(err) {if(err.httpStatus!==404) throw err;}
  if(old.richMenuId===id) {Logger.log('Patient menu is already active'); return;}
  props.setProperty('PATIENT_PREVIOUS_RICHMENU',old.richMenuId || '__none__');
  patientMenuRequest_('/v2/bot/user/all/richmenu/'+id,{method:'post'});
  var active=patientMenuRequest_('/v2/bot/user/all/richmenu');
  if(active.richMenuId!==id) throw new Error('Default menu verification failed');
  Logger.log('Active patient menu: '+id);
}
function rollbackPatientRichMenu() {
  var id=PropertiesService.getScriptProperties().getProperty('PATIENT_PREVIOUS_RICHMENU');
  if(!id) throw new Error('No previous default menu saved');
  if(id==='__none__') patientMenuRequest_('/v2/bot/user/all/richmenu',{method:'delete'});
  else patientMenuRequest_('/v2/bot/user/all/richmenu/'+id,{method:'post'});
}
function setupRichMenu() { return preparePatientRichMenu(); }
