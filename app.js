const ORDER_URL="https://www.brunswickheadsfishandchippery.com.au/order-online";
document.querySelectorAll("[data-order-link]").forEach(a=>a.href=ORDER_URL);

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const SECTION_ORDER=["Beer Battered Fish","Crumbed Fish","Grilled Fish","Add Chips","Burgers","Tacos","Meal Packs","Snacks","Chips"];

function classify(section,itemName=""){
  const s=String(section||"").toLowerCase();
  const n=String(itemName||"").toLowerCase();
  if(s.includes("drink"))return null;
  if(n.includes("fisherman")||s.includes("pack")||s.includes("basket"))return "Meal Packs";
  if(s.includes("crumb"))return "Crumbed Fish";
  if(s.includes("grill"))return "Grilled Fish";
  if(s.includes("add chip"))return "Add Chips";
  if(s.includes("taco"))return "Tacos";
  if(s.includes("burger"))return "Burgers";
  if(s.includes("snack"))return "Snacks";
  if(s==="chips"||s.includes("chip"))return "Chips";
  if(s.includes("fresh fish")||s.includes("batter"))return "Beer Battered Fish";
  return String(section||"").replace(/[-_]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

function itemDescription(i){
  return i.detail || i.description || i.displayDescription || i.menuDescription || "";
}

function itemOrigin(i){
  const raw=i.origin || i.originCode || i.countryOfOrigin || i.countryOrigin || "";
  const value=String(raw).trim().toUpperCase();
  if(["A","I","M"].includes(value))return value;
  if(value.startsWith("AUSTRAL"))return "A";
  if(value.startsWith("IMPORT"))return "I";
  if(value.startsWith("MIX"))return "M";
  return "";
}

function row(i){
  const description=itemDescription(i);
  const origin=itemOrigin(i);
  const originMarkup=origin?`<sup class="origin-code" aria-label="Seafood origin ${esc(origin)}">${esc(origin)}</sup>`:"";
  const descriptionMarkup=description?`<small class="item-description">${esc(description)}</small>`:"";
  return `<div class="menu-row ${i.soldOut?"sold-out":""}">
    <span class="name"><span class="item-title">${esc(i.name)}${originMarkup}</span>${descriptionMarkup}</span>
    <span class="dots" aria-hidden="true"></span>
    <span class="price">${i.soldOut?"SOLD OUT":esc(i.priceText??i.price??"")}</span>
  </div>`;
}

async function loadMenu(){
  try{
    const r=await fetch("/api/live-menu",{cache:"no-store"});
    if(!r.ok)throw Error();
    const data=await r.json();
    const groups=new Map();
    Object.entries(data.sections||{}).forEach(([section,items])=>items.forEach(item=>{
      const label=classify(section,item.name);
      if(!label)return;
      if(!groups.has(label))groups.set(label,[]);
      groups.get(label).push(item);
    }));
    const ordered=[...groups.entries()].sort((a,b)=>(SECTION_ORDER.indexOf(a[0])<0?999:SECTION_ORDER.indexOf(a[0]))-(SECTION_ORDER.indexOf(b[0])<0?999:SECTION_ORDER.indexOf(b[0])));
    document.querySelector("#web-menu").innerHTML=ordered.map(([name,items])=>`<section class="menu-section-block"><h3>${esc(name)}</h3>${items.map(row).join("")}</section>`).join("")||"<div>No menu items available.</div>";
  }catch{
    document.querySelector("#web-menu").innerHTML="<div>Use Order Online to view the current menu.</div>";
  }
}

async function loadGoogle(){
  try{
    const p=await(await fetch("/api/google-place",{cache:"no-store"})).json();
    if(p.formattedAddress)document.querySelector("#google-address").innerHTML=esc(p.formattedAddress).replace(", Brunswick Heads","<br>Brunswick Heads");
    if(p.rating){const el=document.querySelector("#google-rating");el.hidden=false;el.textContent=`★ ${Number(p.rating).toFixed(1)}${p.userRatingCount?` · ${Number(p.userRatingCount).toLocaleString("en-AU")} Google reviews`:""}`}
    document.querySelector("#open-status").textContent=p.openNow===true?"Open now":p.openNow===false?"Closed now":"Open daily";
    document.querySelector("#weekly-hours-list").innerHTML=(p.weekdayDescriptions||[]).map(x=>`<span>${esc(x)}</span>`).join("");
    if(p.googleMapsUri)document.querySelector("#google-directions").href=p.googleMapsUri;
  }catch{}
  try{
    const c=await(await fetch("/api/google-map-config")).json();
    document.querySelector("#google-map").src=c.configured?`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(c.embedKey)}&q=place_id:${encodeURIComponent(c.placeId)}`:"https://www.google.com/maps?q=Brunswick+Heads+Fish+and+Chippery&output=embed";
  }catch{}
}

loadMenu();
loadGoogle();
setInterval(loadMenu,30000);
