/**
 * RDM System v2 — Node.js backend (zero dependencies)
 * Routes: /api/... (public) · /admin/api/... (protected)
 */
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const crypto = require('crypto');

const PORT    = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const PUB_DIR = path.join(__dirname, '..', 'public');
const ADM_DIR = path.join(__dirname, '..', 'admin');

if (!fs.existsSync(path.join(__dirname,'data')))
  fs.mkdirSync(path.join(__dirname,'data'), {recursive:true});

// ── DB ─────────────────────────────────────────────────────────────────────
let db = { datasets:[], users:[], sessions:{}, logs:[], nextDs:1, nextUser:1 };

function loadDB(){
  try { if(fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE,'utf8')); else seed(); }
  catch(e){ seed(); }
}
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }

function seed(){
  db.users = [
    { id:1, name:'Admin KSTU', email:'admin@kstu.kg', role:'admin',
      passwordHash: sha256('admin123'), active:true, created:'2024-01-01T00:00:00Z' },
    { id:2, name:'Researcher A', email:'researcher@kstu.kg', role:'researcher',
      passwordHash: sha256('pass123'), active:true, created:'2024-03-01T00:00:00Z' },
  ];
  db.nextUser = 3;
  db.datasets = [
    { id:1, doi:'10.48436/rdm-001', title:'Air Quality Measurements Bishkek 2024',
      description:'Hourly PM2.5, NO2, CO measurements from 12 stations across Bishkek city',
      creator:{name:'Research Team KSTU',orcid:'0000-0002-1234-5678'},
      keywords:['air quality','Bishkek','PM2.5','environment','monitoring'],
      license:'CC-BY-4.0', access:'open', format:'text/csv', size:48200, version:3,
      created:'2024-03-15T09:00:00Z', updated:'2024-11-20T14:30:00Z',
      fair:{F:98,A:95,I:87,R:92}, downloads:142, views:890, status:'published', userId:2 },
    { id:2, doi:'10.48436/rdm-002', title:'Soil Composition Analysis — Chui Valley',
      description:'Chemical composition of agricultural soils across 8 districts, 240 sample points',
      creator:{name:'Environmental Lab KSTU',orcid:'0000-0001-9876-5432'},
      keywords:['soil','agriculture','chemistry','Chui Valley','Kyrgyzstan'],
      license:'CC-BY-NC-SA-4.0', access:'open', format:'application/json', size:12500, version:1,
      created:'2024-06-10T11:00:00Z', updated:'2024-06-10T11:00:00Z',
      fair:{F:90,A:88,I:95,R:85}, downloads:67, views:340, status:'published', userId:2 },
    { id:3, doi:'10.48436/rdm-003', title:'Water Quality Dataset — Issyk-Kul Lake 2023–2024',
      description:'Temperature, pH, dissolved oxygen, turbidity monitoring at 24 stations',
      creator:{name:'Hydrology Dept KSTU',orcid:'0000-0003-1111-2222'},
      keywords:['water','Issyk-Kul','hydrology','monitoring','lake'],
      license:'CC0-1.0', access:'open', format:'application/vnd.ms-excel', size:87600, version:2,
      created:'2024-01-05T08:00:00Z', updated:'2024-09-01T12:00:00Z',
      fair:{F:100,A:100,I:78,R:95}, downloads:203, views:1420, status:'published', userId:1 },
    { id:4, doi:'10.48436/rdm-004', title:'Mountain Glacier Mass Balance 2020–2024',
      description:'Annual mass balance measurements for 15 glaciers in Tian-Shan range',
      creator:{name:'Glaciology Lab KSTU',orcid:'0000-0004-5555-6666'},
      keywords:['glaciers','Tian-Shan','climate change','mass balance'],
      license:'CC-BY-4.0', access:'open', format:'text/csv', size:24300, version:1,
      created:'2024-10-01T10:00:00Z', updated:'2024-10-15T09:00:00Z',
      fair:{F:88,A:92,I:80,R:88}, downloads:31, views:210, status:'draft', userId:2 },
  ];
  db.nextDs = 5;
  db.logs = [];
  db.sessions = {};
  saveDB();
}

// ── Utils ──────────────────────────────────────────────────────────────────
function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
function genToken(){ return crypto.randomBytes(32).toString('hex'); }

function calcFAIR(ds){
  const F = (ds.doi?40:0)+(ds.title?20:0)+((ds.keywords||[]).length>0?20:0)+(ds.description?20:0);
  const A = (ds.access==='open'?50:10)+(ds.license?30:0)+(ds.format?20:0);
  const I = (ds.format?40:0)+((ds.keywords||[]).length>2?30:0)+(ds.creator?.orcid?30:0);
  const R = (ds.license?40:0)+(ds.version>1?20:0)+((ds.description||'').length>50?20:0)+(ds.creator?20:0);
  return {F,A,I,R};
}

const MIME = {
  '.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8',
  '.js':'application/javascript;charset=utf-8','.json':'application/json',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png',
};

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
}

function sendJSON(res,status,data){
  cors(res);
  res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify(data,null,2));
}

function readBody(req){
  return new Promise((ok,fail)=>{
    let b='';
    req.on('data',c=>{b+=c; if(b.length>1e6) req.destroy();});
    req.on('end',()=>{ try{ok(b?JSON.parse(b):{});}catch(e){fail(new Error('Bad JSON'));} });
    req.on('error',fail);
  });
}

function addLog(method, p, status, ms, userId){
  db.logs.unshift({ts:new Date().toISOString(),method,path:p,status,ms,userId:userId||null});
  if(db.logs.length>500) db.logs.length=500;
}

// ── Auth middleware ────────────────────────────────────────────────────────
function auth(req, requireRole){
  const h = req.headers['authorization']||'';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if(!token) return null;
  const sess = db.sessions[token];
  if(!sess || Date.now() > sess.exp) return null;
  const user = db.users.find(u=>u.id===sess.userId);
  if(!user || !user.active) return null;
  if(requireRole && user.role !== requireRole && user.role !== 'admin') return null;
  return user;
}

// ── Router ─────────────────────────────────────────────────────────────────
const routes=[];
function route(m,pat,fn){ routes.push({m,re:new RegExp('^'+pat+'$'),fn}); }

// ═══════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════

route('GET','/api/health',(req,res)=>{
  sendJSON(res,200,{status:'ok',version:'2.0.0',uptime:Math.round(process.uptime()),
    ts:new Date().toISOString(),principles:['Findable','Accessible','Interoperable','Reusable']});
});

route('GET','/api/stats',(req,res)=>{
  const pub = db.datasets.filter(d=>d.status==='published');
  const avg = k => Math.round(pub.reduce((s,d)=>s+d.fair[k],0)/(pub.length||1));
  sendJSON(res,200,{
    total:pub.length, downloads:pub.reduce((s,d)=>s+d.downloads,0),
    views:pub.reduce((s,d)=>s+d.views,0), open:pub.filter(d=>d.access==='open').length,
    fair:{F:avg('F'),A:avg('A'),I:avg('I'),R:avg('R')},
    licenses:[...new Set(pub.map(d=>d.license))],
  });
});

route('GET','/api/datasets',(req,res,q)=>{
  let r = db.datasets.filter(d=>d.status==='published');
  if(q.q){ const s=q.q.toLowerCase(); r=r.filter(d=>d.title.toLowerCase().includes(s)||d.description.toLowerCase().includes(s)||d.keywords.some(k=>k.toLowerCase().includes(s))); }
  if(q.access) r=r.filter(d=>d.access===q.access);
  if(q.license) r=r.filter(d=>d.license===q.license);
  const page=parseInt(q.page)||1, lim=parseInt(q.limit)||12;
  const total=r.length, items=r.slice((page-1)*lim,page*lim);
  sendJSON(res,200,{total,page,limit:lim,pages:Math.ceil(total/lim),items});
});

route('GET','/api/datasets/(\\d+)',(req,res,q,p)=>{
  const ds = db.datasets.find(d=>d.id===parseInt(p[1])&&d.status==='published');
  if(!ds) return sendJSON(res,404,{error:'Not found'});
  ds.views++;  saveDB();
  sendJSON(res,200,{...ds,_links:{self:`/api/datasets/${ds.id}`,download:`/api/datasets/${ds.id}/download`,metadata:`/api/datasets/${ds.id}/metadata`}});
});

route('GET','/api/datasets/(\\d+)/metadata',(req,res,q,p)=>{
  const ds = db.datasets.find(d=>d.id===parseInt(p[1])&&d.status==='published');
  if(!ds) return sendJSON(res,404,{error:'Not found'});
  sendJSON(res,200,{'@context':'http://schema.org','@type':'Dataset',
    identifier:`https://doi.org/${ds.doi}`,name:ds.title,description:ds.description,
    keywords:ds.keywords,license:`https://creativecommons.org/licenses/`,
    creator:{'@type':'Person',name:ds.creator.name,identifier:`https://orcid.org/${ds.creator.orcid||''}`},
    dateCreated:ds.created,dateModified:ds.updated,version:String(ds.version),
    encodingFormat:ds.format,contentSize:ds.size,isAccessibleForFree:ds.access==='open',
    publisher:{'@type':'Organization',name:'KSTU Research Data Repository'}});
});

route('GET','/api/datasets/(\\d+)/download',(req,res,q,p)=>{
  const ds = db.datasets.find(d=>d.id===parseInt(p[1])&&d.status==='published');
  if(!ds) return sendJSON(res,404,{error:'Not found'});
  ds.downloads++; saveDB();
  cors(res);
  res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':`attachment;filename="dataset-${ds.id}.csv"`});
  res.end(`# ${ds.title}\n# DOI: ${ds.doi}\n# License: ${ds.license}\ntimestamp,value,unit,station\n2024-01-01T00:00:00Z,42.3,μg/m³,STN-01\n2024-01-01T01:00:00Z,38.7,μg/m³,STN-01\n`);
});

// Public login (researcher self-service)
route('POST','/api/auth/login',async(req,res)=>{
  const {email,password} = await readBody(req).catch(()=>({}));
  const user = db.users.find(u=>u.email===email&&u.active);
  if(!user||user.passwordHash!==sha256(password||''))
    return sendJSON(res,401,{error:'Invalid credentials'});
  const token=genToken();
  db.sessions[token]={userId:user.id,exp:Date.now()+8*3600*1000,role:user.role};
  saveDB();
  sendJSON(res,200,{token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
});

route('POST','/api/auth/logout',async(req,res)=>{
  const h=req.headers['authorization']||'';
  const token=h.startsWith('Bearer ')?h.slice(7):null;
  if(token) delete db.sessions[token], saveDB();
  sendJSON(res,200,{message:'Logged out'});
});

// Researcher: submit dataset
route('POST','/api/datasets',async(req,res)=>{
  const user = auth(req);
  if(!user) return sendJSON(res,401,{error:'Authentication required'});
  const body = await readBody(req).catch(e=>null);
  if(!body||!body.title||!body.description||!body.license)
    return sendJSON(res,422,{error:'title, description, license required'});
  const id=db.nextDs++;
  const ds={id,doi:`10.48436/rdm-${String(id).padStart(3,'0')}`,
    title:body.title,description:body.description,
    creator:body.creator||{name:user.name},keywords:body.keywords||[],
    license:body.license,access:body.access||'open',format:body.format||'text/plain',
    size:body.size||0,version:1,created:new Date().toISOString(),updated:new Date().toISOString(),
    downloads:0,views:0,status:'draft',userId:user.id};
  ds.fair=calcFAIR(ds);
  db.datasets.push(ds); saveDB();
  sendJSON(res,201,ds);
});

// ═══════════════════════════════════════
// ADMIN API  (requires admin role)
// ═══════════════════════════════════════

route('POST','/admin/api/login',async(req,res)=>{
  const {email,password} = await readBody(req).catch(()=>({}));
  const user = db.users.find(u=>u.email===email&&u.role==='admin'&&u.active);
  if(!user||user.passwordHash!==sha256(password||''))
    return sendJSON(res,401,{error:'Invalid admin credentials'});
  const token=genToken();
  db.sessions[token]={userId:user.id,exp:Date.now()+8*3600*1000,role:'admin'};
  saveDB();
  sendJSON(res,200,{token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
});

route('GET','/admin/api/stats',(req,res)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const all=db.datasets, pub=all.filter(d=>d.status==='published'), draft=all.filter(d=>d.status==='draft');
  const avg=k=>Math.round(all.reduce((s,d)=>s+d.fair[k],0)/(all.length||1));
  sendJSON(res,200,{
    datasets:{total:all.length,published:pub.length,draft:draft.length},
    users:{total:db.users.length,active:db.users.filter(u=>u.active).length,admins:db.users.filter(u=>u.role==='admin').length},
    downloads:all.reduce((s,d)=>s+d.downloads,0),
    views:all.reduce((s,d)=>s+d.views,0),
    fair:{F:avg('F'),A:avg('A'),I:avg('I'),R:avg('R')},
    sessions:Object.keys(db.sessions).length,
    logs_today:db.logs.filter(l=>l.ts.startsWith(new Date().toISOString().slice(0,10))).length,
  });
});

// Datasets CRUD
route('GET','/admin/api/datasets',(req,res,q)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  let r=[...db.datasets];
  if(q.q){const s=q.q.toLowerCase();r=r.filter(d=>d.title.toLowerCase().includes(s));}
  if(q.status) r=r.filter(d=>d.status===q.status);
  const page=parseInt(q.page)||1,lim=parseInt(q.limit)||20;
  sendJSON(res,200,{total:r.length,page,limit:lim,pages:Math.ceil(r.length/lim),items:r.slice((page-1)*lim,page*lim)});
});

route('GET','/admin/api/datasets/(\\d+)',(req,res,q,p)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const ds=db.datasets.find(d=>d.id===parseInt(p[1]));
  if(!ds) return sendJSON(res,404,{error:'Not found'});
  sendJSON(res,200,ds);
});

route('PUT','/admin/api/datasets/(\\d+)',async(req,res,q,p)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const body=await readBody(req).catch(()=>null);
  if(!body) return sendJSON(res,400,{error:'Bad request'});
  const idx=db.datasets.findIndex(d=>d.id===parseInt(p[1]));
  if(idx===-1) return sendJSON(res,404,{error:'Not found'});
  db.datasets[idx]={...db.datasets[idx],...body,id:db.datasets[idx].id,updated:new Date().toISOString(),version:db.datasets[idx].version+1};
  db.datasets[idx].fair=calcFAIR(db.datasets[idx]);
  saveDB(); sendJSON(res,200,db.datasets[idx]);
});

route('DELETE','/admin/api/datasets/(\\d+)',(req,res,q,p)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const idx=db.datasets.findIndex(d=>d.id===parseInt(p[1]));
  if(idx===-1) return sendJSON(res,404,{error:'Not found'});
  db.datasets.splice(idx,1); saveDB();
  sendJSON(res,200,{message:'Deleted'});
});

route('POST','/admin/api/datasets/(\\d+)/publish',(req,res,q,p)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const ds=db.datasets.find(d=>d.id===parseInt(p[1]));
  if(!ds) return sendJSON(res,404,{error:'Not found'});
  ds.status='published'; ds.updated=new Date().toISOString(); saveDB();
  sendJSON(res,200,ds);
});

// Users CRUD
route('GET','/admin/api/users',(req,res)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  sendJSON(res,200,db.users.map(u=>({...u,passwordHash:undefined})));
});

route('POST','/admin/api/users',async(req,res)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const body=await readBody(req).catch(()=>null);
  if(!body?.email||!body?.name||!body?.password) return sendJSON(res,422,{error:'name, email, password required'});
  if(db.users.find(u=>u.email===body.email)) return sendJSON(res,409,{error:'Email already exists'});
  const id=db.nextUser++;
  const user={id,name:body.name,email:body.email,role:body.role||'researcher',
    passwordHash:sha256(body.password),active:true,created:new Date().toISOString()};
  db.users.push(user); saveDB();
  sendJSON(res,201,{...user,passwordHash:undefined});
});

route('PUT','/admin/api/users/(\\d+)',async(req,res,q,p)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const body=await readBody(req).catch(()=>null);
  if(!body) return sendJSON(res,400,{error:'Bad request'});
  const idx=db.users.findIndex(u=>u.id===parseInt(p[1]));
  if(idx===-1) return sendJSON(res,404,{error:'Not found'});
  if(body.password) body.passwordHash=sha256(body.password), delete body.password;
  db.users[idx]={...db.users[idx],...body,id:db.users[idx].id};
  saveDB();
  sendJSON(res,200,{...db.users[idx],passwordHash:undefined});
});

route('DELETE','/admin/api/users/(\\d+)',(req,res,q,p)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const id=parseInt(p[1]);
  if(id===1) return sendJSON(res,403,{error:'Cannot delete root admin'});
  const idx=db.users.findIndex(u=>u.id===id);
  if(idx===-1) return sendJSON(res,404,{error:'Not found'});
  db.users.splice(idx,1); saveDB();
  sendJSON(res,200,{message:'Deleted'});
});

// Logs
route('GET','/admin/api/logs',(req,res,q)=>{
  if(!auth(req,'admin')) return sendJSON(res,401,{error:'Unauthorized'});
  const lim=parseInt(q.limit)||100;
  sendJSON(res,200,{total:db.logs.length,logs:db.logs.slice(0,lim)});
});

// ── Main handler ──────────────────────────────────────────────────────────
const server = http.createServer(async(req,res)=>{
  const t0=Date.now();
  const parsed=url.parse(req.url,true);
  const pathname=parsed.pathname.replace(/\/+$/,'').replace(/\.\./g,'')||'/';

  if(req.method==='OPTIONS'){
    cors(res); res.writeHead(204); res.end(); return;
  }

  // API routing
  if(pathname.startsWith('/api/')||pathname.startsWith('/admin/api/')){
    let matched=false;
    for(const r of routes){
      if(r.m!==req.method) continue;
      const m=pathname.match(r.re);
      if(m){ matched=true; try{await r.fn(req,res,parsed.query,m);}catch(e){sendJSON(res,500,{error:e.message});} break; }
    }
    if(!matched) sendJSON(res,404,{error:'Route not found'});
    addLog(req.method,pathname,res.statusCode,Date.now()-t0,
      db.sessions[((req.headers['authorization']||'').slice(7))]?.userId);
    return;
  }

  // Static: admin panel
  if(pathname.startsWith('/admin')){
    const filePath = pathname==='/admin'||pathname==='/admin/'
      ? path.join(ADM_DIR,'index.html')
      : path.join(ADM_DIR, pathname.replace('/admin/',''));
    serveFile(res,filePath,path.join(ADM_DIR,'index.html'));
    return;
  }

  // Static: public site
  const filePath = pathname==='/'
    ? path.join(PUB_DIR,'index.html')
    : path.join(PUB_DIR, pathname.slice(1));
  serveFile(res,filePath,path.join(PUB_DIR,'index.html'));
});

function serveFile(res,fp,fallback){
  const ext=path.extname(fp).toLowerCase();
  const mime=MIME[ext]||'application/octet-stream';
  fs.readFile(fp,(e,d)=>{
    if(e) fs.readFile(fallback,(e2,d2)=>{
      if(e2){cors(res);res.writeHead(404);res.end('404');}
      else{cors(res);res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(d2);}
    });
    else{cors(res);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'max-age=600'});res.end(d);}
  });
}

loadDB();
server.listen(PORT,()=>{
  console.log(`\n  RDM System v2 — KSTU`);
  console.log(`  Public  → http://localhost:${PORT}`);
  console.log(`  Admin   → http://localhost:${PORT}/admin`);
  console.log(`  API     → http://localhost:${PORT}/api\n`);
  console.log(`  Admin login: admin@kstu.kg / admin123\n`);
});
module.exports=server;
