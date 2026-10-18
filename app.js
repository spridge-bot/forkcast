// Forkcast: tastes → a week of meals → shopping list → compare every UK supermarket → fill the
// chosen trolley in your own browser → cook. State lives in this browser (localStorage "forkcast").
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = n => "£" + (+n || 0).toFixed(2);

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
// Four steps: Tastes → Plan (week + list) → Shop (ranked shops, order inline) → Cook.
function go(n) { if (n > maxStep()) return; S.step = n; OPEN = null; save(); render(); scrollTo(0, 0); }
const maxStep = () => !S.plan ? 0 : !S.job ? 1 : 3;
function render() {
  if (S.step > 3) S.step = 3;
  document.querySelectorAll("#steps button").forEach(b => { const n = +b.dataset.s;
    b.classList.toggle("on", n === S.step); b.disabled = n > maxStep();
    if (n === S.step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
  if (!C) { $("#view").innerHTML = `<p class="dim" style="margin-top:40px">Loading…</p>`; return; }
  $("#view").innerHTML = `<div class="glow"></div>` + [tastes, week, shop, recipes][S.step]();
}
document.querySelectorAll("#steps button").forEach(b => b.onclick = () => go(+b.dataset.s));
const head = (kicker, title, em, lede) => `<p class="kicker">${kicker}</p><h1>${title}${em ? `<em>${em}</em>` : ""}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}`;
const panel = (title, meta, body) => `<section class="panel">${title ? `<div class="panel-h"><h2>${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</div>` : ""}${body}</section>`;
const fold = (title, meta, body, open) => `<details class="fold" ${open ? "open" : ""}><summary>${title}${meta ? ` <span class="meta">${meta}</span>` : ""}</summary><div class="in">${body}</div></details>`;
const nextBar = (note, label, action, dis) => `<div class="next"><div class="in"><span class="note">${note}</span>${label ? `<button class="go big" ${dis ? "disabled" : ""} onclick="${action}">${label}</button>` : ""}</div></div>`;
const sec = (t, meta = "") => `<div class="panel-h" style="margin-top:22px"><h2>${t}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</div>`;

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
  return `<div class="chips">${Object.entries(PRESETS).map(([k, v]) => `<button class="chip" aria-pressed="${sameMeals(M, v)}" onclick="S.meals=JSON.parse(JSON.stringify(PRESETS['${k}']));delete S.meals.label;save();render()">${esc(v.label)}</button>`).join("")}</div>
    <div class="mealgrid" role="grid" aria-label="Meals to plan"><span></span>${DAYS.map(d => `<span class="mg-d ${WK(d) ? "wk" : ""}">${d}</span>`).join("")}
    ${MEALS.map(m => `<span class="mg-m">${m[0].toUpperCase() + m.slice(1)}</span>${DAYS.map(d => { const v = M[d]?.[m] || "";
      return `<button class="mg-c ${v}" aria-pressed="${!!v}" aria-label="${d} ${m}: ${v || "off"}" onclick="mealCell('${d}','${m}')">${v === "cook" ? "✓" : v === "leftovers" ? "↺" : ""}</button>`; }).join("")}`).join("")}</div>
    <p class="small dim" style="margin:10px 0 0"><b class="num" style="color:var(--ink-1)">${n.cook}</b> meals to cook${n.leftovers ? ` + ${n.leftovers} leftover lunches` : ""}. Tap to switch; tap a lunch twice for ↺ leftovers from the night before.</p>`;
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
const heart = id => `<button class="ico fav" aria-pressed="${isFav(id)}" aria-label="${isFav(id) ? "Remove from" : "Add to"} favourites" title="Favourite" onclick="toggleFav('${id}')">${isFav(id) ? "♥" : "♡"}</button>`;
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
  if (saved.length) h += panel("Use a saved week", "most used first", `<div class="pills">${saved.map(({ w, i }) => `<button class="pill" onclick="useWeek(${i})"><b>${esc(w.name)}</b><span>${w.plan.days.map(d => RECIPES[d.dinner]?.name).filter(Boolean).slice(0, 2).map(esc).join(", ")}…${w.used ? ` · used ${w.used}×` : ""}</span></button>`).join("")}</div>
    <p class="small dim" style="margin:8px 0 0">Manage: ${saved.map(({ w, i }) => `<button class="link" onclick="delWeek(${i})">delete ${esc(w.name)}</button>`).join(" · ")}</p>`);
  if (top.length) h += fold("Your favourites", `${top.length} · they come up more often`, top.slice(0, 20).map(x => `<div class="li"><span style="flex:1">${esc(x.r.name)}<br><span class="small dim">${x.r.meal} · ${x.r.time} min${x.seen ? ` · in ${x.seen} saved week${x.seen > 1 ? "s" : ""}` : ""}</span></span>${starsHTML(x.id)}${heart(x.id)}</div>`).join(""));
  return h;
}
const ESSENTIAL = ["adults", "children", "diet", "mustBe", "allergies"];
function tastes() {
  const Q = id => C.questionnaire.find(q => q.id === id), rest = C.questionnaire.filter(q => ![...ESSENTIAL, "dinners", "lunches", "meals"].includes(q.id));
  const p = prefs();
  const who = `<div class="inline-q"><label>Adults <input type="number" min="1" max="8" value="${p.adults}" onchange="setA('adults',Number(this.value)||1);render()"></label>
    <label>Children <input type="number" min="0" max="8" value="${p.children}" onchange="setA('children',Number(this.value)||0);render()"></label></div>`;
  return head("Your week, planned and priced", "What do you", "fancy?", "Tell us how you eat. Forkcast plans the week, works out the shopping, and finds the best supermarket for it.")
    + favouritesHTML()
    + panel("Meals", "", mealsHTML())
    + panel("Who's eating", "", who + `<div class="q" style="margin-top:20px">${questionBody(Q("diet"))}</div>` + [Q("mustBe"), Q("allergies")].filter(Boolean).map(q => question(q)).join(""))
    + fold("More about what you like", "optional · cuisines, spice, time, budget…", rest.map(q => question(refine(q))).join(""))
    + nextBar(matchLine(), S.plan ? "Re-plan my week" : "Plan my week", "buildWeek()");
}
// a question without its own heading (for diet, which sits under "Who's eating")
function questionBody(q) { return question(q).replace(/^<div class="q">/, "").replace(/<\/div>$/, ""); }
function matchLine() {
  const pool = possible(), by = m => pool.filter(r => r.meal === m).length;
  const need = { breakfast: 0, lunch: 0, dinner: 0 }, M = S.meals || PRESETS["weeknight-weekend"];
  DAYS.forEach(d => MEALS.forEach(m => { if (M[d]?.[m] === "cook") need[m]++; }));
  const short = MEALS.filter(m => need[m] && by(m) < need[m]);
  return `<b>${by("dinner")}</b> dinners, <b>${by("lunch")}</b> lunches and <b>${by("breakfast")}</b> breakfasts suit you${short.length ? ` <span class="miss">· too few ${short.join("/")} for no repeats</span>` : ""}`;
}
async function buildWeek(keep = {}, seed) {
  S.seed = seed ?? (S.seed || 1); S.keep = keep;
  const r = await api("/api/plan", { prefs: prefs(), seed: S.seed, keep });
  S.plan = r.plan; S.list = r.list; S.nutrition = r.nutrition; S.job = null; S.pick = null; S.swaps = {}; S.step = 1; save(); render(); scrollTo(0, 0);
}

// ---------------------------------------------------------------- 2. plan (week + list)
function week() {
  const p = prefs(), n = S.nutrition?.perDay || {}, keep = S.keep || {};
  const days = S.plan.days.map(d => `<div class="day"><span class="d">${d.day}</span><div>${MEALS.filter(m => d[m]).map(m => { const r = RECIPES[d[m]]; if (!r) return "";
      const k = `${d.day}.${m}`, left = m === "lunch" && d.lunchLeftovers, pin = keep[k] === d[m];
      return `<div class="meal"><span class="t"><span class="mt">${m}${left ? " · leftovers" : ""}</span><span class="n">${esc(r.name)}</span><span class="m">${left ? "from last night" : `${r.time} min · ${r.kcal} kcal`}</span></span>
        ${left ? "" : `${heart(d[m])}<button class="ico" aria-pressed="${pin}" title="${pin ? "Kept" : "Keep this one"}" aria-label="Keep" onclick="pinMeal('${k}','${d[m]}')">${pin ? "●" : "○"}</button><button class="ico" title="Swap for something else" aria-label="Swap" onclick="swapMeal('${k}')">↻</button>`}</div>`; }).join("")}</div></div>`).join("");
  const L = S.list || [], buy = L.filter(l => !l.skip);
  let aisle = "";
  const listBody = `<label class="row small" style="margin-bottom:6px"><input type="checkbox" ${S.pantryAll ?? true ? "checked" : ""} onchange="S.pantryAll=this.checked;relist()"> I already have the store-cupboard basics (oil, salt, spices)</label>`
    + L.map(l => { const a = l.aisle !== aisle ? `<div class="aisle">${esc((aisle = l.aisle).replace(/-/g, " "))}</div>` : "";
      return a + `<div class="li ${l.skip ? "skip-it" : ""}"><span class="qty num">${fmtQty(l.qty, l.unit)}</span><span style="flex:1">${esc(l.name)}</span>${l.pantry ? `<button class="tiny" onclick="togglePantry('${esc(l.item)}')">${l.skip ? "Need it" : "Have it"}</button>` : ""}</div>`; }).join("");
  return head("Step 2", "Your", "week.", "")
    + panel("", "", `<div class="row wrap" style="justify-content:space-between;margin-bottom:14px"><span class="small dim">${p.adults} adult${p.adults > 1 ? "s" : ""}${p.children ? ` + ${p.children} child${p.children > 1 ? "ren" : ""}` : ""} · ● keep · ↻ swap · ♡ favourite</span>
        <span class="row" style="gap:6px"><button class="tiny" onclick="reshuffle()">Reshuffle</button><button class="tiny" onclick="saveWeek()">Save week</button></span></div>` + days)
    + panel("", "", `<div class="nutri"><span><b>${n.kcal ?? "–"}</b>kcal</span><span><b>${n.protein_g ?? "–"}</b>g protein</span><span><b>${n.carbs_g ?? "–"}</b>g carbs</span><span><b>${n.fibre_g ?? "–"}</b>g fibre</span><span><b>${n.salt_g ?? "–"}</b>g salt</span></div><p class="small dim" style="margin:8px 0 0">Per person per day from these meals, averaged over the week.</p>`)
    + fold("Shopping list", `${buy.length} items`, listBody)
    + nextBar(`<b>${buy.length}</b> items to buy`, "Find the best shop", "startCompare()", !buy.length);
}
function pinMeal(k, id) { const kp = { ...(S.keep || {}) }; kp[k] === id ? delete kp[k] : kp[k] = id; S.keep = kp; save(); render(); }
function reshuffle() { buildWeek(S.keep || {}, (S.seed || 1) + 1); }
// swap one meal: hold every other meal where it is for this one rebuild, then restore the real pins
function swapMeal(k) {
  const hold = {}; S.plan.days.forEach(d => MEALS.forEach(m => { if (d[m] && !(m === "lunch" && d.lunchLeftovers) && `${d.day}.${m}` !== k) hold[`${d.day}.${m}`] = d[m]; }));
  const pins = { ...(S.keep || {}) }; delete pins[k];
  buildWeek(hold, (S.seed || 1) * 31 + k.length + Math.floor(Math.random() * 1000)).then(() => { S.keep = pins; save(); render(); });
}

const fmtQty = (q, u) => u === "each" ? `${q} ×` : u === "g" && q >= 1000 ? `${(q / 1000).toFixed(q % 1000 ? 1 : 0)} kg` : u === "ml" && q >= 1000 ? `${(q / 1000).toFixed(1)} L` : `${q} ${u}`;
function togglePantry(item) { const have = new Set(S.pantryHave || []); const l = S.list.find(x => x.item === item);
  if (S.pantryAll ?? true) { S.pantryAll = false; S.list.filter(x => x.pantry && x.skip).forEach(x => have.add(x.item)); }
  l.skip ? have.delete(item) : have.add(item); S.pantryHave = [...have]; relist(); }
async function relist() { const r = await api("/api/list", { plan: S.plan, prefs: prefs() }); S.list = r.list; S.job = null; S.pick = null; save(); render(); }

// ---------------------------------------------------------------- 3. shop
async function startCompare() {
  const r = await api("/api/compare", { list: S.list, prefs: prefs() });
  S.job = r; S.pick = null; S.swaps = {}; S.step = 2; save(); render(); scrollTo(0, 0); poll();
}
function poll() {
  clearTimeout(POLL);
  if (!S.job || S.job.finished) return;
  POLL = setTimeout(async () => {
    try { S.job = await api("/api/compare/" + S.job.id); save(); if (S.step === 2) render(); } catch { S.job.finished = Date.now(); }
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
const qualityLabel = q => q >= 2.9 ? "premium" : q >= 2.3 ? "good" : q >= 1.7 ? "standard" : "basic";
function shop() {
  const p = prefs(), J = S.job; if (!J) return week();
  const all = Object.values(J.retailers), done = all.filter(r => r.state === "done" && r.matched), waiting = all.filter(r => r.state !== "done");
  const V = Object.fromEntries(done.map(r => [r.id, shopView(r)]));
  const ranked = [...done].sort((a, b) => V[a.id].fair - V[b.id].fair);
  const bestQ = [...done].sort((a, b) => V[b.id].quality - V[a.id].quality)[0];
  const bestValue = [...done].filter(r => !r.inStoreOnly).sort((a, b) => V[a.id].fair / Math.pow(V[a.id].quality, 1.1) - V[b.id].fair / Math.pow(V[b.id].quality, 1.1))[0];
  const when = ranked[0]?.pricedAt ? new Date(ranked[0].pricedAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "just now";
  let rows = ranked.map((r, i) => {
    const v = V[r.id], open = S.pick === r.id;
    const badges = [r === bestValue && "Best value", r === bestQ && "Best quality"].filter(Boolean).map(b => `<span class="badge ${b === "Best quality" ? "q" : ""}">${b}</span>`).join("");
    const sub = [r.inStoreOnly && "in store only", v.missing ? `${v.missing} items not stocked, estimated` : "everything on your list", qualityLabel(v.quality) + " quality"].filter(Boolean).join(" · ");
    return `<button class="shoprow ${open ? "on" : ""}" aria-expanded="${open}" onclick="S.pick=S.pick==='${r.id}'?null:'${r.id}';OPEN=null;save();render()"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.name)}</span>${badges}<span class="sub">${sub}</span></span><span class="tot">${money(v.fair)}</span><span class="chev"></span></button>`
      + (open ? orderPanel(r, v) : "");
  }).join("");
  rows += waiting.map(r => `<div class="shoprow"><span class="rk">·</span><span><span class="nm">${esc(r.name)}</span><span class="sub">checking prices… ${r.done}/${J.total}</span></span><span></span><span></span></div>`).join("");
  return head("Step 3", "Where to", "shop.", `Your list priced at each supermarket (${STATIC ? "prices from " + when : "live prices"}). Pick one to fill its basket.`)
    + `<div class="row wrap" style="gap:12px"><label class="row">Choose products <select onchange="setA('style',this.value);startCompare()">${Object.entries(C.styles).map(([k, l]) => `<option value="${k}" ${p.style === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="row"><input type="checkbox" ${p.loyalty ? "checked" : ""} onchange="setA('loyalty',this.checked);startCompare()"> Loyalty card prices</label>${p.budget ? `<span class="small dim">Budget <b class="num" style="color:var(--ink-1)">${money(p.budget)}</b></span>` : ""}</div>`
    + `<div class="shops">${rows}</div>`
    + `<p class="small dim">Totals count whole packs. Items a shop doesn't stock are estimated from the other shops so the comparison is fair.</p>`
    + nextBar(S.pick ? `Ordering from <b>${esc(J.retailers[S.pick]?.name || "")}</b>` : "Pick a shop above", "Recipes", "go(3)");
}
function shopLink(r, buy) {
  const list = buy.map(l => `${encodeURIComponent(l.product.id)}:${l.packs}`).join(",");
  return r.id === "sainsburys" ? `${r.trolleyUrl}?forkcast=${list}` : `${r.trolleyUrl}#forkcast=${list}`;   // Sainsbury's site breaks on a # link
}
function orderPanel(r, v) {
  const buy = v.lines.filter(l => !l.missing), link = shopLink(r, buy);
  const products = buy.map(l => `<div class="pl"><span><a href="${esc(l.product.url || "#")}" target="_blank" rel="noopener">${l.packs} × ${esc(l.product.name)}</a> <span class="small dim">${esc(l.product.size || "")}</span><br><span class="tier ${l.product.tier}">${l.product.tier}</span> <span class="small dim">for ${fmtQty(l.qty, l.unit)} ${esc(l.name.toLowerCase())}${l.product.promo ? ` · ${esc(l.product.promo)}` : ""}</span></span><span class="pc">${money(l.cost)}</span>
      ${l.alts?.length ? `<span class="alts">${l.alts.slice(0, 3).map((a, k) => `<button class="tiny" aria-pressed="${l.swapped === k}" onclick="swapLine('${r.id}','${esc(l.item)}',${k})" title="${esc(a.product.name)}">${esc(short(a.product.name))} ${money(a.cost)}</button>`).join("")}${l.swapped != null ? `<button class="tiny" onclick="swapLine('${r.id}','${esc(l.item)}',null)">Undo</button>` : ""}</span>` : ""}</div>`).join("")
    + v.lines.filter(l => l.missing).map(l => `<div class="pl"><span class="miss">${esc(l.name)} (${fmtQty(l.qty, l.unit)}): not stocked here</span><span></span></div>`).join("");
  let h = `<div class="order">`;
  if (r.inStoreOnly) h += `<div class="stepline"><span class="n">1</span><div class="b"><b>${esc(r.name)} is in store only.</b> Take the list with you.<div class="row wrap" style="margin-top:10px"><button class="go" onclick="print()">Print list</button><button onclick="copyList('${r.id}')">Copy list</button></div></div></div>`;
  else if (HELPER) h += `<div class="stepline"><span class="n">1</span><div class="b"><a class="btn go big" target="_blank" rel="noopener" href="${esc(link)}">Fill my ${esc(r.name)} basket ↗</a><p class="small dim">Opens ${esc(r.name)} and fills the basket. Log in when it asks, then check out.</p></div></div>`;
  else {
    h += `<div class="stepline"><span class="n">1</span><div class="b"><a class="btn go" target="_blank" rel="noopener" href="${esc(link)}">Open ${esc(r.name)} ↗</a><p class="small dim">Opens in a new tab with your list attached.</p></div></div>
      <div class="stepline"><span class="n">2</span><div class="b"><b>On ${esc(r.name)}, tap the ★ Forkcast button in your bookmarks.</b> It fills the basket${/sign-in/.test(r.fillStatus) ? `; if ${esc(r.name)} asks you to log in first, log in and tap it again` : ""}.
        <p class="small" style="margin-top:6px"><button class="link" onclick="OPEN=OPEN==='bm'?null:'bm';render()">${OPEN === "bm" ? "Hide" : "First time? Add the ★ Forkcast button to your browser (30 seconds, once)"}</button></p>${OPEN === "bm" ? bookmarkHelp() : ""}</div></div>
      <div class="stepline"><span class="n">3</span><div class="b">Log in to ${esc(r.name)} if you haven't, book a slot and check out.</div></div>`;
    if (/unverified/.test(r.fillStatus)) h += `<p class="notice">Filling a ${esc(r.name)} basket is new and only partly tested. If anything's missing, the full list is below.</p>`;
  }
  h += fold("Products", `${buy.length} · ${money(v.total)}${v.missing ? ` · ${v.missing} not stocked` : ""}`, products + `<div class="row" style="margin-top:10px"><button class="tiny" onclick="copyList('${r.id}')">Copy as text</button></div>`);
  return h + `</div>`;
}
// The bookmark is the one thing every browser has built in that can act on a supermarket's own page.
function bookmarkHelp() {
  if (BOOKMARK === null) { BOOKMARK = ""; fetch(STATIC ? "bookmarklet.js" : "/api/bookmarklet").then(r => r.text()).then(t => { BOOKMARK = "javascript:" + encodeURIComponent(t); render(); }); }
  return `<div class="notice" style="border-color:var(--tom)"><p style="margin:0 0 8px"><b>On a computer:</b> drag this button onto your bookmarks bar: <a class="btn go tiny" href="${BOOKMARK || "#"}" onclick="alert('Drag this onto your bookmarks bar. Then, on the supermarket site, click it.');return false">★ Forkcast</a></p>
    <p style="margin:0"><b>On iPhone or iPad:</b> <button class="tiny" onclick="navigator.clipboard?.writeText(BOOKMARK).then(()=>alert('Copied. In Safari: bookmark this page, name it ★ Forkcast, then edit the bookmark and paste this as its address.'))">Copy the button</button>, then in Safari bookmark any page, name it <b>★ Forkcast</b>, edit it and paste as the address. On the supermarket site, type "Forkcast" in the address bar and tap it.</p>
    <p class="small dim" style="margin:8px 0 0">Why a bookmark? For your safety, browsers never let one website change another website's basket. A bookmark you add yourself runs on the supermarket's own page, so it can.</p></div>`;
}
const short = s => s.length > 30 ? s.slice(0, 28) + "…" : s;
function swapLine(shop, item, k) { const m = { ...(S.swaps[shop] || {}) }; k == null ? delete m[item] : m[item] = k; S.swaps[shop] = m; save(); render(); }
let HELPER = !!document.documentElement.dataset.fcHelper;
setTimeout(() => { if (!HELPER && document.documentElement.dataset.fcHelper) { HELPER = true; render(); } }, 1500);
function copyList(id) { const r = S.job.retailers[id], v = shopView(r);
  navigator.clipboard?.writeText(v.lines.map(l => l.missing ? `${l.name} (${fmtQty(l.qty, l.unit)}) - elsewhere` : `${l.packs} x ${l.product.name} ${l.product.size || ""} - ${money(l.cost)}`).join("\n")).then(() => alert("Copied")); }

// ---------------------------------------------------------------- 4. cook
function recipes() {
  const who = (+prefs().adults || 2) + .6 * (+prefs().children || 0);
  let h = head("Step 4", "Let's", "cook.", "Quantities scaled for your household. Rate each one after you've cooked it: 4–5★ and ♥ come up more often, 1★ never again.");
  for (const d of S.plan.days) for (const slot of MEALS) {
    const r = RECIPES[d[slot]]; if (!r || (slot === "lunch" && d.lunchLeftovers)) continue;
    const nextDay = S.plan.days.find(x => x.day === DAYS[(DAYS.indexOf(d.day) + 1) % 7]);
    const double = slot === "dinner" && nextDay?.lunchLeftovers && nextDay.lunch === d.dinner;
    const k = who * (double ? 2 : 1) / (r.serves || 4);
    h += fold(`<span style="color:var(--tom-ink);font:700 15px/1 var(--font-head);letter-spacing:.08em;text-transform:uppercase;min-width:84px">${d.day} ${slot === "dinner" ? "" : slot}</span>${esc(r.name)}`, `${r.time} min`,
      `<div class="row" style="justify-content:space-between;margin-bottom:6px"><p class="recipe meta" style="margin:0">${r.kcal} kcal · ${r.protein_g} g protein · serves ${Math.round(who * (double ? 2 : 1) * 10) / 10}${double ? ` · <span style="color:var(--tom-ink)">makes double: half is ${esc(nextDay.day)}'s lunch</span>` : ""}</p><span class="row" style="gap:2px">${starsHTML(r.id)}${heart(r.id)}</span></div>
      <div class="two"><ul class="ing">${r.ingredients.map(i => `<li><span class="num">${fmtQty(Math.ceil(i.qty * k), i.unit)}</span><span>${esc((C.ingredients[i.item] || {}).name || i.item)}${i.note ? ` <span class="dim small">${esc(i.note)}</span>` : ""}</span></li>`).join("")}</ul>
      <ol class="steps-list">${r.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></div>`);
  }
  return h + nextBar("Enjoy. Rate the meals you liked.", "Plan next week", "go(0)");
}

// ---------------------------------------------------------------- boot
api("/api/content").then(c => { C = c; RECIPES = Object.fromEntries(c.recipes.map(r => [r.id, r])); if (S.step > 3) S.step = S.pick ? 2 : 1; if (S.step > maxStep()) S.step = maxStep(); render(); poll(); })
  .catch(e => { $("#view").innerHTML = `<p class="miss" style="margin-top:30px">Couldn't load Forkcast: ${esc(e.message)}</p>`; });
render();
