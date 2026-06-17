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

/* count → class (mono-blue ramp; shared by popup badge + legend) */
const COUNT_CLASSES = [
  { max: 0,        color: "#555555", text: "#dddddd", label: "none" },
  { max: 2,        color: "#15405f", text: "#dfeefb", label: "1–2" },
  { max: 5,        color: "#1f6dab", text: "#ffffff", label: "3–5" },
  { max: 10,       color: "#2493F2", text: "#ffffff", label: "6–10" },
  { max: 25,       color: "#67b4f7", text: "#0c2f4a", label: "11–25" },
  { max: Infinity, color: "#a9d4fb", text: "#0c2f4a", label: "26+" }
];
const countClass = (n) => (n == null || n <= 0) ? COUNT_CLASSES[0] : COUNT_CLASSES.find(c => n <= c.max);
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

  /* ---- Dark basemap (CARTO dark matter, keyless) ---- */
  const basemap = new Basemap({
    baseLayers: [ new WebTileLayer({
      urlTemplate: "https://{subDomain}.basemaps.cartocdn.com/dark_all/{level}/{col}/{row}.png",
      subDomains: ["a", "b", "c", "d"],
      copyright: "&copy; OpenStreetMap contributors &copy; CARTO"
    })],
    title: "Dark Matter"
  });

  /* ---- Layers (thin outlines, no fill) ---- */
  const buildings = new FeatureLayer({
    portalItem: { id: CONFIG.buildingsItemId },
    title: "Building footprints",
    outFields: ["CountRTU", "address", "type", "year_built", "sq_ft", "source_id"],
    renderer: { type: "simple", symbol: outline([158, 158, 158, 0.55], 0.5), label: "Building footprint" }
  });

  const detections = new FeatureLayer({
    portalItem: { id: CONFIG.detectionsItemId },
    title: "RTU detections",
    outFields: [CONFIG.confField],
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
  if (CONFIG.orthoItemId) ortho = new TileLayer({ portalItem: { id: CONFIG.orthoItemId }, title: "Masked ortho (7.5 cm)" });

  const layers = [];
  if (ortho) layers.push(ortho);
  layers.push(buildings);
  if (evalLayer) layers.push(evalLayer);
  layers.push(detections); // top of stack

  /* ---- Map & view ---- */
  const map = new Map({ basemap, layers });
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
  let anchor = null, hi = null;

  async function highlight(graphic) {
    if (hi) { hi.remove(); hi = null; }
    try { const lv = await view.whenLayerView(graphic.layer); hi = lv.highlight(graphic); } catch (e) {}
  }
  function hideInfo() { infoEl.hidden = true; anchor = null; if (hi) { hi.remove(); hi = null; } }
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
    const n = a.CountRTU, cc = countClass(n), none = (n == null || n <= 0);
    const title = clean(a.address) ? String(a.address).split(";")[0].trim() : "Building";
    const bits = [];
    if (clean(a.type)) bits.push("<b>" + a.type + "</b>");
    if (clean(a.year_built)) bits.push("Built " + a.year_built);
    if (clean(a.sq_ft)) bits.push(a.sq_ft + " ft²");
    return '<div class="ip-head">Building</div><div class="ip-title">' + title + "</div>" +
      '<div class="ip-body"><span class="count-badge" style="background:' + cc.color + ';color:' + cc.text + '">' +
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
    const a = g.attributes;
    infoBody.innerHTML = g.layer === detections ? rtuHTML(a) : g.layer === buildings ? bldHTML(a) : evalHTML(a);
    anchor = mapPoint || (g.geometry && (g.geometry.centroid || (g.geometry.extent && g.geometry.extent.center))) || null;
    highlight(g);
    infoEl.hidden = false;
    positionInfo();
  }

  view.on("click", async (event) => {
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
    const op = new Slider({ container: "orthoOpacity", min: 0, max: 100, values: [100], steps: 5, visibleElements: { labels: false, rangeLabels: true }, labelFormatFunction: v => v + "%" });
    const apply = v => { ortho.opacity = v / 100; valEl.textContent = Math.round(v) + "%"; };
    op.on(["thumb-drag", "thumb-change"], e => apply(e.value != null ? e.value : op.values[0]));
  }

  /* confidence filter */
  const confValEl = $("confVal"), confCountEl = $("confCount");
  const confSlider = new Slider({ container: "confSlider", min: CONFIG.confMin, max: CONFIG.confMax, values: [CONFIG.confMin], steps: 0.5, snapOnClickEnabled: true, visibleElements: { labels: false, rangeLabels: true }, labelFormatFunction: v => v + "%" });
  function setConf(v, doCount) {
    v = Math.round(v * 10) / 10;
    confValEl.textContent = v + "%";
    detections.definitionExpression = CONFIG.confField + " >= " + v;
    if (doCount) detections.queryFeatureCount({ where: detections.definitionExpression })
      .then(n => { confCountEl.textContent = "Showing " + n.toLocaleString() + " of " + CONFIG.totalDetections.toLocaleString() + " detections."; }).catch(() => {});
  }
  confSlider.on("thumb-drag", e => setConf(e.value, e.state === "stop"));
  confSlider.on("thumb-change", e => setConf(e.value, true));
  setConf(CONFIG.confMin, true);

  /* count ramp legend */
  const rampEl = $("countRamp");
  COUNT_CLASSES.forEach(c => { const s = document.createElement("div"); s.className = "seg"; s.style.background = c.color; s.title = c.label; rampEl.appendChild(s); });

  /* sidebar collapse */
  $("sidebarToggle").addEventListener("click", () => $("app").classList.toggle("collapsed"));

  /* ---- Load ---- */
  view.when(() => {
    Promise.all([buildings.when().catch(() => {}), detections.when().catch(() => {})]).then(() => setStatus(null));
  }, () => setStatus("Failed to load the map.", true));

  window.__rtu = { view, map, buildings, detections, evalLayer, ortho, CONFIG, showInfo };
});
