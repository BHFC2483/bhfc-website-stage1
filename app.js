
const ORDER_URL = window.BHFC_ORDER_URL || "https://www.brunswickheadsfishandchippery.com.au/order-online";
document.querySelectorAll("[data-order-link]").forEach(a => a.href = ORDER_URL);

const header = document.querySelector(".site-header");
addEventListener("scroll", () => header.classList.toggle("scrolled", scrollY > 35), {passive:true});

const toggle = document.querySelector(".nav-toggle");
const nav = document.querySelector("#site-nav");
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  toggle.setAttribute("aria-expanded", String(open));
});
nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
  nav.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
}));

document.querySelectorAll(".feature-video").forEach(card => {
  const video = card.querySelector("video");
  const button = card.querySelector(".video-control");
  button.addEventListener("click", async () => {
    if (video.paused) {
      await video.play();
      button.textContent = "Pause";
    } else {
      video.pause();
      button.textContent = "Play";
    }
  });
});

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[char]));

const prettySection = name => name
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, c => c.toUpperCase());

const sectionFamilies = [
  {label:"Fresh fish", keys:["fresh"]},
  {label:"Burgers & tacos", keys:["burger","taco"]},
  {label:"Snacks & chips", keys:["snack","chip"]},
];

let liveData = null;
let activeFamily = "all";

function rowMarkup(item) {
  const detail = item.detail ? `<small>${esc(item.detail)}</small>` : "";
  const price = item.soldOut ? "SOLD OUT" : esc(item.priceText || (item.price != null ? String(item.price) : ""));
  return `<div class="web-menu-row ${item.soldOut ? "sold-out" : ""}">
    <span class="label">${esc(item.name)}${item.origin ? `<sup>${esc(item.origin)}</sup>` : ""}${detail}</span>
    <span class="dots" aria-hidden="true"></span>
    <span class="price">${price}</span>
  </div>`;
}

function familyFor(section) {
  const lower = section.toLowerCase();
  const found = sectionFamilies.find(f => f.keys.some(k => lower.includes(k)));
  return found?.label || "More";
}

function renderMenu() {
  if (!liveData) return;
  const entries = Object.entries(liveData.sections || {});
  const grouped = new Map();
  for (const [section, items] of entries) {
    const family = familyFor(section);
    if (!grouped.has(family)) grouped.set(family, []);
    grouped.get(family).push({section, items});
  }

  const tabs = document.querySelector("#menu-tabs");
  const families = ["all", ...grouped.keys()];
  tabs.innerHTML = families.map(f => `<button type="button" class="${f === activeFamily ? "active" : ""}" data-family="${esc(f)}">${f === "all" ? "All menu" : esc(f)}</button>`).join("");
  tabs.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    activeFamily = button.dataset.family;
    renderMenu();
  }));

  const cards = [];
  for (const [family, sections] of grouped) {
    if (activeFamily !== "all" && family !== activeFamily) continue;
    const content = sections.map(({section, items}) =>
      `<div class="menu-subsection" data-source-section="${esc(section)}">${items.map(rowMarkup).join("")}</div>`
    ).join("");
    cards.push(`<article class="menu-card"><h3>${esc(family)}</h3>${content}</article>`);
  }
  document.querySelector("#web-menu").innerHTML = cards.join("") || `<div class="menu-loading">No menu items are currently available.</div>`;
}

async function loadMenu() {
  const status = document.querySelector("#menu-status");
  try {
    const response = await fetch("/api/live-menu", {cache:"no-store"});
    if (!response.ok) throw new Error("Menu unavailable");
    liveData = await response.json();
    status.className = "menu-status online";
    status.innerHTML = `<span></span> Live · updated ${new Date(liveData.lastSquareCheck || Date.now()).toLocaleTimeString("en-AU",{hour:"numeric",minute:"2-digit"})}`;
    renderMenu();
  } catch (error) {
    status.className = "menu-status offline";
    status.innerHTML = `<span></span> Live menu temporarily unavailable`;
    document.querySelector("#web-menu").innerHTML = `<div class="menu-loading">Please use “Order online” to view the current ordering menu.</div>`;
  }
}
loadMenu();
setInterval(loadMenu, 30000);
