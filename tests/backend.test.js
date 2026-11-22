const fs=require('fs'),crypto=require('crypto'),vm=require('vm');
const sheets={}; const props={SS_ID:'x',SECRET:'s3cret'}; const cache={}; const mails=[];
const driveFiles={}; const driveFolders={}; let driveSeq=0;
const mkFolder=name=>({n:name,createFile:blob=>{const id='drive'+(++driveSeq);const file={getId:()=>id,setSharing:()=>file,setTrashed:t=>{file.trashed=!!t}};driveFiles[id]=file;return file;}});
const DriveApp={Access:{ANYONE_WITH_LINK:'anyone'},Permission:{VIEW:'view'},
 getFoldersByName:name=>{const arr=driveFolders[name]?[driveFolders[name]]:[];let i=0;return {hasNext:()=>i<arr.length,next:()=>arr[i++]};},
 createFolder:name=>{const f=mkFolder(name);driveFolders[name]=f;return f;},
 getFileById:id=>{if(!driveFiles[id])throw new Error('not found');return driveFiles[id];}};
const mkSheet=n=>({n,data:[],getDataRange:()=>({getValues:()=>JSON.parse(JSON.stringify(sheets[n].data))}),
 getRange:(r,c,nr,nc)=>{const o={setNumberFormat:()=>o,setFontWeight:()=>o,setValues:v=>{for(let i=0;i<nr;i++){sheets[n].data[r-1+i]=v[i]}return o}};return o},
 getLastRow:()=>sheets[n].data.length,getMaxRows:()=>1000,setFrozenRows(){},
 deleteRow:r=>{sheets[n].data.splice(r-1,1)}});
const ctx={console,Session:{getScriptTimeZone:()=>'Europe/Dublin'},
 SpreadsheetApp:{getActive:()=>({getId:()=>'x',getSheetByName:n=>sheets[n]||null,insertSheet:n=>sheets[n]=mkSheet(n),getSheets:()=>Object.values(sheets),deleteSheet(){}}),openById:()=>({getSheetByName:n=>sheets[n]})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>cache[k]=v,remove:k=>delete cache[k]})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 MailApp:{sendEmail:m=>mails.push(m)},UrlFetchApp:{},DriveApp,
 ContentService:{createTextOutput:t=>({setMimeType(){return t}}),MimeType:{JSON:1}},
 Logger:{log(){}},
 Utilities:{getUuid:()=>crypto.randomUUID(),base64EncodeWebSafe:x=>(Buffer.isBuffer(x)||Array.isArray(x)?Buffer.from(x):Buffer.from(x)).toString('base64url')+'==',
  base64DecodeWebSafe:s=>[...Buffer.from(s.replace(/=+$/,''),'base64url')],
  base64Decode:s=>[...Buffer.from(s,'base64')],
  newBlob:(b,mime,name)=>({getDataAsString:()=>Buffer.from(b).toString(),getBytes:()=>b,getContentType:()=>mime,getName:()=>name}),
  computeHmacSha256Signature:(s,k)=>[...crypto.createHmac('sha256',k).update(s).digest()],
  formatDate:(d,tz,f)=>f==='yyyy-MM-dd'?new Date(d).toISOString().slice(0,10):new Date(d).toDateString()}};
vm.createContext(ctx);
let code=fs.readFileSync('' + require('path').join(__dirname,'..','Code.gs') + '','utf8')
 .replace(/const ADMIN_EMAIL = '[^']*'/,"const ADMIN_EMAIL = 'gav@x.ie'");
vm.runInContext(code+';this.setup=setup;this.doPost=doPost;',ctx);
ctx.setup();
const call=b=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}));
(async()=>{
 const ok=(n,c)=>console.log((c?'PASS ':'FAIL ')+n);
 call({action:'requestCode',email:'GAV@x.ie'});
 const code=mails[0].subject.match(/\d{6}/)[0];
 ok('code emailed',!!code);
 ok('bad code rejected',call({action:'verifyCode',email:'gav@x.ie',code:'000000'}).ok===false);
 const v=call({action:'verifyCode',email:'gav@x.ie',code}); ok('verify ok',v.ok&&v.token);
 const t=v.token;
 let s=call({action:'init',token:t}).state; ok('init admin',s.me.role==='admin'&&s.properties.length===2);
 ok('bad token',call({action:'init',token:t+'x'}).error==='unauthorized');
 const p=s.properties[0].id, f=s.me.familyId;
 ok('add family',call({action:'addFamily',token:t,name:'Cousins'}).ok);
 s=call({action:'init',token:t}).state; const f2=s.families.find(x=>x.name==='Cousins').id;
 ok('add member + welcome mail',call({action:'addMember',token:t,familyId:f2,name:'Dee',email:'dee@x.ie',role:'member'}).ok&&mails.some(m=>/Welcome/.test(m.subject)));
 // member login
 call({action:'requestCode',email:'dee@x.ie'}); cache['rl:dee@x.ie']=null;
 const c2=mails.filter(m=>/sign-in code/.test(m.subject)).pop().subject.match(/\d{6}/)[0];
 const t2=call({action:'verifyCode',email:'dee@x.ie',code:c2}).token;
 const d=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
 const r=call({action:'requestStay',token:t2,propertyId:p,start:d(10),end:d(15),guests:'3'}); ok('member request',r.ok);
 ok('admin got alert mail',mails.some(m=>/New stay request/.test(m.subject)&&m.to.includes('gav@x.ie')));
 ok('member cannot book for other family',call({action:'requestStay',token:t2,propertyId:p,start:d(30),end:d(32),familyId:f}).ok===false);
 ok('member cannot approve',call({action:'decide',token:t2,id:'x',decision:'approve'}).ok===false);
 ok('member cannot add family',call({action:'addFamily',token:t2,name:'Z'}).ok===false);
 s=call({action:'init',token:t}).state; const bid=s.bookings[0].id;
 ok('approve',call({action:'decide',token:t,id:bid,decision:'approve',note:'Enjoy'}).ok);
 const decisionMail=mails.find(m=>/^Stay approved/.test(m.subject));
 ok('decision mail reply-to is deciding admin',!!decisionMail&&decisionMail.replyTo==='gav@x.ie');
 ok('decision mail names deciding admin',/Admin/.test(decisionMail.htmlBody));
 ok('overlap blocked',/overlap/i.test(call({action:'requestStay',token:t,propertyId:p,start:d(12),end:d(14)}).error||''));
 ok('approval mail to requester',mails.some(m=>/approved/i.test(m.subject)&&m.to.includes('dee@x.ie')));
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
 ok('member cannot save property',call({action:'saveProperty',token:t2,id:p,name:'Nope'}).ok===false);
 ok('save address',call({action:'saveProperty',token:t,id:p,name:'Beach House',color:'#1f7a8c',address:'1 Strand Rd'}).ok);
 s=call({action:'init',token:t}).state; ok('address stored',s.properties.find(x=>x.id===p).address==='1 Strand Rd');
 ok('save photo',call({action:'saveProperty',token:t,id:p,name:'Beach House',color:'#1f7a8c',photoData:'data:image/png;base64,'+png}).ok);
 s=call({action:'init',token:t}).state; const pr1=s.properties.find(x=>x.id===p);
 ok('photo url set',/drive\.google\.com/.test(pr1.photo));
 const oldFileId=sheets.Properties.data.find(r=>r[0]===p)[6];
 ok('save new photo trashes old file',call({action:'saveProperty',token:t,id:p,name:'Beach House',color:'#1f7a8c',photoData:'data:image/png;base64,'+png}).ok&&driveFiles[oldFileId].trashed===true);
 ok('remove photo',call({action:'saveProperty',token:t,id:p,name:'Beach House',color:'#1f7a8c',removePhoto:true}).ok);
 s=call({action:'init',token:t}).state; ok('photo cleared',s.properties.find(x=>x.id===p).photo==='');
 const o=call({action:'init',token:t2}).state; ok('member sees only own details',o.bookings[0].guests==='3'&&o.families.length===1);
 ok('cannot remove last admin',call({action:'setRole',token:t,email:'gav@x.ie',role:'member'}).ok===false);
 ok('remove member kills session',call({action:'removeMember',token:t,email:'dee@x.ie'}).ok&&call({action:'init',token:t2}).error==='unauthorized');
 ok('date text preserved',typeof sheets.Bookings.data[1][4]==='string');
})();
