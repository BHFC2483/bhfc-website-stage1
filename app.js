const ORDER_URL="https://www.brunswickheadsfishandchippery.com.au/order-online";
document.querySelectorAll("[data-order-link]").forEach(a=>a.href=ORDER_URL);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
async function loadGoogle(){
  try{
    const p=await(await fetch("/api/google-place",{cache:"no-store"})).json();
    const address=document.querySelector("#google-address");
    if(address&&p.formattedAddress)address.innerHTML=esc(p.formattedAddress).replace(", Brunswick Heads","<br>Brunswick Heads");
    if(p.rating){const el=document.querySelector("#google-rating");if(el){el.hidden=false;el.textContent=`★ ${Number(p.rating).toFixed(1)}${p.userRatingCount?` · ${Number(p.userRatingCount).toLocaleString("en-AU")} Google reviews`:""}`}}
    const status=document.querySelector("#open-status");if(status)status.textContent=p.openNow===true?"Open now":p.openNow===false?"Closed now":"Open daily";
    const hours=document.querySelector("#weekly-hours-list");if(hours)hours.innerHTML=(p.weekdayDescriptions||[]).map(x=>`<span>${esc(x)}</span>`).join("");
    const directions=document.querySelector("#google-directions");if(directions&&p.googleMapsUri)directions.href=p.googleMapsUri;
  }catch{}
  try{
    const c=await(await fetch("/api/google-map-config")).json();
    const map=document.querySelector("#google-map");
    if(map)map.src=c.configured?`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(c.embedKey)}&q=place_id:${encodeURIComponent(c.placeId)}`:"https://www.google.com/maps?q=Brunswick+Heads+Fish+and+Chippery&output=embed";
  }catch{}
}
loadGoogle();


// RC4: scale the fixed 1920×1080 TV renderer to the available website width.
function fitLandscapeMenu(){
  const frame=document.getElementById("landscape-menu-frame");
  const iframe=document.getElementById("live-landscape-menu");
  if(!frame||!iframe)return;
  const scale=frame.clientWidth/1920;
  iframe.style.transform=`scale(${scale})`;
}
window.addEventListener("load",fitLandscapeMenu);
window.addEventListener("resize",fitLandscapeMenu);
if("ResizeObserver" in window){
  const frame=document.getElementById("landscape-menu-frame");
  if(frame)new ResizeObserver(fitLandscapeMenu).observe(frame);
}
