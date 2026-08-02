
const ORDER_URL = "https://www.brunswickheadsfishandchippery.com.au/order-online";
document.querySelectorAll("[data-order-link]").forEach(a=>a.href=ORDER_URL);

const header=document.querySelector(".site-header");
addEventListener("scroll",()=>header.classList.toggle("scrolled",scrollY>35),{passive:true});
const toggle=document.querySelector(".nav-toggle"),nav=document.querySelector("#site-nav");
toggle.addEventListener("click",()=>{const open=nav.classList.toggle("open");toggle.setAttribute("aria-expanded",String(open))});
nav.querySelectorAll("a").forEach(a=>a.onclick=()=>{nav.classList.remove("open");toggle.setAttribute("aria-expanded","false")});

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const families=[
 {label:"Fresh fish",keys:["fresh"]},
 {label:"Burgers & tacos",keys:["burger","taco"]},
 {label:"Snacks & chips",keys:["snack","chip"]}
];
let data=null,active="all";
const familyFor=s=>families.find(f=>f.keys.some(k=>s.toLowerCase().includes(k)))?.label||"More";
function row(item){
 const detail=item.detail?`<small>${esc(item.detail)}</small>`:"";
 const price=item.soldOut?"SOLD OUT":esc(item.priceText??item.price??"");
 return `<div class="web-menu-row ${item.soldOut?"sold-out":""}"><span class="label">${esc(item.name)}${item.origin?`<sup>${esc(item.origin)}</sup>`:""}${detail}</span><span class="dots"></span><span class="price">${price}</span></div>`;
}
function render(){
 const groups=new Map();
 Object.entries(data?.sections||{}).forEach(([section,items])=>{const f=familyFor(section);if(!groups.has(f))groups.set(f,[]);groups.get(f).push(...items)});
 const tabs=document.querySelector("#menu-tabs");
 const names=["all",...groups.keys()];
 tabs.innerHTML=names.map(n=>`<button class="${n===active?"active":""}" data-name="${esc(n)}">${n==="all"?"All menu":esc(n)}</button>`).join("");
 tabs.querySelectorAll("button").forEach(b=>b.onclick=()=>{active=b.dataset.name;render()});
 const cards=[];
 for(const [name,items] of groups){if(active!=="all"&&active!==name)continue;cards.push(`<article class="menu-card"><h3>${esc(name)}</h3>${items.map(row).join("")}</article>`)}
 document.querySelector("#web-menu").innerHTML=cards.join("")||'<div class="loading">No menu items available.</div>';
}
async function load(){
 const status=document.querySelector("#menu-status");
 try{
  const r=await fetch("/api/live-menu",{cache:"no-store"});if(!r.ok)throw Error();
  data=await r.json();status.className="live-status online";status.innerHTML="<span></span> Live now";render();
 }catch{status.className="live-status offline";status.innerHTML="<span></span> Menu connection unavailable";document.querySelector("#web-menu").innerHTML='<div class="loading">Use Order Online to view the current ordering menu.</div>'}
}
load();setInterval(load,30000);
