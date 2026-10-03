// Test harness: runs the REAL .gs files in a vm with Apps Script shims + synthetic data.
const fs=require('fs'),vm=require('vm'),http=require('http'),path=require('path');
const ROOT='/home/claude/work/Fleet', T='/home/claude/work/test';
const PORT=+process.env.PORT||8123, EMPTY=process.env.EMPTY==='1';
// ---- synthetic data (NOT real) ----
let seed=7; const rnd=()=> (seed=(seed*16807)%2147483647)/2147483647;
const branches=['القاهرة','الجيزة','الإسكندرية','المنصورة','طنطا','أسيوط','الأقصر','بورسعيد','فرع باسم طويل جدا للاختبار العرضي'];
const types=['عنوان خاطئ','العميل لا يرد','رفض الاستلام','تأجيل من العميل','شحنة تالفة','بيانات ناقصة'];
const accounts=['Acc-A','Acc-B','Acc-C','Acc-D','Acc-E'];
const emps=['موظفة ١','موظفة ٢','موظفة ٣','موظفة ٤','موظفة ٥'];
const drivers=['مندوب ١','مندوب ٢','مندوب ٣',''];
const statuses=['تم الحل','تم التسليم','جارى الحل','تم التاكيد','لم يتم الحل','لم يتم التاكيد'];
const rows=[];
if(!EMPTY){
 for(let i=0;i<420;i++){
  const m=[6,7,8][Math.floor(rnd()*3)], d=1+Math.floor(rnd()*28);
  const bi=Math.floor(Math.pow(rnd(),1.6)*branches.length);
  const st = bi===3||bi===5 ? statuses[2+Math.floor(rnd()*4)] : statuses[Math.floor(rnd()*6)];
  rows.push(['SRC'+i,'', new Date(2026,m-1,d,9,30), new Date(2026,m-1,d), 'WB'+(100000+i), accounts[Math.floor(rnd()*5)], drivers[Math.floor(rnd()*4)], branches[bi], types[Math.floor(rnd()*6)], st, i%7===0?'ملاحظة تجريبية طويلة نسبيا لاختبار القص داخل الخلية':'', false,false, emps[Math.floor(rnd()*5)]]);
 }
 rows.push(['X1','',new Date(2026,7,1),'تاريخ خاطئ','WBX','Acc-A','',branches[0],types[0],statuses[0],'',false,false,emps[0]]);
 rows.push(['X2','',new Date(2026,7,1),new Date(2026,7,2),'WBY','Acc-A','',branches[0],types[0],'حالة غريبة','',false,false,emps[0]]);
}
const lists=[['الفروع','أنواع','حالة','Account']];
for(let i=0;i<Math.max(branches.length,types.length,statuses.length,accounts.length);i++) lists.push([branches[i]||'',types[i]||'',statuses[i]||'',accounts[i]||'']);
const mkSheet=(data)=>({getLastRow:()=>data.length,getRange:(r,c,nr,nc)=>({getValues:()=>data.slice(r-1,r-1+nr).map(row=>{const o=[];for(let j=0;j<nc;j++)o.push(row[c-1+j]===undefined?'':row[c-1+j]);return o;})})});
const sheets={'Master Data':mkSheet([[...Array(14)].map(()=>'h'),...rows]),'Lists':mkSheet(lists)};
const cacheStore={};
const ctx={console,Date,JSON,Math,Object,Array,String,Number,RegExp,Error,Set,Map,parseInt,parseFloat,isNaN,
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>sheets[n]||null})},
 CacheService:{getScriptCache:()=>({get:k=>cacheStore[k]||null,put:(k,v)=>{cacheStore[k]=v},remove:k=>{delete cacheStore[k]}})},
 Session:{getScriptTimeZone:()=>'Africa/Cairo'},
 Utilities:{formatDate:(d,tz,f)=>{const p=n=>String(n).padStart(2,'0');return f.replace('yyyy',d.getFullYear()).replace('MM',p(d.getMonth()+1)).replace('dd',p(d.getDate())).replace('HH',p(d.getHours())).replace('mm',p(d.getMinutes()));},base64Encode:b=>Buffer.from(b).toString('base64')},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({s,setMimeType(){return this}})},
 ScriptApp:{getService:()=>({getUrl:()=>'http://localhost:'+PORT+'/exec'})},
 HtmlService:{createHtmlOutput:html=>({getAs:()=>({setName(){return this},getBytes:()=>Buffer.from(html)})}),XFrameOptionsMode:{ALLOWALL:1}}};
vm.createContext(ctx);
for(const f of ['Config','Helpers','Backend','Assets','Reports','Code']){ vm.runInContext(fs.readFileSync(path.join(ROOT,f+'.gs'),'utf8')+'\n;',ctx,{filename:f+'.gs'}); }
// expose const declarations (const in vm script isn't a context property)
vm.runInContext('this.__CONFIG=CONFIG;this.__tokens=RPT_TOKENS_;',ctx);
function renderIndex(){
 let h=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
 const ds=fs.readFileSync(path.join(ROOT,'DesignSystem.html'),'utf8');
 h=h.replace("<?!= include('DesignSystem') ?>",()=>ds);
 h=h.replace("<?!= serverApiUrl ? serverApiUrl : '' ?>",'http://localhost:'+PORT+'/exec');
 h=h.replace("<?!= getLogoDataUri_() ?>",()=>ctx.getLogoDataUri_());
 return h;
}
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://x');
 if(u.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(renderIndex());}
 if(u.pathname==='/exec'){
  const params=Object.fromEntries(u.searchParams); if(process.env.FAIL==='1'){res.writeHead(500);return res.end('x');}
  const out=ctx.doGet({parameter:params});
  res.writeHead(200,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'});return res.end(out.s);
 }
 if(u.pathname==='/raw'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(rows));}
 if(u.pathname==='/chart.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(fs.readFileSync(T+'/chart.umd.js'));}
 if(u.pathname==='/pdf-html'){const f={};const b=ctx.getReportsBundle?ctx.getReportsBundle(f):null;res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(ctx.buildManagementReportHtml_(b,f));}
 res.writeHead(404);res.end();
}).listen(PORT,()=>console.log('listening',PORT));
