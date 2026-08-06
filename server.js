import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import {createSign} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const PORT=Number(process.env.PORT||10000);
const sessions=new Map();
const cache={objects:null,expires:0};
const liveCache={objects:null,expires:0,idsKey:""};
const RENDER_DEFAULT_DATA_DIR="/var/data";
const DATA_DIR=path.resolve(process.env.DATA_DIR||process.env.RENDER_DISK_PATH||(process.env.RENDER?RENDER_DEFAULT_DATA_DIR:__dirname));
const F={settings:"settings.json",content:"content.json",map:"menu-map.json",googleAuth:"google-auth.json"};
const HISTORY_DIR=path.join(DATA_DIR,"history");
const VERSION="13.2.4";
const BACKUP_PREFIX="BHFC-menu-backup-";

const LOCAL_BACKUP_DIR=path.join(DATA_DIR,"backups");
const LOCAL_BACKUP_RETENTION=30;
async function ensureLocalBackupDir(){await fs.mkdir(LOCAL_BACKUP_DIR,{recursive:true})}
function localBackupStamp(){return new Date().toISOString().replace(/[:.]/g,"-")}
async function createLocalBackup(reason="manual"){
  await ensureLocalBackupDir();
  const payload={schemaVersion:1,appVersion:VERSION,createdAt:new Date().toISOString(),reason,settings:await read(F.settings),content:await read(F.content),menuMap:await read(F.map)};
  const filename=`BHFC-menu-backup-${localBackupStamp()}-${String(reason).replace(/[^a-z0-9_-]/gi,"-")}.json`;
  await fs.writeFile(path.join(LOCAL_BACKUP_DIR,filename),JSON.stringify(payload,null,2));
  const files=(await fs.readdir(LOCAL_BACKUP_DIR)).filter(x=>x.endsWith(".json")).sort().reverse();
  for(const old of files.slice(LOCAL_BACKUP_RETENTION))await fs.unlink(path.join(LOCAL_BACKUP_DIR,old)).catch(()=>{});
  return{filename,createdAt:payload.createdAt,reason};
}
async function listLocalBackups(){
  await ensureLocalBackupDir();
  const names=(await fs.readdir(LOCAL_BACKUP_DIR)).filter(x=>x.endsWith(".json")).sort().reverse();
  return Promise.all(names.map(async name=>{const s=await fs.stat(path.join(LOCAL_BACKUP_DIR,name));return{name,size:s.size,modifiedAt:s.mtime.toISOString()}}));
}
async function restoreLocalBackupFile(name){
  const safeName=path.basename(name),payload=JSON.parse(await fs.readFile(path.join(LOCAL_BACKUP_DIR,safeName),"utf8"));
  if(!payload.settings||!payload.content||!payload.menuMap)throw Error("Invalid local backup.");
  await createLocalBackup("pre-restore");
  await write(F.settings,payload.settings);await write(F.content,payload.content);await write(F.map,payload.menuMap);
  cache.expires=0;liveCache.objects=null;return{ok:true,restored:safeName};
}
function mappingHealth(menuMap){
  const rows=Object.values(menuMap.sections||{}).flat();
  const mapped=rows.filter(r=>Boolean(r.squareVariationId)||(Array.isArray(r.squareVariationIds)&&r.squareVariationIds.length)).length;
  const ids=rows.flatMap(r=>r.squareVariationId?[r.squareVariationId]:(r.squareVariationIds||[]));
  const counts=ids.reduce((a,id)=>(a[id]=(a[id]||0)+1,a),{});
  const duplicates=Object.entries(counts).filter(([,n])=>n>1).map(([id,count])=>({id,count}));
  return{total:rows.length,mapped,unmapped:rows.length-mapped,duplicates,status:mapped===rows.length&&!duplicates.length?"healthy":"attention"};
}


app.set("trust proxy",1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'","https://use.typekit.net","https://p.typekit.net"],fontSrc:["'self'","https://use.typekit.net","https://p.typekit.net","data:"],scriptSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],frameSrc:["'self'"]}}}));
app.use(express.json({limit:"300kb"}));
app.use(cookieParser());

async function ensureDataFile(name){
  await fs.mkdir(DATA_DIR,{recursive:true});
  const target=path.join(DATA_DIR,name);
  try{await fs.access(target)}catch{
    const source=path.join(__dirname,name);
    try{await fs.copyFile(source,target)}catch{}
  }
  return target;
}
const read=async n=>JSON.parse(await fs.readFile(await ensureDataFile(n),"utf8"));
async function write(n,v){
  const target=await ensureDataFile(n),tmp=target+".tmp";
  await fs.mkdir(HISTORY_DIR,{recursive:true});
  try{
    const current=await fs.readFile(target,"utf8");
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");
    const backup=path.join(HISTORY_DIR,`${path.basename(n,".json")}-${stamp}.json`);
    await fs.writeFile(backup,current);
    const files=(await fs.readdir(HISTORY_DIR)).filter(x=>x.startsWith(path.basename(n,".json")+"-")).sort();
    for(const old of files.slice(0,-30))await fs.unlink(path.join(HISTORY_DIR,old)).catch(()=>{});
  }catch{}
  await fs.writeFile(tmp,JSON.stringify(v,null,2));
  await fs.rename(tmp,target);
}
const safe=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const auth=(req,res,next)=>{const expiry=sessions.get(req.cookies.bhfc_admin);if(!expiry||expiry<Date.now())return res.status(401).json({error:"Unauthorised"});next()};
const base=e=>e==="sandbox"?"https://connect.squareupsandbox.com":"https://connect.squareup.com";
async function square(endpoint,options={}){const s=await read(F.settings),token=process.env.SQUARE_ACCESS_TOKEN;if(!token)throw Error("Square access token is not configured in Render.");const r=await fetch(base(s.square.environment)+endpoint,{...options,headers:{Authorization:`Bearer ${token}`,"Square-Version":process.env.SQUARE_VERSION||"2026-07-16","Content-Type":"application/json",...(options.headers||{})}});if(!r.ok)throw Error(`Square ${r.status}: ${await r.text()}`);return r.json()}
async function catalog(force=false){if(!force&&cache.objects&&cache.expires>Date.now())return cache.objects;let cursor,all=[];do{const body={object_types:["ITEM","ITEM_VARIATION"],include_related_objects:true,limit:1000};if(cursor)body.cursor=cursor;const d=await square("/v2/catalog/search",{method:"POST",body:JSON.stringify(body)});all.push(...(d.objects||[]),...(d.related_objects||[]));cursor=d.cursor}while(cursor);cache.objects=[...new Map(all.map(x=>[x.id,x])).values()];cache.expires=Date.now()+10000;return cache.objects}
async function retrieveCatalogObject(id){
  const q=new URLSearchParams({include_related_objects:"true"});
  return square(`/v2/catalog/object/${encodeURIComponent(id)}?${q.toString()}`);
}
function flattenCatalogPayload(payloads){
  const all=[];
  const add=o=>{
    if(!o||!o.id)return;
    all.push(o);
    if(o.type==="ITEM")for(const v of o.item_data?.variations||[])add(v);
  };
  for(const d of payloads){
    add(d.object);
    for(const o of d.related_objects||[])add(o);
  }
  return [...new Map(all.map(x=>[x.id,x])).values()];
}
async function liveCatalogObjects(ids,force=false){
  const unique=[...new Set(ids.filter(Boolean))].sort();
  if(!unique.length)return [];
  const idsKey=unique.join(",");
  if(!force&&liveCache.objects&&liveCache.idsKey===idsKey&&liveCache.expires>Date.now())return liveCache.objects;
  const payloads=[];
  // Retrieve each mapped variation directly. This endpoint reliably includes
  // location_overrides.sold_out after a seller changes status in Square.
  for(let i=0;i<unique.length;i+=8){
    const batch=unique.slice(i,i+8);
    const results=await Promise.all(batch.map(id=>retrieveCatalogObject(id)));
    payloads.push(...results);
  }
  liveCache.objects=flattenCatalogPayload(payloads);
  liveCache.idsKey=idsKey;
  liveCache.expires=Date.now()+4000;
  return liveCache.objects;
}
function rowVariationIds(row){
  return [...new Set([row?.squareVariationId,...(Array.isArray(row?.squareVariationIds)?row.squareVariationIds:[])].filter(Boolean))];
}
function mappedIds(menuMap){return [...new Set(Object.values(menuMap.sections||{}).flatMap(rowVariationIds))]}
function cleanText(value,max=160){return String(value??"").trim().slice(0,max)}
function validateMenuMap(value){
  if(!value||typeof value!=="object"||!value.sections||typeof value.sections!=="object")throw Error("Invalid menu structure.");
  const allowed=["freshFish","crumbed","grilled","addChips","burgers","tacos","packs","snacks","chips","sauces"];
  const ids=new Set();
  const sections={};
  for(const section of allowed){
    const rows=Array.isArray(value.sections[section])?value.sections[section]:[];
    if(rows.length>40)throw Error(`Too many rows in ${section}.`);
    sections[section]=rows.map((source,index)=>{
      const id=cleanText(source.id,80)||`${section}-${crypto.randomUUID()}`;
      if(ids.has(id))throw Error(`Duplicate menu row ID: ${id}`);ids.add(id);
      const row={...source,id,name:cleanText(source.name,100)||"NEW ITEM",detail:cleanText(source.detail,140),origin:cleanText(source.origin,5).toUpperCase(),squareVariationId:cleanText(source.squareVariationId,120)};
      row.squareVariationIds=Array.isArray(source.squareVariationIds)?[...new Set(source.squareVariationIds.map(x=>cleanText(x,120)).filter(Boolean))]:[];
      if(!row.squareVariationIds.length)delete row.squareVariationIds;
      if(source.priceText!==undefined)row.priceText=cleanText(source.priceText,60);
      if(source.price!==undefined&&source.price!==null&&source.price!==""){const n=Number(source.price);if(!Number.isFinite(n)||n<0||n>10000)throw Error(`Invalid price for ${row.name}.`);row.price=n}
      row.noPrice=Boolean(source.noPrice);
      row.autoSquareMatch=Boolean(source.autoSquareMatch);
      return row;
    });
  }
  return{...value,sections};
}

function normaliseName(value){
  return String(value||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();
}
function tokenSet(value){return new Set(normaliseName(value).split(" ").filter(Boolean))}
function containsPhrase(haystack,needle){
  const h=` ${normaliseName(haystack)} `,n=` ${normaliseName(needle)} `;
  return n.trim().length>1&&h.includes(n);
}
function sectionTerms(section){
  return({freshFish:["beer battered","battered"],crumbed:["crumbed"],grilled:["grilled"],burgers:["burger"],tacos:["taco"],packs:["pack","basket"],snacks:[],chips:["chips","fries"],sauces:["sauce","aioli","tartare","mayo"]})[section]||[];
}
function resolveVariationIds(objects,row,section){
  if(row.squareVariationId)return [row.squareVariationId];
  if(Array.isArray(row.squareVariationIds)&&row.squareVariationIds.length)return row.squareVariationIds.filter(Boolean);
  if(!row?.autoSquareMatch)return [];
  const items=objects.filter(x=>x.type==="ITEM"&&!x.is_deleted&&!x.item_data?.is_archived);
  const aliases=(row.squareAliases||[row.name]).map(normaliseName).filter(Boolean);
  const excluded=(row.autoSquareExcludeTerms||[]).map(normaliseName).filter(Boolean);
  const context=sectionTerms(section);
  const scored=[];
  for(const item of items){
    const itemName=item.item_data?.name||"";
    for(const v of item.item_data?.variations||[]){
      if(!v?.id||v.is_deleted)continue;
      const variationName=v.item_variation_data?.name||"";
      const combined=normaliseName(`${itemName} ${variationName}`);
      const words=tokenSet(combined);
      if(excluded.some(x=>words.has(x)||containsPhrase(combined,x)))continue;
      let score=0,matchedAlias="";
      for(const alias of aliases){
        const aliasWords=alias.split(" ").filter(Boolean);
        let a=0;
        if(combined===alias)a=120;
        else if(normaliseName(itemName)===alias)a=110;
        else if(containsPhrase(combined,alias))a=95;
        else if(aliasWords.every(w=>words.has(w)))a=80;
        else continue;
        if(a>score){score=a;matchedAlias=alias}
      }
      if(!score)continue;
      for(const term of context)if(containsPhrase(combined,term))score+=12;
      // Penalise obvious cross-section collisions.
      if(section!=="burgers"&&words.has("burger"))score-=35;
      if(section!=="tacos"&&(words.has("taco")||words.has("tacos")))score-=35;
      if(section!=="crumbed"&&words.has("crumbed"))score-=8;
      if(section!=="grilled"&&words.has("grilled"))score-=20;
      if(row.id==="ch-potato"&&(words.has("sweet")||words.has("scallop")))score=-1;
      if(row.id==="ch-sweet"&&!words.has("sweet"))score=-1;
      if(score>0)scored.push({id:v.id,score,itemName,variationName,matchedAlias});
    }
  }
  scored.sort((a,b)=>b.score-a.score||a.itemName.localeCompare(b.itemName));
  if(!scored.length)return [];
  const top=scored[0].score;
  // Only accept high-confidence matches. Include tied variations belonging to
  // the same Square item so multi-size rows work correctly.
  if(top<80)return [];
  const topItem=scored[0].itemName;
  const chosen=scored.filter(x=>x.score>=top-2&&x.itemName===topItem).map(x=>x.id);
  return [...new Set(chosen)];
}
function mappingCandidates(objects,row,section){
  const ids=resolveVariationIds(objects,row,section);
  return ids.map(id=>{
    const v=objects.find(x=>x.type==="ITEM_VARIATION"&&x.id===id);
    const item=objects.find(x=>x.type==="ITEM"&&x.id===v?.item_variation_data?.item_id);
    return{id,itemName:item?.item_data?.name||"",variationName:v?.item_variation_data?.name||""};
  });
}
function combinedLive(states){
  const valid=states.filter(Boolean);
  if(!valid.length)return null;
  const activeStates=valid.filter(x=>x.active);
  return{
    price:valid.length===1?valid[0].price:null,
    // A combined menu row is sold out only when every active matched Square
    // variation is sold out. One unavailable size must not hide all sizes.
    soldOut:activeStates.length>0&&activeStates.every(x=>x.soldOut),
    active:activeStates.length>0,
    matchedVariations:valid.length
  };
}
function locationEnabled(object,locationId){
  if(!locationId)return true;
  if((object.absent_at_location_ids||[]).includes(locationId))return false;
  if(object.present_at_all_locations===true)return true;
  const present=object.present_at_location_ids||[];
  return present.length===0||present.includes(locationId);
}
function live(objects,id,locationId){
  const v=objects.find(x=>x.type==="ITEM_VARIATION"&&x.id===id);
  if(!v)return null;
  const d=v.item_variation_data||{};
  const item=objects.find(x=>x.type==="ITEM"&&x.id===d.item_id);
  const overrides=d.location_overrides||[];
  const configured=String(locationId||"").trim();
  const exact=overrides.find(x=>String(x.location_id||"").trim()===configured);
  // If the configured location does not match but Square reports a single
  // sold-out override, honour it. This is safe for the shop's one-location setup
  // and exposes the mismatch in the admin diagnostics.
  const soldOverride=exact||overrides.find(x=>x.sold_out===true)||null;
  const archived=Boolean(item?.item_data?.is_archived);
  const deleted=Boolean(item?.is_deleted||v.is_deleted);
  const locationAvailable=locationEnabled(item||{},locationId)&&locationEnabled(v,locationId);
  return{
    itemName:item?.item_data?.name||"Unnamed",
    variationName:d.name||"",
    price:Number(d.price_money?.amount||0)/100,
    soldOut:Boolean(soldOverride?.sold_out),
    soldOutLocationId:soldOverride?.location_id||"",
    configuredLocationMatched:Boolean(exact),
    locationOverrides:overrides.map(x=>({locationId:x.location_id||"",soldOut:Boolean(x.sold_out),trackInventory:Boolean(x.track_inventory)})),
    archived,deleted,locationAvailable,
    active:!archived&&!deleted&&locationAvailable
  }
}
function active(p,tz){if(!p.enabled)return false;const parts=new Intl.DateTimeFormat("en-AU",{timeZone:tz,weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.find(x=>x.type==="weekday").value),hm=`${parts.find(x=>x.type==="hour").value}:${parts.find(x=>x.type==="minute").value}`;return p.days.includes(day)&&hm>=p.start&&hm<=p.end}


function base64url(input){return Buffer.from(input).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function oauthConfig(){
  const clientId=String(process.env.GOOGLE_OAUTH_CLIENT_ID||"").trim();
  const clientSecret=String(process.env.GOOGLE_OAUTH_CLIENT_SECRET||"").trim();
  const baseUrl=String(process.env.APP_BASE_URL||"").trim().replace(/\/$/,"");
  return{clientId,clientSecret,baseUrl,redirectUri:baseUrl?`${baseUrl}/api/admin/google/callback`:"",configured:Boolean(clientId&&clientSecret&&baseUrl)};
}
async function readGoogleAuth(){try{return await read(F.googleAuth)}catch{return{}}}
async function writeGoogleAuth(value){await write(F.googleAuth,value)}
async function exchangeGoogleToken(params){
  const c=oauthConfig();
  const body=new URLSearchParams({...params,client_id:c.clientId,client_secret:c.clientSecret});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token)throw Error(d.error_description||d.error||`Google token error ${r.status}`);
  return d;
}
async function googleAccessToken(){
  const c=oauthConfig();if(!c.configured)throw Error("Google OAuth is not configured in Render.");
  const authData=await readGoogleAuth();
  if(authData.accessToken&&Number(authData.expiresAt||0)>Date.now()+60000)return authData.accessToken;
  if(!authData.refreshToken)throw Error("Google Drive is not connected. Click Connect Google Drive.");
  const d=await exchangeGoogleToken({grant_type:"refresh_token",refresh_token:authData.refreshToken});
  const updated={...authData,accessToken:d.access_token,expiresAt:Date.now()+Number(d.expires_in||3600)*1000};
  await writeGoogleAuth(updated);return updated.accessToken;
}
async function driveRequest(url,options={}){const token=await googleAccessToken();const r=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})}});if(!r.ok)throw Error(`Google Drive ${r.status}: ${await r.text()}`);if(r.status===204)return null;return r.json()}
async function ensureDriveFolder(){
  const authData=await readGoogleAuth();if(authData.folderId)return authData.folderId;
  const q=`name = 'BHFC Menu Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found=await driveRequest(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({q,fields:"files(id,name)",pageSize:"10"})}`);
  let folderId=found.files?.[0]?.id;
  if(!folderId){const created=await driveRequest("https://www.googleapis.com/drive/v3/files?fields=id,name",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"BHFC Menu Backups",mimeType:"application/vnd.google-apps.folder"})});folderId=created.id}
  await writeGoogleAuth({...authData,folderId});return folderId;
}
async function createBackupPayload(reason="manual"){
  const [settings,content,menuMap]=await Promise.all([read(F.settings),read(F.content),read(F.map)]);
  return{version:VERSION,exportedAt:new Date().toISOString(),reason,settings,content,menuMap};
}
function backupFileName(date=new Date(),reason="daily"){return `${BACKUP_PREFIX}${date.toISOString().replace(/[:.]/g,"-")}-${reason}.json`}
async function uploadDriveBackup(payload,reason="daily"){
  const folderId=await ensureDriveFolder(),name=backupFileName(new Date(payload.exportedAt),reason),boundary=`bhfc_${crypto.randomBytes(12).toString("hex")}`;
  const metadata={name,parents:[folderId],mimeType:"application/json",appProperties:{bhfcBackup:"true",version:VERSION,reason}};
  const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload,null,2)}\r\n--${boundary}--`;
  return driveRequest("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size,webViewLink",{method:"POST",headers:{"Content-Type":`multipart/related; boundary=${boundary}`},body});
}
async function listDriveBackups(){
  const folderId=await ensureDriveFolder(),q=`'${folderId}' in parents and trashed = false and appProperties has { key='bhfcBackup' and value='true' }`,params=new URLSearchParams({q,fields:"files(id,name,createdTime,modifiedTime,size,webViewLink,appProperties)",orderBy:"createdTime desc",pageSize:"1000"});
  const d=await driveRequest(`https://www.googleapis.com/drive/v3/files?${params}`);return d.files||[];
}
async function pruneDriveBackups(){
  const files=await listDriveBackups(),keep=new Set();
  files.slice(0,30).forEach(f=>keep.add(f.id));
  const weekly=new Set(),monthly=new Set();
  for(const f of files){const d=new Date(f.createdTime);const start=new Date(Date.UTC(d.getUTCFullYear(),0,1));const week=`${d.getUTCFullYear()}-${Math.ceil((((d-start)/86400000)+start.getUTCDay()+1)/7)}`;const month=f.createdTime.slice(0,7);if(weekly.size<12&&!weekly.has(week)){weekly.add(week);keep.add(f.id)}if(monthly.size<12&&!monthly.has(month)){monthly.add(month);keep.add(f.id)}}
  const remove=files.filter(f=>!keep.has(f.id));for(const f of remove)await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}`,{method:"DELETE"});return{kept:keep.size,deleted:remove.length};
}
async function recordAudit(action,details={}){try{const c=await read(F.content);c.audit=[{at:new Date().toISOString(),action,details},...(c.audit||[])].slice(0,300);await write(F.content,c)}catch{}}
async function runBackup(reason="manual"){
  const payload=await createBackupPayload(reason),file=await uploadDriveBackup(payload,reason),retention=await pruneDriveBackups();await recordAudit("backup.created",{reason,fileId:file.id,fileName:file.name});return{ok:true,file,retention,exportedAt:payload.exportedAt};
}
async function restoreDriveBackup(fileId){
  await runBackup("pre-restore");
  const token=await googleAccessToken(),r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw Error(`Google Drive ${r.status}: ${await r.text()}`);const payload=await r.json();
  if(!payload?.settings||!payload?.content||!payload?.menuMap)throw Error("Selected file is not a valid BHFC backup.");
  const validMap=validateMenuMap(payload.menuMap);await Promise.all([write(F.settings,payload.settings),write(F.content,payload.content),write(F.map,validMap)]);cache.objects=null;cache.expires=0;liveCache.objects=null;await recordAudit("backup.restored",{fileId,sourceVersion:payload.version,exportedAt:payload.exportedAt});return{ok:true,restoredFrom:payload.exportedAt||null};
}
let backupTimer=null,lastScheduledBackup=null;
function scheduleDailyBackup(){
  if(backupTimer)clearTimeout(backupTimer);const tz="Australia/Sydney",now=new Date(),parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(now).reduce((a,p)=>(a[p.type]=p.value,a),{});
  const localNow=new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`),next=new Date(localNow);next.setHours(3,0,0,0);if(next<=localNow)next.setDate(next.getDate()+1);const delay=Math.max(60000,next-localNow);
  backupTimer=setTimeout(async()=>{try{lastScheduledBackup=await runBackup("daily")}catch(e){lastScheduledBackup={ok:false,error:e.message,at:new Date().toISOString()}}finally{scheduleDailyBackup()}},delay);
  return{nextLocal:next.toISOString().replace(".000Z","")+" Australia/Sydney"};
}
const backupSchedule=scheduleDailyBackup();

function preserveExistingMappings(existing,incoming){
  const byId=new Map(Object.values(existing?.sections||{}).flat().map(r=>[r.id,r]));
  for(const rows of Object.values(incoming.sections||{}))for(const row of rows){
    const old=byId.get(row.id);
    const incomingIds=rowVariationIds(row),oldIds=rowVariationIds(old);
    if(!incomingIds.length&&oldIds.length&&!row.clearMapping){
      row.squareVariationId=old.squareVariationId||"";
      if(Array.isArray(old.squareVariationIds)&&old.squareVariationIds.length)row.squareVariationIds=[...old.squareVariationIds];
    }
    delete row.clearMapping;
  }
  return incoming;
}

const limiter=rateLimit({windowMs:15*60*1000,limit:12});
app.post("/api/admin/login",limiter,(req,res)=>{const expected=process.env.ADMIN_PASSWORD;if(!expected)return res.status(503).json({error:"ADMIN_PASSWORD is not configured in Render."});if(!safe(req.body?.password||"",expected))return res.status(401).json({error:"Incorrect password."});const token=crypto.randomBytes(32).toString("hex");sessions.set(token,Date.now()+12*60*60*1000);res.cookie("bhfc_admin",token,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:12*60*60*1000});res.json({ok:true})});
app.post("/api/admin/logout",auth,(req,res)=>{sessions.delete(req.cookies.bhfc_admin);res.clearCookie("bhfc_admin");res.json({ok:true})});
app.get("/api/admin/session",(req,res)=>{const e=sessions.get(req.cookies.bhfc_admin);res.json({authenticated:Boolean(e&&e>Date.now())})});
app.get("/api/settings",auth,async(req,res)=>res.json(await read(F.settings)));
app.put("/api/settings",auth,async(req,res)=>{await createLocalBackup("pre-settings-save");await write(F.settings,req.body);res.json(req.body)});
app.get("/api/admin/content",auth,async(req,res)=>res.json(await read(F.content)));
app.put("/api/admin/content",auth,async(req,res)=>{await createLocalBackup("pre-content-save");const v=req.body;v.audit=[{at:new Date().toISOString(),action:"content.updated"},...(v.audit||[])].slice(0,100);await write(F.content,v);res.json(v)});
app.get("/api/admin/map",auth,async(req,res)=>res.json(await read(F.map)));
app.put("/api/admin/map",auth,async(req,res)=>{
  try{
    await createLocalBackup("pre-menu-save");
    const existing=await read(F.map);
    let value=validateMenuMap(req.body);
    value=preserveExistingMappings(existing,value);
    await write(F.map,value);liveCache.objects=null;cache.expires=0;
    res.set("Cache-Control","no-store");res.json(value);
  }catch(e){res.status(400).json({error:e.message})}
});
app.get("/api/admin/persistence/status",auth,async(req,res)=>{
  let writable=false;try{await fs.mkdir(DATA_DIR,{recursive:true});const p=path.join(DATA_DIR,".write-test");await fs.writeFile(p,"ok");await fs.unlink(p);writable=true}catch{}
  let historyCount=0;try{historyCount=(await fs.readdir(HISTORY_DIR)).length}catch{}
  res.set("Cache-Control","no-store");res.json({dataDir:DATA_DIR,persistent:DATA_DIR!==__dirname,writable,historyCount,version:VERSION,renderDiskExpected:process.env.RENDER?RENDER_DEFAULT_DATA_DIR:null});
});
app.post("/api/admin/restore-local",auth,async(req,res)=>{
  try{
    const payload=req.body;
    if(!payload?.settings||!payload?.content||!payload?.menuMap)throw Error("Invalid BHFC backup file.");
    const validMap=validateMenuMap(payload.menuMap);
    await Promise.all([write(F.settings,payload.settings),write(F.content,payload.content),write(F.map,validMap)]);
    cache.objects=null;liveCache.objects=null;res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message})}
});
app.get("/api/admin/backup",auth,async(req,res)=>{const payload=await createBackupPayload("download");res.set("Content-Disposition",`attachment; filename=${backupFileName(new Date(payload.exportedAt),"download")}`);res.json(payload)});
app.get("/api/admin/google/connect",auth,async(req,res)=>{
  try{const c=oauthConfig();if(!c.configured)throw Error("Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and APP_BASE_URL in Render first.");
    const state=crypto.randomBytes(24).toString("hex");sessions.set(`google:${state}`,Date.now()+10*60*1000);
    const q=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:"code",scope:"https://www.googleapis.com/auth/drive.file",access_type:"offline",prompt:"consent",state,include_granted_scopes:"true"});
    res.json({url:`https://accounts.google.com/o/oauth2/v2/auth?${q}`});
  }catch(e){res.status(503).json({error:e.message})}
});
app.get("/api/admin/google/callback",async(req,res)=>{
  try{const state=String(req.query.state||""),expiry=sessions.get(`google:${state}`);sessions.delete(`google:${state}`);if(!state||!expiry||expiry<Date.now())throw Error("Google connection expired. Return to Menu Manager and try again.");if(req.query.error)throw Error(String(req.query.error));
    const c=oauthConfig(),d=await exchangeGoogleToken({grant_type:"authorization_code",code:String(req.query.code||""),redirect_uri:c.redirectUri});
    await writeGoogleAuth({refreshToken:d.refresh_token,accessToken:d.access_token,expiresAt:Date.now()+Number(d.expires_in||3600)*1000,connectedAt:new Date().toISOString()});await ensureDriveFolder();
    res.type("html").send('<!doctype html><meta charset="utf-8"><title>Google Drive connected</title><body style="font-family:Arial;padding:40px"><h1>Google Drive connected</h1><p>You can close this window and return to the BHFC Menu Manager.</p><script>setTimeout(()=>window.close(),1500)</script></body>');
  }catch(e){res.status(400).type("html").send(`<h1>Connection failed</h1><p>${String(e.message).replace(/[<>&]/g,"")}</p>`)}
});
app.post("/api/admin/google/disconnect",auth,async(req,res)=>{try{await writeGoogleAuth({});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/admin/backups/status",auth,async(req,res)=>{const config=oauthConfig(),authData=await readGoogleAuth();let files=[],error="";const connected=Boolean(config.configured&&authData.refreshToken);if(connected)try{files=await listDriveBackups()}catch(e){error=e.message}res.set("Cache-Control","no-store");res.json({configured:config.configured,connected:connected&&!error,error,count:files.length,lastBackup:files[0]||null,nextScheduled:backupSchedule.nextLocal,lastScheduledBackup,connectedAt:authData.connectedAt||null,storagePersistent:DATA_DIR!==__dirname})});
app.get("/api/admin/backups",auth,async(req,res)=>{try{res.set("Cache-Control","no-store");res.json({files:await listDriveBackups()})}catch(e){res.status(503).json({error:e.message})}});
app.post("/api/admin/backups/run",auth,async(req,res)=>{try{res.json(await runBackup("manual"))}catch(e){res.status(503).json({error:e.message})}});
app.post("/api/admin/backups/restore",auth,async(req,res)=>{try{const id=cleanText(req.body?.fileId,200);if(!id)throw Error("Backup file ID is required.");res.json(await restoreDriveBackup(id))}catch(e){res.status(400).json({error:e.message})}});
app.post("/api/cron/backup",async(req,res)=>{try{const expected=String(process.env.BACKUP_CRON_SECRET||"");if(!expected||!safe(req.headers.authorization||"",`Bearer ${expected}`))return res.status(401).json({error:"Unauthorised"});res.json(await runBackup("cron"))}catch(e){res.status(503).json({error:e.message})}});

app.get("/api/admin/system-health",auth,async(req,res)=>{
  const [menuMap,backups]=await Promise.all([read(F.map),listLocalBackups()]);
  res.set("Cache-Control","no-store");res.json({version:VERSION,persistent:DATA_DIR!==__dirname,dataDir:DATA_DIR,backups:{count:backups.length,latest:backups[0]||null},mapping:mappingHealth(menuMap)});
});
app.get("/api/admin/local-backups",auth,async(req,res)=>{res.set("Cache-Control","no-store");res.json({files:await listLocalBackups()})});
app.post("/api/admin/local-backups/run",auth,async(req,res)=>{try{res.json(await createLocalBackup(req.body?.reason||"manual"))}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/admin/local-backups/:name/download",auth,async(req,res)=>{const name=path.basename(req.params.name);res.download(path.join(LOCAL_BACKUP_DIR,name),name)});
app.post("/api/admin/local-backups/:name/restore",auth,async(req,res)=>{try{res.json(await restoreLocalBackupFile(req.params.name))}catch(e){res.status(400).json({error:e.message})}});

app.get("/api/admin/catalog",auth,async(req,res)=>{
  try{
    const s=await read(F.settings);
    const os=await catalog(req.query.refresh==="1");
    const activeOnly=req.query.activeOnly!=="0";
    const rows=os.filter(x=>x.type==="ITEM_VARIATION")
      .map(x=>({id:x.id,...live(os,x.id,s.square.locationId)}))
      .filter(x=>!activeOnly||x.active)
      .sort((a,b)=>(a.itemName+a.variationName).localeCompare(b.itemName+b.variationName));
    res.json(rows);
  }catch(e){res.status(503).json({error:e.message})}
});
app.get("/api/admin/mapping-audit",auth,async(req,res)=>{
  try{
    const menuMap=await read(F.map),objects=await catalog(req.query.refresh==="1");
    const rows=Object.entries(menuMap.sections||{}).flatMap(([section,items])=>items.map(row=>{
      const explicit=Boolean(row.squareVariationId||(row.squareVariationIds||[]).length);
      const matches=mappingCandidates(objects,row,section);
      return{section,menuId:row.id,menuName:row.name,explicit,matches,status:explicit?"mapped":matches.length?"auto-matched":"unmapped"};
    }));
    res.set("Cache-Control","no-store");res.json({rows,checkedAt:new Date().toISOString()});
  }catch(e){res.status(503).json({error:e.message})}
});
app.post("/api/admin/auto-map",auth,async(req,res)=>{
  try{
    const menuMap=await read(F.map),objects=await catalog(true);let mapped=0,unmapped=0;
    for(const [section,items] of Object.entries(menuMap.sections||{}))for(const row of items){
      if(row.squareVariationId||(row.squareVariationIds||[]).length)continue;
      const ids=resolveVariationIds(objects,row,section);
      if(ids.length===1){row.squareVariationId=ids[0];mapped++}
      else if(ids.length>1){row.squareVariationIds=ids;mapped++}
      else unmapped++;
    }
    await write(F.map,menuMap);liveCache.objects=null;cache.expires=0;
    res.json({ok:true,mapped,unmapped,map:menuMap});
  }catch(e){res.status(503).json({error:e.message})}
});
app.get("/api/admin/live-status",auth,async(req,res)=>{
  try{
    const [settings,menuMap]=await Promise.all([read(F.settings),read(F.map)]);
    const ids=mappedIds(menuMap);
    const objects=await liveCatalogObjects(ids,req.query.refresh==="1");
    const rows=Object.entries(menuMap.sections||{}).flatMap(([section,items])=>items.flatMap(row=>rowVariationIds(row).map(id=>{
      const state=live(objects,id,settings.square.locationId);
      return{menuId:row.id,menuName:row.name,section,squareVariationId:id,...state};
    })));
    res.set("Cache-Control","no-store");
    res.json({locationId:settings.square.locationId,checkedAt:new Date().toISOString(),rows});
  }catch(e){res.status(503).json({error:e.message})}
});


function canonicalSectionName(name){
  const key=String(name||"").trim().toLowerCase().replace(/[’']/g,"").replace(/[^a-z0-9]+/g," ").trim();
  const aliases={
    "freshfish":"freshFish","fresh fish":"freshFish","beer battered":"freshFish","beer battered fish":"freshFish","battered":"freshFish",
    "crumbed":"crumbed","crumbed fish":"crumbed",
    "grilled":"grilled","grilled fish":"grilled",
    "addchips":"addChips","add chips":"addChips",
    "burgers":"burgers","burger":"burgers",
    "tacos":"tacos","taco":"tacos",
    "packs":"packs","pack":"packs","meal packs":"packs","meal pack":"packs","fishermans basket":"packs",
    "snacks":"snacks","snack":"snacks",
    "chips":"chips","chip":"chips",
    "sauces":"sauces","sauce":"sauces"
  };
  return aliases[key]||name;
}
function canonicaliseSections(rawSections){
  const canonical={freshFish:[],crumbed:[],grilled:[],addChips:[],burgers:[],tacos:[],packs:[],snacks:[],chips:[],sauces:[]};
  for(const [rawName,rows] of Object.entries(rawSections||{})){
    const name=canonicalSectionName(rawName);
    if(!Array.isArray(canonical[name]))canonical[name]=[];
    if(Array.isArray(rows))canonical[name].push(...rows);
  }
  return canonical;
}

function isFishermansBasket(row){
  return /fisherm(?:an|en)[’']?s?\s+basket/i.test(String(row?.name||""));
}
function moveBasketToPacks(sections){
  const candidates=[];
  for(const [section,rows] of Object.entries(sections)){
    if(!Array.isArray(rows))continue;
    const keep=[];
    for(const row of rows){
      if(section!=="packs"&&isFishermansBasket(row))candidates.push({...row,_displaySection:"packs",section:"packs"});
      else keep.push(row);
    }
    sections[section]=keep;
  }
  sections.packs=Array.isArray(sections.packs)?sections.packs:[];
  for(const row of sections.packs)row._displaySection="packs",row.section="packs";
  if(candidates.length){
    candidates.sort((a,b)=>String(b.detail||"").length-String(a.detail||"").length);
    const chosen=candidates[0];
    const exists=sections.packs.some(x=>isFishermansBasket(x));
    if(!exists)sections.packs.unshift(chosen);
  }
  return sections;
}

app.get("/api/menu",async(req,res)=>{
  const [s,c,m]=await Promise.all([read(F.settings),read(F.content),read(F.map)]);
  let os=[],squareOnline=true,autoIdsByRow=new Map();
  try{
    const catalogue=await catalog();
    for(const [section,rows] of Object.entries(m.sections||{}))for(const row of rows){
      const ids=resolveVariationIds(catalogue,row,section);
      if(ids.length)autoIdsByRow.set(row.id,ids);
    }
    const liveIds=[...mappedIds(m),...autoIdsByRow.values()].flat();
    os=await liveCatalogObjects(liveIds);
  }catch{squareOnline=false}
  const canonicalMapSections=canonicaliseSections(m.sections);
  const sections={};
  for(const [name,rows] of Object.entries(canonicalMapSections)){
    sections[name]=rows.map(row=>{
      const o=c.overrides[row.id]||{};
      const explicitIds=rowVariationIds(row);
      const ids=explicitIds.length?explicitIds:(autoIdsByRow.get(row.id)||[]);
      const l=combinedLive(ids.map(id=>live(os,id,s.square.locationId)));
      return{
        ...row,
        name:o.name||row.name,
        price:(!row.priceText&&l?.price!=null)?l.price:row.price,
        soldOut:Boolean(o.forceSoldOut||l?.soldOut),
        manualSoldOut:Boolean(o.forceSoldOut),
        squareSoldOut:Boolean(l?.soldOut),
        squareAutoMatched:Boolean(!rowVariationIds(row).length&&ids.length),
        matchedSquareVariations:ids.length,
        hidden:o.hidden??false,
        badge:o.badge||""
      };
    }).filter(x=>!x.hidden);
  }
  moveBasketToPacks(sections);
  for(const [section,rows] of Object.entries(sections))for(const row of rows){row.section=section;row._displaySection=section}
  res.set("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma","no-cache");
  res.json({settings:s,sections,squareOnline,lastSquareCheck:new Date().toISOString(),refreshSeconds:10,promotions:c.promotions.filter(p=>active(p,s.business.timezone))});
});
app.get("/health",(req,res)=>res.json({ok:true,version:VERSION}));

app.get("/",(req,res)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate");res.redirect("/main")});
app.get("/main",(req,res)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate");res.sendFile(path.join(__dirname,"menu-main.html"))});
app.get("/snacks",(req,res)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate");res.sendFile(path.join(__dirname,"menu-snacks.html"))});
app.get("/legacy",(req,res)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate");res.sendFile(path.join(__dirname,"menu.html"))});
app.get("/admin",(req,res)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate");res.sendFile(path.join(__dirname,"admin.html"))});
for(const f of ["menu.css","menu.js","menu-main.css","menu-main.js","menu-snacks.css","menu-snacks.js","admin.css","admin.js","sauce-bottle-reference.jpg","sauce-panel.jpg"]){app.get("/"+f,(req,res)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate");res.sendFile(path.join(__dirname,f))})}
app.use((req,res)=>res.status(404).send("Not found"));

app.listen(PORT,"0.0.0.0",()=>console.log(`BHFC Menu Manager V${VERSION} running on port ${PORT}`));


let lastLocalBackupDate="";
async function scheduledLocalBackup(){
  try{const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney"}).format(new Date());if(day!==lastLocalBackupDate){await createLocalBackup("daily");lastLocalBackupDate=day}}catch(e){console.error("Local backup failed:",e)}
}
setTimeout(scheduledLocalBackup,60_000);setInterval(scheduledLocalBackup,60*60*1000);
