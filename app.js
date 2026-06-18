/* Rooftop Unit (RTU) Detection Dashboard — Moncton, NB
 * Dark, minimal theme. ArcGIS Maps SDK for JS 4.31 (CDN AMD, no build).
 */

const CONFIG = {
  detectionsItemId: "69530e45a4334f2994c33369058560e1", // rtu_detections_moncton (Confidence 0–100)
  buildingsItemId:  "331c90a3a3b042f4ba9a454ea9349ac1", // part3_buildings_moncton (CountRTU; null/0 = none)
  evalItemId:       "a5c11039ebf94acb873486277154c985", // eval_moncton (result TP/FP/FN)
  orthoItemId:      "87a5bf4db71349d48512494f1b9af86f",  // hosted tile layer, Web Mercator, 7.5 cm (LOD 0–21)

  confField: "Confidence",
  confMin: 85,
  confMax: 100,
  totalDetections: 2955,

  center: [-64.73, 46.105],
  zoom: 12,
  aoi: { xmin: -65.00, ymin: 45.97, xmax: -64.54, ymax: 46.25 }
};

const EMBED = (() => { const p = new URLSearchParams(location.search); return p.has("embed") && p.get("embed") !== "0"; })();
if (EMBED) document.body.classList.add("embed");

/* theme: ?theme=light|dark wins (for embeds), else remembered choice, else dark */
const LIGHT = (() => {
  const t = new URLSearchParams(location.search).get("theme");
  if (t === "light") return true;
  if (t === "dark") return false;
  try { return localStorage.getItem("rtuTheme") === "light"; } catch (e) { return false; }
})();
if (LIGHT) document.body.classList.add("light");

const clean = (v) => (v != null && v !== "" && v !== "..");

require([
  "esri/Map", "esri/views/MapView", "esri/Basemap",
  "esri/layers/WebTileLayer", "esri/layers/FeatureLayer", "esri/layers/TileLayer",
  "esri/widgets/Zoom", "esri/widgets/Home", "esri/widgets/Fullscreen", "esri/widgets/ScaleBar", "esri/widgets/Slider",
  "esri/geometry/Extent", "esri/core/reactiveUtils"
], function (Map, MapView, Basemap, WebTileLayer, FeatureLayer, TileLayer, Zoom, Home, Fullscreen, ScaleBar, Slider, Extent, reactiveUtils) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const setStatus = (m, err) => {
    const s = $("status"); if (!s) return;
    if (m === null) return s.classList.add("hidden");
    s.textContent = m; s.classList.toggle("error", !!err); s.classList.remove("hidden");
  };
  const noFill = [0, 0, 0, 0];
  const outline = (rgba, width) => ({ type: "simple-fill", color: noFill, outline: { color: rgba, width } });
  /* building outline tuned per theme for contrast */
  const bldOutline = (light) => ({ type: "simple", symbol: outline(light ? [96, 96, 96, 0.85] : [158, 158, 158, 0.6], light ? 0.6 : 0.55), label: "Building footprint" });

  /* ---- Basemap (CARTO, keyless) — dark or light per theme ---- */
  const makeBasemap = (light) => new Basemap({
    baseLayers: [ new WebTileLayer({
      urlTemplate: "https://{subDomain}.basemaps.cartocdn.com/" + (light ? "light_all" : "dark_all") + "/{level}/{col}/{row}.png",
      subDomains: ["a", "b", "c", "d"],
      copyright: "&copy; OpenStreetMap contributors &copy; CARTO"
    })],
    title: light ? "Positron" : "Dark Matter"
  });

  /* ---- Layers (thin outlines, no fill) ---- */
  const buildings = new FeatureLayer({
    portalItem: { id: CONFIG.buildingsItemId },
    title: "Building footprints",
    outFields: ["CountRTU", "address", "type", "year_built", "sq_ft", "source_id"],
    renderer: bldOutline(LIGHT)
  });

  const detections = new FeatureLayer({
    portalItem: { id: CONFIG.detectionsItemId },
    title: "RTU detections",
    outFields: [CONFIG.confField, "source_id"],
    renderer: { type: "simple", symbol: outline([36, 147, 242, 1], 1), label: "RTU detection" }
  });

  let evalLayer = null;
  if (CONFIG.evalItemId) {
    evalLayer = new FeatureLayer({
      portalItem: { id: CONFIG.evalItemId },
      title: "Model validation",
      visible: false,
      outFields: ["result", "iou", "conf"],
      renderer: {
        type: "unique-value", field: "result",
        uniqueValueInfos: [
          { value: "TP", label: "Correct (TP)",        symbol: outline([54, 196, 106, 1], 1.1) },
          { value: "FP", label: "False positive (FP)", symbol: outline([255, 91, 110, 1], 1.1) },
          { value: "FN", label: "Missed (FN)",         symbol: outline([255, 177, 60, 1], 1.1) }
        ]
      }
    });
  }

  let ortho = null;
  if (CONFIG.orthoItemId) ortho = new TileLayer({ portalItem: { id: CONFIG.orthoItemId }, title: "Masked ortho (7.5 cm)", opacity: 0.5 });

  const layers = [];
  if (ortho) layers.push(ortho);
  layers.push(buildings);
  if (evalLayer) layers.push(evalLayer);
  layers.push(detections); // top of stack

  /* ---- Map & view ---- */
  const map = new Map({ basemap: makeBasemap(LIGHT), layers });
  const view = new MapView({
    container: "viewDiv", map, center: CONFIG.center, zoom: CONFIG.zoom,
    popupEnabled: false,
    highlightOptions: { color: [36, 147, 242, 1], haloOpacity: 0.95, fillOpacity: 0.10 },
    constraints: {
      minZoom: 10, maxZoom: 21, rotationEnabled: false, snapToZoom: false,
      geometry: new Extent({ ...CONFIG.aoi, spatialReference: { wkid: 4326 } })
    }
  });
  view.ui.components = ["attribution"];
  view.ui.add(new Zoom({ view }), "top-right");
  view.ui.add(new Home({ view }), "top-right");
  view.ui.add(new Fullscreen({ view }), "top-right");
  view.ui.add(new ScaleBar({ view, unit: "metric" }), "bottom-right");

  /* ===================== Custom popup ===================== */
  const infoEl = $("infoPopup"), infoBody = $("infoBody");
  let anchor = null, hiMain = null, hiRel = null;

  function clearHi() { if (hiMain) { hiMain.remove(); hiMain = null; } if (hiRel) { hiRel.remove(); hiRel = null; } }
  async function highlightMain(graphic) {
    try { const lv = await view.whenLayerView(graphic.layer); hiMain = lv.highlight(graphic); } catch (e) {}
  }
  async function highlightRelated(layer, oids) {
    if (!oids || !oids.length) return;
    try { const lv = await view.whenLayerView(layer); hiRel = lv.highlight(oids); } catch (e) {}
  }
  function hideInfo() { infoEl.hidden = true; infoEl.style.display = "none"; anchor = null; clearHi(); }
  function positionInfo() {
    if (!anchor || infoEl.hidden) return;
    let sp; try { sp = view.toScreen(anchor); } catch (e) { return; }
    if (!sp) return;
    const inView = sp.x >= 0 && sp.y >= 0 && sp.x <= view.width && sp.y <= view.height;
    infoEl.style.display = inView ? "block" : "none";
    infoEl.style.left = sp.x + "px"; infoEl.style.top = sp.y + "px";
  }

  function rtuHTML(a) {
    const c = a[CONFIG.confField], pct = Math.round(c * 10) / 10, w = Math.max(0, Math.min(100, (c - 85) / 15 * 100));
    return '<div class="ip-head">RTU detection</div>' +
      '<div class="ip-body"><div class="ip-big">' + pct + '<small>%</small></div>' +
      '<div class="ip-sub">detection confidence</div>' +
      '<div class="conf-bar"><i style="width:' + w + '%"></i></div></div>';
  }
  function bldHTML(a) {
    const n = a.CountRTU, none = (n == null || n <= 0);
    const title = clean(a.address) ? String(a.address).split(";")[0].trim() : "Building";
    const badgeStyle = none ? "background:#444;color:#bbb" : "background:#2493F2;color:#fff";
    const bits = [];
    if (clean(a.type)) bits.push("<b>" + a.type + "</b>");
    if (clean(a.year_built)) bits.push("Built " + a.year_built);
    if (clean(a.sq_ft)) bits.push(a.sq_ft + " ft²");
    return '<div class="ip-head">Building</div><div class="ip-title">' + title + "</div>" +
      '<div class="ip-body"><span class="count-badge" style="' + badgeStyle + '">' +
      (none ? "None" : n + " <small>units</small>") + "</span>" +
      '<div class="ip-sub">' + (none ? "no rooftop units detected" : "rooftop units detected") + "</div>" +
      (bits.length ? '<div class="ip-meta">' + bits.join(" &middot; ") + "</div>" : "") + "</div>";
  }
  function evalHTML(a) {
    const map3 = { TP: "Correct", FP: "False positive", FN: "Missed" };
    return '<div class="ip-head">Validation</div><div class="ip-title">' + (map3[a.result] || a.result) + "</div>" +
      '<div class="ip-body ip-meta" style="border-top:none;padding-top:9px">IoU ' +
      (a.iou != null ? Math.round(a.iou * 100) / 100 : "—") +
      (a.conf != null && a.conf >= 0 ? " &middot; confidence " + Math.round(a.conf * 10) / 10 + "%" : "") + "</div>";
  }

  const hitLayers = [detections, evalLayer, buildings].filter(Boolean);
  function topGraphic(results) {
    for (const lyr of hitLayers) {
      const hit = results.find(r => r.graphic && r.graphic.layer === lyr);
      if (hit) return hit.graphic;
    }
    return null;
  }
  function showInfo(g, mapPoint) {
    clearHi();
    const a = g.attributes;
    infoBody.innerHTML = g.layer === detections ? rtuHTML(a) : g.layer === buildings ? bldHTML(a) : evalHTML(a);
    anchor = mapPoint || (g.geometry && (g.geometry.centroid || (g.geometry.extent && g.geometry.extent.center))) || null;
    infoEl.hidden = false;
    positionInfo();
    highlightMain(g);
    // cross-link via source_id: building ↔ its RTUs
    const sid = a.source_id;
    if (sid) {
      if (g.layer === buildings) {
        detections.queryObjectIds({ where: "source_id = '" + sid + "'" }).then(ids => highlightRelated(detections, ids)).catch(() => {});
      } else if (g.layer === detections) {
        buildings.queryObjectIds({ where: "source_id = '" + sid + "'" }).then(ids => highlightRelated(buildings, ids)).catch(() => {});
      }
    }
  }

  async function frameAndShow(f) {
    const g = f.geometry;
    try { await view.goTo({ target: g.extent ? g.extent.expand(2.2) : g, zoom: 19 }, { animate: true }); } catch (e) {}
    showInfo(f, g.extent ? g.extent.center : (g.centroid || g));
  }

  view.on("click", async (event) => {
    const sr = $("searchResults"); if (sr) sr.hidden = true;
    let ht; try { ht = await view.hitTest(event, { include: hitLayers }); } catch (e) { return; }
    const g = topGraphic(ht.results);
    if (!g) return hideInfo();
    showInfo(g, event.mapPoint);
  });
  $("infoClose").addEventListener("click", hideInfo);
  reactiveUtils.watch(() => view.extent, positionInfo);
  view.on("resize", positionInfo);

  /* ===================== Sidebar controls ===================== */
  /* layer toggles */
  const togglesEl = $("layerToggles");
  [
    { layer: detections, label: "RTU detections", sw: 'border:1.5px solid #2493F2' },
    evalLayer ? { layer: evalLayer, label: "Model validation (508 bldgs)", sw: 'border:1.5px solid #36C46A' } : null,
    { layer: buildings, label: "Building footprints", sw: 'border:1px solid #9e9e9e' },
    ortho ? { layer: ortho, label: "Masked ortho (7.5 cm)", sw: 'background:linear-gradient(135deg,#5a5048,#7a6e5e)' } : null
  ].filter(Boolean).forEach((d) => {
    const row = document.createElement("label");
    row.className = "toggle" + (d.layer.visible ? "" : " is-off");
    row.innerHTML = '<input type="checkbox"' + (d.layer.visible ? " checked" : "") + '><span class="box"></span>' +
      '<span class="sw" style="' + d.sw + '"></span><span class="tg-label">' + d.label + "</span>";
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => { d.layer.visible = cb.checked; row.classList.toggle("is-off", !cb.checked); });
    togglesEl.appendChild(row);
  });

  /* ortho opacity */
  if (ortho) {
    $("orthoControl").hidden = false;
    document.querySelector(".lg-ortho").hidden = false;
    const valEl = $("orthoOpacityVal");
    const op = new Slider({ container: "orthoOpacity", min: 0, max: 100, values: [50], steps: 5, visibleElements: { labels: false, rangeLabels: true }, labelFormatFunction: v => v + "%" });
    const apply = v => { ortho.opacity = v / 100; valEl.textContent = Math.round(v) + "%"; };
    op.on(["thumb-drag", "thumb-change"], e => apply(e.value != null ? e.value : op.values[0]));
    apply(op.values[0]);
  }

  /* confidence filter */
  const confValEl = $("confVal"), confCountEl = $("confCount");
  const confSlider = new Slider({ container: "confSlider", min: CONFIG.confMin, max: CONFIG.confMax, values: [CONFIG.confMin], steps: 0.5, snapOnClickEnabled: true, visibleElements: { labels: false, rangeLabels: true }, labelFormatFunction: v => v + "%" });
  const mDetEl = $("m-det"), mWithEl = $("m-withrtu");
  function setConf(v, doCount) {
    v = Math.round(v * 10) / 10;
    confValEl.textContent = v + "%";
    const where = CONFIG.confField + " >= " + v;
    detections.definitionExpression = where;
    if (!doCount) return;
    detections.queryFeatureCount({ where }).then(n => {
      confCountEl.textContent = "Showing " + n.toLocaleString() + " of " + CONFIG.totalDetections.toLocaleString() + " detections.";
      if (mDetEl) mDetEl.textContent = n.toLocaleString();
    }).catch(() => {});
    detections.queryFeatures({ where: where + " AND source_id IS NOT NULL", returnDistinctValues: true, outFields: ["source_id"], returnGeometry: false })
      .then(r => { if (mWithEl) mWithEl.textContent = r.features.length.toLocaleString(); }).catch(() => {});
  }
  confSlider.on("thumb-drag", e => setConf(e.value, e.state === "stop"));
  confSlider.on("thumb-change", e => setConf(e.value, true));
  setConf(CONFIG.confMin, true);

  /* find a building — address search */
  const searchInput = $("searchInput"), searchResults = $("searchResults");
  const bldLabel = (a) => clean(a.address) ? String(a.address).split(";")[0].trim() : "Building";
  let searchTimer = null;
  async function runSearch(term) {
    const safe = term.replace(/'/g, "''");
    try {
      const r = await buildings.queryFeatures({
        where: "address LIKE '%" + safe + "%'",
        outFields: ["address", "source_id", "CountRTU"], returnGeometry: true,
        outSpatialReference: view.spatialReference, num: 8, orderByFields: ["CountRTU DESC"]
      });
      searchResults.innerHTML = "";
      if (!r.features.length) { searchResults.innerHTML = '<li class="empty">No match</li>'; searchResults.hidden = false; return; }
      r.features.forEach((f) => {
        const a = f.attributes, li = document.createElement("li");
        li.innerHTML = '<span class="r-addr">' + bldLabel(a) + '</span><span class="r-cnt">' + (a.CountRTU || 0) + "</span>";
        li.addEventListener("click", () => {
          searchResults.hidden = true; searchInput.value = bldLabel(a);
          f.layer = buildings; f.sourceLayer = buildings; frameAndShow(f);
        });
        searchResults.appendChild(li);
      });
      searchResults.hidden = false;
    } catch (e) {}
  }
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const term = searchInput.value.trim();
    if (term.length < 3) { searchResults.hidden = true; return; }
    searchTimer = setTimeout(() => runSearch(term), 250);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#find")) searchResults.hidden = true; });

  /* find a building — jump-to-example picker (top buildings by RTU count) */
  const hlSelect = $("highlightSelect"), hlFeats = {};
  buildings.queryFeatures({
    where: "CountRTU >= 5", outFields: ["address", "source_id", "CountRTU"], returnGeometry: true,
    outSpatialReference: view.spatialReference, num: 8, orderByFields: ["CountRTU DESC"]
  }).then((r) => {
    r.features.forEach((f, i) => {
      const a = f.attributes, key = (a.source_id || "f") + "_" + i, opt = document.createElement("option");
      opt.value = key; opt.textContent = bldLabel(a) + " — " + a.CountRTU + " units";
      hlFeats[key] = f; hlSelect.appendChild(opt);
    });
  }).catch(() => {});
  hlSelect.addEventListener("change", () => {
    const f = hlFeats[hlSelect.value];
    if (f) { f.layer = buildings; f.sourceLayer = buildings; frameAndShow(f); }
  });

  /* theme toggle (light / dark) — swaps basemap, building contrast, and logos */
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
  const LOGOS = {
    recover: { dark: "./images/Recover-Logo-Horizontal-light.svg", light: "./images/Recover-Logo-Horizontal.svg" },
    lgeo:    { dark: "./images/LGeo-logo_horizCard_white%20text.png", light: "./images/LGeo-logo_horizCard_bw.png" }
  };
  const themeBtn = $("themeToggle");
  function setThemeUI(light) {
    const themeLink = document.getElementById("esriTheme");
    if (themeLink) themeLink.href = "https://js.arcgis.com/4.31/esri/themes/" + (light ? "light" : "dark") + "/main.css";
    const rImg = document.querySelector(".brand-logo"); if (rImg) rImg.src = LOGOS.recover[light ? "light" : "dark"];
    const lImg = document.querySelector(".credit-logo"); if (lImg) lImg.src = LOGOS.lgeo[light ? "light" : "dark"];
    if (themeBtn) {
      themeBtn.innerHTML = light ? MOON : SUN;
      themeBtn.setAttribute("aria-pressed", String(light));
      const lbl = light ? "Switch to dark theme" : "Switch to light theme";
      themeBtn.title = lbl; themeBtn.setAttribute("aria-label", lbl);
    }
  }
  function applyTheme(light) {
    document.body.classList.toggle("light", light);
    map.basemap = makeBasemap(light);
    buildings.renderer = bldOutline(light);
    setThemeUI(light);
    try { localStorage.setItem("rtuTheme", light ? "light" : "dark"); } catch (e) {}
  }
  setThemeUI(LIGHT);
  if (themeBtn) themeBtn.addEventListener("click", () => applyTheme(!document.body.classList.contains("light")));

  /* sidebar collapse */
  $("sidebarToggle").addEventListener("click", () => $("app").classList.toggle("collapsed"));

  /* ---- Load ---- */
  view.when(() => {
    Promise.all([buildings.when().catch(() => {}), detections.when().catch(() => {})]).then(() => setStatus(null));
  }, () => setStatus("Failed to load the map.", true));

  window.__rtu = { view, map, buildings, detections, evalLayer, ortho, CONFIG, showInfo };
});
