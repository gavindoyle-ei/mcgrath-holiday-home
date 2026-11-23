const {JSDOM}=require('jsdom');const fs=require('fs');
let html=fs.readFileSync(require('path').join(__dirname,'..','docs','index.html'),'utf8');
html=html.replace(/<script src="[^"]+"><\/script>/g,'');
const cfg="self.CFG={NAME:'T',API:'x',VAPID:'v',FIREBASE:{}};";
const st=(role)=>({me:{email:'a@b.c',name:'Gav',role,familyId:'f1',familyName:'Fam One'},today:'2026-11-22',appName:'McGrath Holiday Home',
 properties:[{id:'p1',name:'Beach',color:'#1f7a8c',notes:''},{id:'p2',name:'Mountain',color:'#c9822b',notes:''}],
 families:[{id:'f1',name:'Fam One'},{id:'f2',name:'Fam Two'}],
 members:[{email:'a@b.c',name:'Gav',familyId:'f1',role:'admin',push:true},{email:'d@e.f',name:'Dee',familyId:'f2',role:'member',push:false}],
 bookings:[{id:'b1',propertyId:'p1',familyId:'f1',familyName:'Fam One',start:'2026-12-20',end:'2026-12-27',status:'approved',mine:true,by:'Gav',guests:'4',note:'xmas <b>',adminNote:''},
 {id:'b2',propertyId:'p1',familyId:'f2',familyName:'Fam Two',start:'2026-12-25',end:'2026-12-30',status:'pending',mine:false,by:'Dee',guests:'2',note:'',adminNote:''}]});
for(const role of ['admin','member']){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://x.github.io/r/'});
 const w=dom.window; w.localStorage.setItem('hh_token','t');
 w.fetch=async()=>({json:async()=>({ok:true,state:st(role)})});
 w.matchMedia=()=>({matches:false});
 w.eval(cfg); w.eval(dom.window.document.querySelectorAll('script')[0].textContent.replace(/^const S =/m,'var S =').replace(/^const A =/m,'var A =').replace('const CFG = self.CFG;','var CFG = self.CFG;'));w.scrollTo=()=>{};
 setTimeout(()=>{
  const app=w.document.getElementById('app');
  const out=[];
  const views=role==='admin'?[['home'],['request'],['family'],['admin','requests'],['admin','bookings'],['admin','families'],['admin','props']]:[['home'],['request'],['family']];
  for(const [v,s] of views){ w.eval(`S.view='${v}';${s?`S.sub='${s}';`:''}render()`); out.push(v+(s?'/'+s:'')+':'+app.innerHTML.length); }
  w.eval(`S.mode='list';S.view='home';render()`); out.push('list:'+app.innerHTML.length);
  w.eval(`S.mode='cal';S.day='2026-12-26';render()`); out.push('day has Fam Two: '+app.innerHTML.includes('Fam Two'));
  w.eval(`S.view='request';S.form={pid:'p1',start:'2026-12-22',end:'2026-12-24'};render()`); out.push('clash hint: '+app.innerHTML.includes('Overlaps an approved'));
  out.push('xss escaped: '+(!app.innerHTML.includes('<b>"')));
  console.log(role,out.join(' | '));
 },200);
}
