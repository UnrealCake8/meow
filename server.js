import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3080);
const base=process.env.BASE_URL;
const secret=process.env.SESSION_SECRET;
const key=process.env.CREDENTIAL_KEY;
if(process.env.NODE_ENV==='production' && new URL(base||'http://localhost').protocol!=='https:') throw Error('Production BASE_URL must be HTTPS');
if(!base||!secret||secret.length<32||!process.env.DATABASE_URL) throw Error('Configure BASE_URL, DATABASE_URL, SESSION_SECRET (32+ characters)');
if(!['http:','https:'].includes(new URL(base).protocol)) throw Error('Invalid BASE_URL');
if(process.env.TRUST_PROXY==='true') app.set('trust proxy',1);
app.disable('x-powered-by');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000});
const Store=connectPgSimple(session);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],frameSrc:['https://*.asanib.com'],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'16kb'}));
app.use(session({store:new Store({pool,tableName:'sessions',createTableIfMissing:true}),name:'asanib.sid',secret,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:604800000}}));
const vmFromHost=host=>{const m=/^connect-vm([1-9]|1\d|2[01])\.asanib\.com(?::\d+)?$/i.exec(host||'');return m?Number(m[1]):null;};
const safeOrigin=req=>vmFromHost(req.get('host'))?'https://'+req.get('host').split(':')[0]:new URL(base).origin;
app.use((req,res,next)=>{if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();if(req.get('origin')!==safeOrigin(req))return res.status(403).json({error:'Invalid request origin'});next();});
const auth=(req,res,next)=>req.session.userId?next():res.status(401).json({error:'Sign in first'});
const admin=(req,res,next)=>req.session.role==='admin'?next():res.status(403).json({error:'Admin only'});
const run=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-7',legacyHeaders:false});
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.get('/api/ready',run(async(_req,res)=>{await pool.query('SELECT 1');res.json({ok:true})}));
app.get('/api/me',(req,res)=>res.json({user:req.session.userId?{email:req.session.email,role:req.session.role}:null}));
const signupLimiter=rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many sign-up attempts. Please try again later.'}});
app.post('/api/auth/signup',signupLimiter,run(async(req,res)=>{
 const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
 const password=typeof req.body?.password==='string'?req.body.password:'';
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email address'});
 if(password.length<12||Buffer.byteLength(password,'utf8')>72)return res.status(400).json({error:'Use a password of 12–72 bytes'});
 const passwordHash=await bcrypt.hash(password,12);
 let user;
 try{
  const result=await pool.query("INSERT INTO users (email,password_hash,role) VALUES ($1,$2,'student') RETURNING id,email,role",[email,passwordHash]);
  user=result.rows[0];
 }catch(err){
  if(err.code==='23505')return res.status(409).json({error:'An account with this email already exists. Sign in instead.'});
  throw err;
 }
 await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
 req.session.userId=user.id;req.session.email=user.email;req.session.role=user.role;
 await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
 res.status(201).json({ok:true});
}));
app.post('/api/auth/login',loginLimiter,run(async(req,res)=>{
 const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
 const password=typeof req.body?.password==='string'?req.body.password:'';
 if(!email||!password)return res.status(400).json({error:'Email and password required'});
 const {rows:[user]}=await pool.query('SELECT id,email,role,password_hash FROM users WHERE email=$1',[email]);
 if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:'Invalid credentials'});
 await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
 req.session.userId=user.id;req.session.email=user.email;req.session.role=user.role;
 await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
 res.json({ok:true});
}));
app.post('/api/auth/logout',auth,(req,res,next)=>req.session.destroy(e=>e?next(e):(res.clearCookie('asanib.sid'),res.json({ok:true}))));
app.get('/api/vms',auth,run(async(req,res)=>{
 const {rows}=await pool.query(`SELECT v.id,v.name,v.os,v.notes,v.enabled,
 EXISTS(SELECT 1 FROM claims c WHERE c.vm_id=v.id AND c.released_at IS NULL) AS claimed,
 EXISTS(SELECT 1 FROM claims c WHERE c.vm_id=v.id AND c.user_id=$1 AND c.released_at IS NULL) AS mine
 FROM vms v WHERE v.enabled=1 ORDER BY v.id`,[req.session.userId]);
 res.json({vms:rows});
}));
app.post('/api/vms/:id/claim',auth,run(async(req,res)=>{
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid VM'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)',[req.session.userId]);
  const {rows:[existing]}=await client.query('SELECT vm_id FROM claims WHERE user_id=$1 AND released_at IS NULL',[req.session.userId]);
  if(existing){await client.query('ROLLBACK');return res.status(409).json({error:'You already have a VM'});}
  const {rows:[vm]}=await client.query('SELECT id FROM vms WHERE id=$1 AND enabled=1 FOR UPDATE',[id]);
  if(!vm){await client.query('ROLLBACK');return res.status(404).json({error:'VM unavailable'});}
  const {rows:[busy]}=await client.query('SELECT vm_id FROM claims WHERE vm_id=$1 AND released_at IS NULL',[id]);
  if(busy){await client.query('ROLLBACK');return res.status(409).json({error:'VM already claimed'});}
  await client.query('INSERT INTO claims(vm_id,user_id) VALUES($1,$2)',[id,req.session.userId]);
  await client.query('COMMIT');res.json({ok:true});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return res.status(409).json({error:'VM already claimed'});throw e;}finally{client.release();}
}));
function decodeUrl(ciphertext){
 if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('CREDENTIAL_KEY must be 64 hexadecimal characters');
 const b=Buffer.from(ciphertext,'base64'),d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12));
 d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');
}
function storedVmNumber(value){
 let u;try{u=new URL(value);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
 const m=/^(?:connect-)?vm([1-9]|1\d|2[01])\.asanib\.com$/i.exec(u.hostname);
 return m?Number(m[1]):null;
}
app.get('/api/my-vm',auth,run(async(req,res)=>{
 const {rows:[row]}=await pool.query('SELECT v.id,v.name,v.os,v.url_enc FROM vms v JOIN claims c ON c.vm_id=v.id WHERE c.user_id=$1 AND c.released_at IS NULL AND v.enabled=1',[req.session.userId]);
 if(!row)return res.json({vm:null});
 const number=storedVmNumber(decodeUrl(row.url_enc));
 res.json({vm:{id:row.id,name:row.name,os:row.os,connectUrl:number?'https://connect-vm'+number+'.asanib.com':null}});
}));
app.get('/api/connect/vm',auth,run(async(req,res)=>{
 const number=vmFromHost(req.get('host'));if(!number)return res.status(404).json({error:'Not a Connect domain'});
 const {rows:[row]}=await pool.query('SELECT v.url_enc FROM vms v JOIN claims c ON c.vm_id=v.id WHERE c.user_id=$1 AND c.released_at IS NULL AND v.enabled=1',[req.session.userId]);
 if(!row)return res.status(403).json({error:'No active claimed VM'});
 if(storedVmNumber(decodeUrl(row.url_enc))!==number)return res.status(403).json({error:'This VM is not assigned to your account'});
 res.set('Cache-Control','no-store').json({url:'https://vm'+number+'.asanib.com'});
}));
app.get('/api/admin/users',auth,admin,run(async(_req,res)=>{const {rows}=await pool.query('SELECT id,email,role FROM users ORDER BY id LIMIT 500');res.json({users:rows})}));
app.get('/api/admin/vms',auth,admin,run(async(_req,res)=>{const {rows}=await pool.query('SELECT v.id,v.name,v.os,v.enabled,c.user_id,u.email AS assigned_to FROM vms v LEFT JOIN claims c ON c.vm_id=v.id AND c.released_at IS NULL LEFT JOIN users u ON u.id=c.user_id ORDER BY v.id');res.json({vms:rows})}));
app.post('/api/admin/vms/:id/release',auth,admin,run(async(req,res)=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid VM'});const {rowCount}=await pool.query('UPDATE claims SET released_at=NOW() WHERE vm_id=$1 AND released_at IS NULL',[id]);res.json({ok:true,released:rowCount})}));
app.get('/api/admin/overview',auth,admin,run(async(_req,res)=>{
 const {rows:[row]}=await pool.query('SELECT (SELECT count(*)::int FROM users WHERE role=\'student\') students,(SELECT count(*)::int FROM vms) vms,(SELECT count(*)::int FROM claims WHERE released_at IS NULL) claimed');
 res.json(row);
}));
app.get('/',(req,res)=>res.sendFile(path.join(root,'public',vmFromHost(req.get('host'))?'connect.html':'index.html')));
app.use(express.static(path.join(root,'public'),{index:false,dotfiles:'deny'}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'});});
pool.query('SELECT 1').then(()=>app.listen(port,()=>console.log('Asan IB Cloud listening on '+port))).catch(e=>{console.error('Database connection failed:',e.code||e.message);process.exit(1);});
