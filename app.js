
const ORDER_URL = "https://www.brunswickheadsfishandchippery.com.au/order-online";
document.querySelectorAll("[data-order-link]").forEach(a=>a.href=ORDER_URL);

const header=document.querySelector(".site-header");
addEventListener("scroll",()=>header.classList.toggle("scrolled",scrollY>35),{passive:true});

const toggle=document.querySelector(".nav-toggle");
const nav=document.querySelector("#site-nav");
toggle.addEventListener("click",()=>{
  const open=nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded",String(open));
});
nav.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>{
  nav.classList.remove("open");
  toggle.setAttribute("aria-expanded","false");
}));

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[c]));

const preferredOrder=[
  "Beer Battered Fish",
  "Crumbed Fish",
  "Grilled Fish",
  "Burgers & Tacos",
  "Snacks",
  "Chips"
];

function classifySection(section){
  const raw=String(section||"").trim();
  const compact=raw.toLowerCase().replace(/[^a-z0-9]/g,"");

  // Match the Menu Manager / TV menu section keys exactly.
  if(compact==="freshfish" || compact.includes("beerbatter") || compact==="fresh") return "Beer Battered Fish";
  if(compact==="crumbed" || compact.includes("crumb")) return "Crumbed Fish";
  if(compact==="grilled" || compact.includes("grill") || compact==="addchips") return "Grilled Fish";
  if(compact==="burgers" || compact==="tacos" || compact.includes("burger") || compact.includes("taco")) return "Burgers & Tacos";
  if(compact==="snacks" || compact.includes("snack")) return "Snacks";
  if(compact==="chips" || compact.includes("chip")) return "Chips";
  if(compact.includes("drink")) return null;
  return raw.replace(/[-_]+/g," ").replace(/\w/g,c=>c.toUpperCase());
}

let menuData=null;
let activeCategory="all";

function rowMarkup(item){
  const detail=item.detail?`<small>${esc(item.detail)}</small>`:"";
  const price=item.soldOut?"SOLD OUT":esc(item.priceText??item.price??"");
  return `<div class="web-menu-row ${item.soldOut?"sold-out":""}">
    <span class="label">${esc(item.name)}${item.origin?`<sup>${esc(item.origin)}</sup>`:""}${detail}</span>
    <span class="dots" aria-hidden="true"></span>
    <span class="price">${price}</span>
  </div>`;
}

function groupedMenu(){
  const groups=new Map();
  Object.entries(menuData?.sections||{}).forEach(([section,items])=>{
    const label=classifySection(section);
    if(!label) return;
    if(!groups.has(label)) groups.set(label,[]);
    groups.get(label).push(...items);
  });
  return preferredOrder
    .filter(name=>groups.has(name))
    .map(name=>[name,groups.get(name)]);
}

function renderMenu(){
  const ordered=groupedMenu();
  const tabs=document.querySelector("#menu-tabs");
  const names=["all",...ordered.map(([name])=>name)];
  tabs.innerHTML=names.map(name=>`<button type="button" class="${name===activeCategory?"active":""}" data-category="${esc(name)}">${name==="all"?"All Menu":esc(name)}</button>`).join("");
  tabs.querySelectorAll("button").forEach(button=>button.addEventListener("click",()=>{
    activeCategory=button.dataset.category;
    renderMenu();
  }));

  const cards=[];
  for(const [name,items] of ordered){
    if(activeCategory!=="all"&&activeCategory!==name) continue;
    cards.push(`<article class="menu-card"><h3>${esc(name)}</h3>${items.map(rowMarkup).join("")}</article>`);
  }
  document.querySelector("#web-menu").innerHTML=cards.join("")||'<div class="loading">No menu items available.</div>';
}

async function loadMenu(){
  try{
    const response=await fetch("/api/live-menu",{cache:"no-store"});
    if(!response.ok) throw new Error("Menu unavailable");
    menuData=await response.json();
    renderMenu();
  }catch(error){
    document.querySelector("#web-menu").innerHTML='<div class="loading">Use Order Online to view the current ordering menu.</div>';
  }
}
loadMenu();
setInterval(loadMenu,30000);

function formatGoogleTime(v){if(!v)return"";const d=new Date(v);return Number.isNaN(d.getTime())?"":d.toLocaleTimeString("en-AU",{hour:"numeric",minute:"2-digit"})}
function cleanAddress(a){return String(a||"").replace(", Australia","").replace(/,\s*NSW\s*2483/i,",<br>Brunswick Heads NSW 2483")}
async function loadGoogleBusiness(){try{const r=await fetch("/api/google-place",{cache:"no-store"});const p=await r.json();const a=document.querySelector("#google-address");if(a&&p.formattedAddress)a.innerHTML=cleanAddress(p.formattedAddress);const s=document.querySelector("#open-status"),t=document.querySelector("#today-hours");if(s){if(p.openNow===true){s.textContent="Open now";s.className="is-open"}else if(p.openNow===false){s.textContent="Closed now";s.className="is-closed"}else s.textContent="Open daily"}if(t){const c=formatGoogleTime(p.nextCloseTime),o=formatGoogleTime(p.nextOpenTime);t.textContent=p.openNow===true&&c?`Closes at ${c}`:p.openNow===false&&o?`Opens at ${o}`:"11:30am–7:00pm"}const list=document.querySelector("#weekly-hours-list");if(list&&Array.isArray(p.weekdayDescriptions)&&p.weekdayDescriptions.length)list.innerHTML=p.weekdayDescriptions.map(x=>`<span>${esc(x)}</span>`).join("");const rating=document.querySelector("#google-rating");if(rating&&p.rating){rating.hidden=false;rating.textContent=`★ ${Number(p.rating).toFixed(1)}${p.userRatingCount?` · ${Number(p.userRatingCount).toLocaleString("en-AU")} Google reviews`:""}`}const d=document.querySelector("#google-directions");if(d&&p.googleMapsUri)d.href=p.googleMapsUri}catch(e){console.warn("Google business details unavailable",e)}}
loadGoogleBusiness();
