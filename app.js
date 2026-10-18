// Forkcast: tastes → a week of meals → shopping list → compare every UK supermarket → fill the
// chosen trolley in your own browser → cook. State lives in this browser (localStorage "forkcast").
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = n => "£" + (+n || 0).toFixed(2);
const STEPS = ["tastes", "week", "list", "compare", "order", "recipes"];

let S = { step: 0, answers: {}, seed: 1, keep: {}, plan: null, list: null, nutrition: null, job: null, pick: null, swaps: {} };
try { S = { ...S, ...JSON.parse(localStorage.getItem("forkcast") || "{}") }; } catch {}
const save = () => { try { localStorage.setItem("forkcast", JSON.stringify(S)); } catch {} };
let C = null, RECIPES = {}, OPEN = null, BOOKMARK = null, POLL = null;

// On the Mac mini the server plans and searches live. The public site (GitHub Pages) has no server:
// it plans in the page with the same engine and prices from the daily snapshot in data/prices/.
const STATIC = !!window.FORKCAST_STATIC;
const PRICES = {}, LOCALJOBS = {};
async function getJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(r.statusText); return r.json(); }
async function localApi(path, body) {
  if (path === "/api/content") return getJSON("data/content.json");
  if (path === "/api/plan") { const pl = E.plan(C.recipes, body.prefs, body.seed || 1, body.keep || {}); return { plan: pl, list: E.list(pl, C.recipes, C.ingredients, body.prefs), nutrition: E.nutrition(pl, C.recipes) }; }
  if (path === "/api/list") return { list: E.list(body.plan, C.recipes, C.ingredients, body.prefs), nutrition: E.nutrition(body.plan, C.recipes) };
  if (path === "/api/compare") {
    const shops = await getJSON("data/retailers.json"), todo = body.list.filter(l => !l.skip), job = { id: "local" + Date.now(), total: todo.length, retailers: {}, finished: Date.now() };
    await Promise.all(shops.map(async r => {
      const px = PRICES[r.id] || (PRICES[r.id] = await getJSON(`data/prices/${r.id}.json`).catch(() => ({ items: {} })));
      const results = {}; for (const l of todo) results[l.item] = px.items[l.item] || [];
      job.retailers[r.id] = { id: r.id, name: r.name, inStoreOnly: r.inStoreOnly, canFill: r.canFill, trolleyUrl: r.trolleyUrl, fillStatus: r.fillStatus,
        pricedAt: px.at, done: todo.length, state: "done", ...E.basket(body.list, results, C.ingredients, body.prefs) };
    }));
    return (LOCALJOBS[job.id] = job);
  }
  if (path.startsWith("/api/compare/")) return LOCALJOBS[path.split("/").pop()] || S.job;
  throw new Error("not available on the public site");
}
async function api(path, body) {
  if (STATIC) return localApi(path, body);
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---------------------------------------------------------------- answers → prefs
function prefs() {
  const a = S.answers, q = id => a[id] ?? (C.questionnaire.find(x => x.id === id) || {}).default;
  return {
    adults: +q("adults") || 2, children: +q("children") || 0, meals: S.meals || PRESETS["weeknight-weekend"],
    diet: q("diet") || "none", mustBe: q("mustBe") || [], allergies: q("allergies") || [], cuisines: q("cuisines") || {}, proteins: q("proteins") || {},
    spice: q("spice") ?? 2, weeknightTime: +q("weeknightTime") || 45, confidence: +q("confidence") || 2, kit: q("kit") || [], goal: q("goal") || "balanced",
    budget: +q("budget") || 0, style: q("style") || "auto", loyalty: q("loyalty") === true || q("loyalty") === "yes", variety: q("variety") || "variety",
    avoid: (q("avoid") || []).map(s => String(s).toLowerCase()), pantryHave: S.pantryHave || [], pantryAll: S.pantryAll ?? true,
    favourites: S.favs || [], ratings: S.ratings || {},
  };
}

// ---------------------------------------------------------------- render
function go(n) { if (n > maxStep()) return; S.step = n; OPEN = null; save(); render(); scrollTo(0, 0); }
const maxStep = () => !S.plan ? 0 : !S.list ? 1 : !S.job ? 2 : !S.pick ? 3 : 5;
function render() {
  document.querySelectorAll("#steps button").forEach(b => { const n = +b.dataset.s;
    b.classList.toggle("on", n === S.step); b.classList.toggle("done", n < S.step && n <= maxStep()); b.disabled = n > maxStep();
    if (n === S.step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
  if (!C) { $("#view").innerHTML = `<p class="dim" style="margin-top:30px">Loading…</p>`; return; }
  $("#view").innerHTML = [tastes, week, list, compare, order, recipes][S.step]();
}
document.querySelectorAll("#steps button").forEach(b => b.onclick = () => go(+b.dataset.s));
const sec = (t, meta = "") => `<div class="sec"><h2>${t}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</div>`;
const foot = (back, next, label, dis) => `<div class="foot">${back != null ? `<button onclick="go(${back})">‹ Back</button>` : "<span></span>"}${next ? `<button class="go" ${dis ? "disabled" : ""} onclick="${next}">${label} ›</button>` : ""}</div>`;

// ---------------------------------------------------------------- 1. tastes
function setA(id, v) { S.answers[id] = v; save(); }
function toggleA(id, v) { const cur = new Set(S.answers[id] ?? (C.questionnaire.find(x => x.id === id).default || [])); cur.has(v) ? cur.delete(v) : cur.add(v); setA(id, [...cur]); render(); }
function gridA(id, row, v) { const cur = { ...(S.answers[id] || C.questionnaire.find(x => x.id === id).default || {}) }; cur[row] = v; setA(id, cur); render(); }
function val(q) { return S.answers[q.id] ?? q.default; }
function question(q) {
  const v = val(q), o = q.options || [];
  let body = "";
  const same = (a, b) => String(a) === String(b);
  if (q.type === "single") body = `<div class="chips">${o.map(x => `<button class="chip" aria-pressed="${same(v, x.value)}" onclick='setA(${JSON.stringify(q.id)},${JSON.stringify(x.value)});render()'>${esc(x.label)}</button>`).join("")}</div>`;
  else if (q.type === "multi" || q.type === "chips") body = `<div class="chips">${o.map(x => `<button class="chip" aria-pressed="${(v || []).map(String).includes(String(x.value))}" onclick='toggleA(${JSON.stringify(q.id)},${JSON.stringify(x.value)})'>${esc(x.label)}</button>`).join("")}</div>`;
  else if (q.type === "number") body = `<div class="row"><input type="number" inputmode="decimal" min="${q.min ?? 0}" max="${q.max ?? 999}" step="${q.step ?? 1}" value="${esc(v ?? "")}" aria-label="${esc(q.title)}" onchange='setA(${JSON.stringify(q.id)},this.value===""?null:Number(this.value))'>${q.unit ? `<span class="dim small">${esc(q.unit)}</span>` : ""}</div>`;
  else if (q.type === "scale") { const lo = q.min ?? 0, hi = q.max ?? 3, labels = q.labels || o.map(x => x.label);
    body = `<div class="scale"><input type="range" min="${lo}" max="${hi}" step="1" value="${v ?? lo}" aria-label="${esc(q.title)}" oninput='setA(${JSON.stringify(q.id)},Number(this.value));this.nextElementSibling.textContent=${JSON.stringify(labels)}[this.value-${lo}]||this.value'><span class="small" style="min-width:120px">${esc(labels[(v ?? lo) - lo] ?? v)}</span></div>`; }
  else if (q.type === "grid") { const opts = o.length ? o : [{ value: "love", label: "Love" }, { value: "fine", label: "Fine" }, { value: "no", label: "No" }];
    body = `<div class="gridq">${(q.rows || []).map(r => { const rv = (v || {})[r.value] ?? "fine";
      return `<span>${esc(r.label)}${r.count ? ` <span class="small dim num">${r.count}</span>` : ""}</span><span class="seg">${opts.map(x => `<button class="${x.value === "no" ? "no" : ""}" aria-pressed="${rv === x.value}" onclick='gridA(${JSON.stringify(q.id)},${JSON.stringify(r.value)},${JSON.stringify(x.value)})'>${esc(x.label)}</button>`).join("")}</span>`; }).join("")}</div>`; }
  return `<div class="q"><h3>${esc(q.title)}</h3>${q.help ? `<p class="help">${esc(q.help)}</p>` : ""}${body}</div>`;
}
// Which meals to plan: a day × meal grid. Tap a cell to cycle it: off → cook → (lunch only) leftovers.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MEALS = ["breakfast", "lunch", "dinner"];
const WK = d => d === "Sat" || d === "Sun";
const PRESETS = {
  "weeknight-weekend": ["Weeknight dinners + full weekend", d => WK(d) ? { breakfast: "cook", lunch: "cook", dinner: "cook" } : { dinner: "cook" }],
  "work-lunches": ["…plus leftovers for work lunches", d => WK(d) ? { breakfast: "cook", lunch: "cook", dinner: "cook" } : { lunch: "leftovers", dinner: "cook" }],
  "dinners": ["Dinners only", () => ({ dinner: "cook" })],
  "everything": ["Every meal", () => ({ breakfast: "cook", lunch: "cook", dinner: "cook" })],
};
for (const k in PRESETS) PRESETS[k] = Object.assign(Object.fromEntries(DAYS.map(d => [d, PRESETS[k][1](d)])), { label: PRESETS[k][0] });
const sameMeals = (a, b) => DAYS.every(d => MEALS.every(m => (a[d]?.[m] || "") === (b[d]?.[m] || "")));
function mealCell(d, m) {
  const cur = (S.meals || PRESETS["weeknight-weekend"])[d]?.[m] || "";
  const next = cur === "" ? "cook" : cur === "cook" && m === "lunch" ? "leftovers" : "";
  const meals = JSON.parse(JSON.stringify(S.meals || PRESETS["weeknight-weekend"]));
  meals[d] = { ...(meals[d] || {}) }; next ? meals[d][m] = next : delete meals[d][m];
  delete meals.label; S.meals = meals; save(); render();
}
function mealsHTML() {
  const M = S.meals || PRESETS["weeknight-weekend"];
  const n = { cook: 0, leftovers: 0 };
  DAYS.forEach(d => MEALS.forEach(m => { const v = M[d]?.[m]; if (v) n[v]++; }));
  return `<div class="q"><h3>Which meals do you want planned?</h3><p class="help">Tap to switch a meal on or off. Tap a lunch twice for <b>leftovers</b>: cook extra the night before and take it to work.</p>
    <div class="chips" style="margin-bottom:12px">${Object.entries(PRESETS).map(([k, v]) => `<button class="chip" aria-pressed="${sameMeals(M, v)}" onclick="S.meals=JSON.parse(JSON.stringify(PRESETS['${k}']));delete S.meals.label;save();render()">${esc(v.label)}</button>`).join("")}</div>
    <div class="mealgrid" role="grid" aria-label="Meals to plan"><span></span>${DAYS.map(d => `<span class="mg-d ${WK(d) ? "wk" : ""}">${d}</span>`).join("")}
    ${MEALS.map(m => `<span class="mg-m">${m[0].toUpperCase() + m.slice(1)}</span>${DAYS.map(d => { const v = M[d]?.[m] || "";
      return `<button class="mg-c ${v}" aria-pressed="${!!v}" aria-label="${d} ${m}: ${v || "off"}" onclick="mealCell('${d}','${m}')">${v === "cook" ? "✓" : v === "leftovers" ? "↺" : ""}</button>`; }).join("")}`).join("")}</div>
    <p class="small dim" style="margin-top:10px"><span class="num">${n.cook}</span> meals to cook${n.leftovers ? ` + <span class="num">${n.leftovers}</span> leftover lunches` : ""} a week. ✓ cook · ↺ leftovers from the night before</p></div>`;
}
// The hard rules (diet, must-be, allergies) decide which recipes are possible at all; the later
// questions then only offer choices that still exist among those, with how many meals each has.
function possible(skip) {
  const p = prefs(), d = p.diet;
  return C.recipes.filter(r => {
    if (d === "vegan" && !r.diet.includes("vegan")) return false;
    if (d === "vegetarian" && !(r.diet.includes("vegetarian") || r.diet.includes("vegan"))) return false;
    if (d === "pescatarian" && !(r.diet.includes("pescatarian") || r.diet.includes("vegetarian") || r.diet.includes("vegan"))) return false;
    if ((p.mustBe || []).some(m => !r.diet.includes(m))) return false;
    if ((p.allergies || []).some(a => r.allergens.includes(a))) return false;
    if (skip !== "cuisines" && p.cuisines[r.cuisine] === "no") return false;
    if (skip !== "proteins" && p.proteins[r.protein] === "no") return false;
    if (skip !== "spice" && r.spice > (p.spice ?? 3)) return false;
    return true;
  });
}
function refine(q) {
  if (q.id === "proteins" || q.id === "cuisines") {
    const key = q.id === "proteins" ? "protein" : "cuisine", pool = possible(q.id), n = {};
    pool.forEach(r => n[r[key]] = (n[r[key]] || 0) + 1);
    return { ...q, rows: (q.rows || []).filter(r => n[r.value]).map(r => ({ ...r, label: r.label, count: n[r.value] })) };
  }
  if (q.id === "avoid") {
    const pool = possible(), names = pool.map(r => r.name.toLowerCase() + " " + r.ingredients.map(i => i.item).join(" "));
    return { ...q, options: (q.options || []).filter(o => names.some(t => t.includes(String(o.value).toLowerCase().replace(/s$/, "")))) };
  }
  return q;
}
// ---------------------------------------------------------------- favourites, ratings, saved weeks
const isFav = id => (S.favs || []).includes(id);
function toggleFav(id) { const f = new Set(S.favs || []); f.has(id) ? f.delete(id) : f.add(id); S.favs = [...f]; save(); render(); }
function rate(id, n) { S.ratings = { ...(S.ratings || {}), [id]: (S.ratings || {})[id] === n ? undefined : n }; if (!S.ratings[id]) delete S.ratings[id]; save(); render(); }
const heart = id => `<button class="tiny fav" aria-pressed="${isFav(id)}" aria-label="${isFav(id) ? "Remove from" : "Add to"} favourites" title="Favourite" onclick="toggleFav('${id}')">${isFav(id) ? "♥" : "♡"}</button>`;
const starsHTML = id => { const v = (S.ratings || {})[id] || 0;
  return `<span class="stars" role="group" aria-label="Rate it">${[1, 2, 3, 4, 5].map(n => `<button class="star ${n <= v ? "on" : ""}" aria-label="${n} star${n > 1 ? "s" : ""}${n === 1 ? " (never again)" : ""}" onclick="rate('${id}',${n})">★</button>`).join("")}</span>`; };
// Ranking: stars first, then favourite, then how many saved weeks it appears in
function ranked() {
  const seen = {}; (S.saved || []).forEach(w => w.plan.days.forEach(d => MEALS.forEach(m => { if (d[m] && !(m === "lunch" && d.lunchLeftovers)) seen[d[m]] = (seen[d[m]] || 0) + 1; })));
  const ids = new Set([...(S.favs || []), ...Object.keys(S.ratings || {}).filter(k => S.ratings[k] >= 4), ...Object.keys(seen)]);
  return [...ids].filter(id => RECIPES[id] && (S.ratings || {})[id] !== 1)
    .map(id => ({ id, r: RECIPES[id], score: ((S.ratings || {})[id] || 3) * 2 + (isFav(id) ? 3 : 0) + (seen[id] || 0), seen: seen[id] || 0 }))
    .sort((a, b) => b.score - a.score);
}
function saveWeek() {
  const name = prompt("Name this week so you can use it again:", `Week of ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
  if (!name) return;
  S.saved = [{ name: name.slice(0, 60), at: Date.now(), plan: S.plan, meals: S.meals, used: 0 }, ...(S.saved || [])].slice(0, 30); save(); render();
}
async function useWeek(i) {
  const w = S.saved[i]; w.used = (w.used || 0) + 1; w.lastUsed = Date.now();
  S.meals = w.meals || S.meals; S.plan = JSON.parse(JSON.stringify(w.plan));
  const keep = {}; S.plan.days.forEach(d => MEALS.forEach(m => { if (d[m] && !(m === "lunch" && d.lunchLeftovers)) keep[`${d.day}.${m}`] = d[m]; }));
  S.keep = keep;
  const r = await api("/api/list", { plan: S.plan, prefs: prefs() });
  S.list = r.list; S.nutrition = r.nutrition; S.job = null; S.pick = null; S.swaps = {}; S.step = 1; save(); render(); scrollTo(0, 0);
}
function delWeek(i) { if (confirm(`Delete "${S.saved[i].name}"?`)) { S.saved.splice(i, 1); save(); render(); } }
function favouritesHTML() {
  const saved = [...(S.saved || [])].map((w, i) => ({ w, i })).sort((a, b) => (b.w.used || 0) - (a.w.used || 0) || b.w.at - a.w.at), top = ranked();
  if (!saved.length && !top.length) return "";
  let h = "";
  if (saved.length) h += sec("Your saved weeks", "most used first") + `<div class="card">${saved.map(({ w, i }) => {
    const n = w.plan.days.reduce((a, d) => a + MEALS.filter(m => d[m]).length, 0);
    return `<div class="li"><span style="flex:1"><b>${esc(w.name)}</b><br><span class="small dim">${n} meals · ${w.plan.days.map(d => RECIPES[d.dinner]?.name).filter(Boolean).slice(0, 3).map(esc).join(", ")}…${w.used ? ` · used ${w.used}×` : ""}</span></span>
      <button class="tiny go" onclick="useWeek(${i})">Use again</button><button class="tiny" aria-label="Delete" onclick="delWeek(${i})">✕</button></div>`; }).join("")}</div>`;
  if (top.length) h += sec("Your favourites", "they come up more often") + `<div class="card">${top.slice(0, 12).map(x => `<div class="li"><span style="flex:1">${esc(x.r.name)}<br><span class="small dim">${x.r.meal} · ${x.r.time} min${x.seen ? ` · in ${x.seen} saved week${x.seen > 1 ? "s" : ""}` : ""}</span></span>${starsHTML(x.id)}${heart(x.id)}</div>`).join("")}</div>`;
  return h;
}
function tastes() {
  return `<h1>What do you like to eat?</h1><p class="lede">A few quick questions. Forkcast plans your week's meals around them, works out the shopping, and prices it at every major UK supermarket so you can fill the cheapest (or best) trolley in one tap.</p>
    ${favouritesHTML()}
    ${mealsHTML()}
    ${C.questionnaire.filter(q => !["dinners", "lunches", "meals"].includes(q.id)).map(q => question(refine(q))).join("")}
    <div class="matchbar" aria-live="polite">${matchLine()}</div>
    ${foot(null, "buildWeek()", S.plan ? "Rebuild my week" : "Plan my week")}`;
}
function matchLine() {
  const pool = possible(), by = m => pool.filter(r => r.meal === m).length;
  const need = { breakfast: 0, lunch: 0, dinner: 0 }, M = S.meals || PRESETS["weeknight-weekend"];
  DAYS.forEach(d => MEALS.forEach(m => { if (M[d]?.[m] === "cook") need[m]++; }));
  const short = MEALS.filter(m => need[m] && by(m) < need[m]);
  return `<span class="num">${by("dinner")}</span> dinners · <span class="num">${by("lunch")}</span> lunches · <span class="num">${by("breakfast")}</span> breakfasts match so far${short.length ? ` <span class="miss">· not enough ${short.join(" or ")} recipes for a week without repeats; some will repeat</span>` : ""}`;
}
async function buildWeek(keep = {}, seed) {
  S.seed = seed ?? (S.seed || 1); S.keep = keep;
  const r = await api("/api/plan", { prefs: prefs(), seed: S.seed, keep });
  S.plan = r.plan; S.list = r.list; S.nutrition = r.nutrition; S.job = null; S.pick = null; S.swaps = {}; S.step = 1; save(); render(); scrollTo(0, 0);
}

// ---------------------------------------------------------------- 2. week
function week() {
  const p = prefs(), n = S.nutrition?.perDay || {}, keep = S.keep || {};
  let h = `<h1>Your week</h1><p class="lede">Quick meals on workdays, the longer cooks at the weekend, and recipes that share fresh ingredients so less goes in the bin. Pin the ones you like and reshuffle the rest.</p>`;
  h += `<div class="card">${S.plan.days.map(d => `<div class="dayblock"><span class="d">${d.day}</span><div>${MEALS.filter(m => d[m]).map(m => { const r = RECIPES[d[m]]; if (!r) return "";
      const k = `${d.day}.${m}`, left = m === "lunch" && d.lunchLeftovers, pin = keep[k] === d[m];
      return `<div class="meal"><span><span class="mt">${m}${left ? " · leftovers" : ""}</span><br><span class="n">${esc(r.name)}</span><br><span class="m">${left ? "from last night" : `${r.time} min · ${r.kcal} kcal · ${r.protein_g} g protein`}</span></span>
        ${left ? "<span></span>" : `<span class="row" style="gap:6px">${heart(d[m])}<button class="tiny lock" aria-pressed="${pin}" onclick="pinMeal('${k}','${d[m]}')">${pin ? "Pinned" : "Pin"}</button><button class="tiny" onclick="swapMeal('${k}')">Swap</button></span>`}</div>`; }).join("")}</div></div>`).join("")}</div>`;
  h += `<div class="row wrap"><button onclick="reshuffle()">Reshuffle unpinned</button><button onclick="saveWeek()">Save this week</button><span class="small dim">${p.adults} adult${p.adults > 1 ? "s" : ""}${p.children ? ` + ${p.children} child${p.children > 1 ? "ren" : ""}` : ""} · <button class="tiny" onclick="go(0)">Change meals</button></span></div>`;
  h += sec("Nutrition", "per person, per day, averaged over the week") + `<div class="card"><div class="stats" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr))">
    ${[["kcal", "kcal", ""], ["protein_g", "Protein", "g"], ["carbs_g", "Carbs", "g"], ["fat_g", "Fat", "g"], ["fibre_g", "Fibre", "g"], ["salt_g", "Salt", "g"]].map(([k, l, u]) => `<div class="stat"><span class="k">${l}</span><span class="v">${n[k] ?? "–"}${u}</span></div>`).join("")}</div>
    <p class="small dim" style="margin-top:8px">Only the meals planned here; anything else you eat is on top.</p></div>`;
  return h + foot(0, "go(2)", "Shopping list");
}
function pinMeal(k, id) { const kp = { ...(S.keep || {}) }; kp[k] === id ? delete kp[k] : kp[k] = id; S.keep = kp; save(); render(); }
function reshuffle() { buildWeek(S.keep || {}, (S.seed || 1) + 1); }
// swap one meal: hold every other meal where it is for this one rebuild, then restore the real pins
function swapMeal(k) {
  const hold = {}; S.plan.days.forEach(d => MEALS.forEach(m => { if (d[m] && !(m === "lunch" && d.lunchLeftovers) && `${d.day}.${m}` !== k) hold[`${d.day}.${m}`] = d[m]; }));
  const pins = { ...(S.keep || {}) }; delete pins[k];
  buildWeek(hold, (S.seed || 1) * 31 + k.length + Math.floor(Math.random() * 1000)).then(() => { S.keep = pins; save(); render(); });
}

// ---------------------------------------------------------------- 3. list
function list() {
  const L = S.list || [], buy = L.filter(l => !l.skip);
  let h = `<h1>Shopping list</h1><p class="lede">Everything for the week, scaled to your household. Store-cupboard basics (oil, salt, spices) are assumed in, untick any you need to buy.</p>`;
  h += `<div class="row wrap"><label class="row small"><input type="checkbox" ${S.pantryAll ?? true ? "checked" : ""} onchange="S.pantryAll=this.checked;relist()"> I have the store-cupboard basics</label><span class="small dim num" style="margin-left:auto">${buy.length} to buy</span></div>`;
  let aisle = "";
  h += `<div class="card">` + L.map(l => { const a = l.aisle !== aisle ? `<div class="aisle">${esc((aisle = l.aisle).replace(/-/g, " "))}</div>` : "";
    return a + `<div class="li ${l.skip ? "skip-it" : ""}"><span class="q">${fmtQty(l.qty, l.unit)}</span><span style="flex:1">${esc(l.name)}<br><span class="small dim">${esc(l.for.slice(0, 3).join(", "))}${l.for.length > 3 ? "…" : ""}</span></span>
      ${l.pantry ? `<button class="tiny" onclick="togglePantry('${esc(l.item)}')">${l.skip ? "Buy it" : "Have it"}</button>` : ""}</div>`; }).join("") + `</div>`;
  return h + foot(1, "startCompare()", "Compare supermarkets", !buy.length);
}
const fmtQty = (q, u) => u === "each" ? `${q} ×` : u === "g" && q >= 1000 ? `${(q / 1000).toFixed(q % 1000 ? 1 : 0)} kg` : u === "ml" && q >= 1000 ? `${(q / 1000).toFixed(1)} L` : `${q} ${u}`;
function togglePantry(item) { const have = new Set(S.pantryHave || []); const l = S.list.find(x => x.item === item);
  if (S.pantryAll ?? true) { S.pantryAll = false; S.list.filter(x => x.pantry && x.skip).forEach(x => have.add(x.item)); }
  l.skip ? have.delete(item) : have.add(item); S.pantryHave = [...have]; relist(); }
async function relist() { const r = await api("/api/list", { plan: S.plan, prefs: prefs() }); S.list = r.list; S.job = null; S.pick = null; save(); render(); }

// ---------------------------------------------------------------- 4. compare
async function startCompare() {
  const r = await api("/api/compare", { list: S.list, prefs: prefs() });
  S.job = r; S.pick = null; S.swaps = {}; S.step = 3; save(); render(); poll();
}
function poll() {
  clearTimeout(POLL);
  if (!S.job || S.job.finished) return;
  POLL = setTimeout(async () => {
    try { S.job = await api("/api/compare/" + S.job.id); save(); if (S.step === 3) render(); } catch { S.job.finished = Date.now(); }
    poll();
  }, 2000);
}
// A shop's total with its chosen swaps, plus a fair estimate for anything it didn't stock (the
// middle price of that item elsewhere), so a shop missing half the list can't look cheapest.
function shopView(r) {
  const lines = (r.lines || []).map(l => { const k = S.swaps[r.id]?.[l.item]; return k != null && l.alts?.[k] ? { ...l, ...l.alts[k], alts: l.alts, swapped: k } : l; });
  let total = 0, q = 0, n = 0;
  for (const l of lines) if (!l.missing) { total += l.cost; q += l.q; n++; }
  const shops = Object.values(S.job.retailers).filter(x => x.state === "done");
  let est = 0;
  for (const l of lines.filter(l => l.missing)) {
    const others = shops.map(s => (s.lines || []).find(x => x.item === l.item && !x.missing)?.cost).filter(x => x != null).sort((a, b) => a - b);
    if (others.length) est += others[Math.floor(others.length / 2)];
  }
  return { lines, total, fair: total + est, est, quality: n ? q / n : 0, matched: n, missing: lines.length - n };
}
const qualityLabel = q => q >= 2.9 ? "Premium" : q >= 2.3 ? "Good" : q >= 1.7 ? "Standard" : "Basic";
function compare() {
  const p = prefs(), J = S.job; if (!J) return list();
  const all = Object.values(J.retailers), done = all.filter(r => r.state === "done" && r.matched);
  const views = Object.fromEntries(done.map(r => [r.id, shopView(r)]));
  const deliver = done.filter(r => !r.inStoreOnly);
  const cheapest = [...done].sort((a, b) => views[a.id].fair - views[b.id].fair)[0];
  const bestQ = [...done].sort((a, b) => views[b.id].quality - views[a.id].quality)[0];
  const bestValue = [...deliver].sort((a, b) => views[a.id].fair / Math.pow(views[a.id].quality, 1.1) - views[b.id].fair / Math.pow(views[b.id].quality, 1.1))[0];
  let h = `<h1>Compare supermarkets</h1><p class="lede">Your list, priced product by product on each supermarket's own website just now. Totals count whole packs. Pick a shopping style and Forkcast re-chooses every product.</p>`;
  h += `<div class="card"><div class="row wrap" style="gap:8px"><span class="small">Style</span><span class="seg">${Object.entries(C.styles).map(([k, l]) => `<button aria-pressed="${p.style === k}" onclick="setA('style','${k}');startCompare()">${esc(l)}</button>`).join("")}</span>
    <label class="row small" style="margin-left:auto"><input type="checkbox" ${p.loyalty ? "checked" : ""} onchange="setA('loyalty',this.checked);startCompare()"> Use loyalty-card prices</label></div>
    ${p.budget ? `<p class="small" style="margin-top:8px">Your budget: <b class="num">${money(p.budget)}</b> a week</p>` : ""}</div>`;
  h += `<div class="grid">${all.map(r => {
    if (r.state !== "done") return `<div class="shop"><span class="name">${esc(r.name)}</span><span class="small dim">Checking prices… ${r.done}/${J.total}</span><div class="bar"><i style="width:${Math.round(100 * r.done / J.total)}%"></i></div></div>`;
    if (!r.matched) return `<div class="shop"><span class="name">${esc(r.name)}</span><span class="small miss">Couldn't read prices from ${esc(r.name)} right now.</span></div>`;
    const v = views[r.id], over = p.budget && v.fair > p.budget;
    const badges = [r === cheapest && "Cheapest", r === bestValue && "Best value", r === bestQ && "Best quality"].filter(Boolean);
    return `<div class="shop ${r === bestValue ? "best" : ""}"><div class="row between"><span class="name">${esc(r.name)}</span>${r.inStoreOnly ? `<span class="tag">In store only</span>` : ""}</div>
      <div class="badges">${badges.map(b => `<span class="badge ${b === "Best quality" ? "q" : ""}">${b}</span>`).join("")}</div>
      <span class="total num">${money(v.fair)}</span>
      <span class="small ${over ? "miss" : "dim"}">${v.est ? `${money(v.total)} for ${v.matched} items + about ${money(v.est)} for ${v.missing} it doesn't sell` : `all ${v.matched} items`}${over ? ` · ${money(v.fair - p.budget)} over budget` : ""}</span>
      <div class="stats"><div class="stat"><span class="k">Quality</span><span class="v">${qualityLabel(v.quality)}</span></div><div class="stat"><span class="k">Found</span><span class="v">${v.matched}/${v.matched + v.missing}</span></div><div class="stat"><span class="k">Spare</span><span class="v">${money(r.waste)}</span></div></div>
      <div class="row wrap"><button class="tiny" onclick="OPEN=OPEN==='${r.id}'?null:'${r.id}';render()">${OPEN === r.id ? "Hide products" : "See products"}</button><button class="tiny go" onclick="choose('${r.id}')">${r.inStoreOnly ? "Use this list" : "Choose " + esc(r.name)}</button></div></div>`;
  }).join("")}</div>`;
  if (OPEN && views[OPEN]) h += shopDetail(J.retailers[OPEN], views[OPEN]);
  h += `<p class="small dim" style="margin-top:14px">"Spare" is the value of food left over from whole packs, counting fresh food more than store-cupboard. Quality weighs each shop's ranges (value, own-label, premium, brands), welfare and provenance for meat, fish and eggs.</p>`;
  return h + foot(2, null);
}
function shopDetail(r, v) {
  return sec(esc(r.name) + " products", `${v.matched} found`) + `<div class="card">${v.lines.map(l => l.missing
    ? `<div class="pl"><span class="pn">${esc(l.name)} <span class="small miss">not found</span></span><span></span></div>`
    : `<div class="pl"><span class="pn">${l.packs} × ${esc(l.product.name)} <span class="small dim">${esc(l.product.size || "")}</span><br><span class="tier ${l.product.tier}">${l.product.tier}</span> <span class="small dim">for ${fmtQty(l.qty, l.unit)} ${esc(l.name.toLowerCase())}${l.product.promo ? ` · ${esc(l.product.promo)}` : ""}</span></span>
       <span class="pc">${money(l.cost)}<br><span class="small dim">${money(l.product.price)} each</span></span>
       ${l.alts?.length ? `<span class="alts">${l.alts.map((a, k) => `<button class="tiny" aria-pressed="${l.swapped === k}" onclick="swapLine('${r.id}','${esc(l.item)}',${k})" title="${esc(a.product.name)}">${a.packs} × ${esc(short(a.product.name))} ${money(a.cost)}</button>`).join("")}${l.swapped != null ? `<button class="tiny" onclick="swapLine('${r.id}','${esc(l.item)}',null)">Back to Forkcast's pick</button>` : ""}</span>` : ""}</div>`).join("")}</div>`;
}
const short = s => s.length > 34 ? s.slice(0, 32) + "…" : s;
function swapLine(shop, item, k) { const m = { ...(S.swaps[shop] || {}) }; k == null ? delete m[item] : m[item] = k; S.swaps[shop] = m; save(); render(); }
function choose(id) { S.pick = id; S.step = 4; save(); render(); scrollTo(0, 0); }

// ---------------------------------------------------------------- 5. order
function order() {
  const r = S.job?.retailers?.[S.pick]; if (!r) return compare();
  const v = shopView(r), buy = v.lines.filter(l => !l.missing);
  const link = r.trolleyUrl + "#forkcast=" + buy.map(l => `${encodeURIComponent(l.product.id)}:${l.packs}`).join(",");
  let h = `<h1>Order from ${esc(r.name)}</h1><p class="lede"><b class="num">${money(v.total)}</b> for ${buy.length} products${v.missing ? `; ${v.missing} you'll need elsewhere (listed below)` : ""}.</p>`;
  if (r.inStoreOnly) h += `<div class="card"><h3>${esc(r.name)} is in-store only</h3><p class="small">${esc(r.name)} doesn't deliver groceries, so here's your list to take with you. Print it or keep this page open in the shop.</p><button onclick="print()">Print list</button></div>`;
  else {
    h += HELPER ? `<div class="card"><h3>One click</h3><a class="btn go" target="_blank" rel="noopener" href="${esc(link)}">Fill my ${esc(r.name)} trolley ↗</a>
      <p class="small dim" style="margin-top:8px">Opens ${esc(r.name)} and the Forkcast Helper fills your trolley${["ocado", "morrisons"].includes(r.id) ? " (it asks before replacing anything already there)" : ""}. Then book a slot and check out as normal.</p>`
    : `<div class="card"><h3>Fill your ${esc(r.name)} trolley</h3><a class="btn go" target="_blank" rel="noopener" href="${esc(link)}">Open ${esc(r.name)} ↗</a>
      <p class="small" style="margin-top:8px">For one click, install the <b>Forkcast Helper</b> once (below). Without it, tap your Forkcast bookmark on ${esc(r.name)}'s site after it opens.</p>`;
    h += `
      ${/sign-in/.test(r.fillStatus) ? `<p class="notice">Sign in to ${esc(r.name)} first: it only lets signed-in shoppers add to a trolley.</p>` : ""}
      ${/unverified/.test(r.fillStatus) ? `<p class="notice">Filling a ${esc(r.name)} trolley hasn't been fully tested yet. If it doesn't work, use the list below.</p>` : ""}</div>`;
    if (!HELPER) h += helperCard();
    h += bookmarkCard();
  }
  let aisle = "";
  h += sec("Your list", `${buy.length} products`) + `<div class="card">${buy.map(l => `<div class="pl"><span class="pn"><a href="${esc(l.product.url || "#")}" target="_blank" rel="noopener">${l.packs} × ${esc(l.product.name)}</a> <span class="small dim">${esc(l.product.size || "")}</span></span><span class="pc">${money(l.cost)}</span></div>`).join("")}
    ${v.lines.filter(l => l.missing).map(l => `<div class="pl"><span class="pn miss">${esc(l.name)}: not sold here, ${fmtQty(l.qty, l.unit)}</span><span></span></div>`).join("")}
    <div class="row" style="margin-top:10px"><button class="tiny" onclick="copyList()">Copy as text</button></div></div>`;
  return h + foot(3, "go(5)", "Recipes");
}
// The helper marks the page (data-fc-helper) once it's installed; check again shortly after load.
let HELPER = !!document.documentElement.dataset.fcHelper;
setTimeout(() => { if (!HELPER && document.documentElement.dataset.fcHelper) { HELPER = true; render(); } }, 1500);
function helperCard() {
  return `<div class="card"><h3>Get one-click filling: the Forkcast Helper</h3>
    <p class="small">A tiny add-on that runs only on supermarket websites. When Forkcast opens a shop, it fills your trolley there, in your own browser and your own account. One-time setup:</p>
    <p class="small"><b>Chrome, Edge or Firefox:</b> add <a href="https://www.tampermonkey.net/" target="_blank" rel="noopener">Tampermonkey</a> from your browser's extension store, then <a class="btn tiny go" href="forkcast.user.js">Install Forkcast Helper</a>${STATIC ? "" : ` · or, without Tampermonkey, <a href="forkcast-helper.zip">download the Chrome extension</a> and load it at chrome://extensions (Developer mode › Load unpacked)`}.</p>
    <p class="small"><b>iPhone / iPad (Safari):</b> install the free <a href="https://apps.apple.com/app/userscripts/id1463298887" target="_blank" rel="noopener">Userscripts</a> app, turn it on in Settings › Apps › Safari › Extensions, then open <a href="forkcast.user.js">this link</a> in Safari and tap the Userscripts icon › Install.</p>
    <p class="small dim">Reload this page afterwards and the button above becomes "Fill my trolley". If a shop makes you sign in first, the helper remembers your list and fills the trolley as soon as you're back.</p></div>`;
}
function bookmarkCard() {
  if (BOOKMARK === null) { BOOKMARK = ""; fetch(STATIC ? "bookmarklet.js" : "/api/bookmarklet").then(r => r.text()).then(t => { BOOKMARK = "javascript:" + encodeURIComponent(t); render(); }); }
  const open = OPEN === "bm";
  return `<div class="card"><div class="row between" style="cursor:pointer" onclick="OPEN=OPEN==='bm'?null:'bm';render()"><span class="small"><b>No add-ons?</b> Use the Forkcast bookmark instead (two taps)</span><span>${open ? "▾" : "▸"}</span></div>
    ${open ? `<div style="margin-top:10px"><p class="small"><b>Computer:</b> drag this to your bookmarks bar: <a class="btn go tiny" href="${BOOKMARK || "#"}" onclick="alert('Drag this to your bookmarks bar, then use it on the supermarket website.');return false">Forkcast</a></p>
      <p class="small"><b>iPhone / iPad:</b> 1) <button class="tiny" onclick="navigator.clipboard?.writeText(BOOKMARK).then(()=>alert('Copied. Now bookmark any page, name it Forkcast and paste this as its address.'))">Copy the bookmark code</button> 2) In Safari, bookmark any page (share › Add Bookmark) and name it <b>Forkcast</b>. 3) Edit it and paste the code as the address. On the supermarket site, type "Forkcast" in the address bar and tap the bookmark.</p>
      <p class="small dim">Why a bookmark? Browsers stop one website changing another website's trolley. The bookmark runs on the supermarket's own site, in your browser, so it can. Your list rides in the link after the # and is never sent to Forkcast's or the shop's servers by the link itself.</p></div>` : ""}</div>`;
}
function copyList() { const r = S.job.retailers[S.pick], v = shopView(r);
  navigator.clipboard?.writeText(v.lines.map(l => l.missing ? `${l.name} (${fmtQty(l.qty, l.unit)}) - elsewhere` : `${l.packs} x ${l.product.name} ${l.product.size || ""} - ${money(l.cost)}`).join("\n")).then(() => alert("Copied")); }

// ---------------------------------------------------------------- 6. recipes
function recipes() {
  const who = (+prefs().adults || 2) + .6 * (+prefs().children || 0);
  let h = `<h1>This week's recipes</h1><p class="lede">Quantities scaled for your household. Rate each one after you've cooked it: favourites and 4–5 stars come up more often, 1 star means never again. <button class="tiny" onclick="print()">Print</button></p>`;
  for (const d of S.plan.days) for (const slot of MEALS) {
    const r = RECIPES[d[slot]]; if (!r || (slot === "lunch" && d.lunchLeftovers)) continue;
    const nextDay = S.plan.days.find(x => x.day === DAYS[(DAYS.indexOf(d.day) + 1) % 7]);
    const double = slot === "dinner" && nextDay?.lunchLeftovers && nextDay.lunch === d.dinner;
    const k = who * (double ? 2 : 1) / (r.serves || 4);
    h += `<div class="card recipe"><div class="row between"><h3>${d.day} ${slot}: ${esc(r.name)}</h3><span class="row" style="gap:4px">${starsHTML(r.id)}${heart(r.id)}</span></div>${double ? `<p class="small" style="color:var(--signal-ink)">Makes double: half is ${esc(nextDay.day)}'s lunch.</p>` : ""}
      <p class="meta">${r.time} min · ${r.kcal} kcal · ${r.protein_g} g protein · serves ${Math.round(who * (double ? 2 : 1) * 10) / 10}</p>
      <div class="two"><ul class="ing">${r.ingredients.map(i => `<li><span class="num">${fmtQty(Math.ceil(i.qty * k), i.unit)}</span><span>${esc((C.ingredients[i.item] || {}).name || i.item)}${i.note ? ` <span class="dim small">${esc(i.note)}</span>` : ""}</span></li>`).join("")}</ul>
      <ol class="steps-list">${r.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></div></div>`;
  }
  return h + foot(4, null);
}

// ---------------------------------------------------------------- boot
api("/api/content").then(c => { C = c; RECIPES = Object.fromEntries(c.recipes.map(r => [r.id, r])); if (S.step > maxStep()) S.step = maxStep(); render(); poll(); })
  .catch(e => { $("#view").innerHTML = `<p class="miss" style="margin-top:30px">Couldn't load Forkcast: ${esc(e.message)}</p>`; });
render();
