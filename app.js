/* Rooftop Unit (RTU) Detection Dashboard — Moncton, NB
 * Licker Geospatial × ReCover.  ArcGIS Maps SDK for JS 4.31 (CDN AMD, no build).
 */

const CONFIG = {
  detectionsItemId: "69530e45a4334f2994c33369058560e1", // rtu_detections_moncton (Confidence 0–100)
  buildingsItemId:  "331c90a3a3b042f4ba9a454ea9349ac1", // part3_buildings_moncton (CountRTU; null/0 = none)
  evalItemId:       "a5c11039ebf94acb873486277154c985", // eval_moncton (result TP/FP/FN)
  orthoItemId:      null,                                // set when the .tpkx tile layer is published

  confField: "Confidence",
  confMin: 85,
  confMax: 100,
  totalDetections: 2955,

  // Initial / fallback frame + pan limit for the Moncton–Dieppe AOI
  center: [-64.73, 46.105],
  zoom: 12,
  aoi: { xmin: -65.00, ymin: 45.97, xmax: -64.54, ymax: 46.25 }
};

const EMBED = (() => { const p = new URLSearchParams(location.search); return p.has("embed") && p.get("embed") !== "0"; })();
if (EMBED) document.body.classList.add("embed");

/* count → class (shared by popup badge + legend ramp) */
const COUNT_CLASSES = [
  { max: 0,        color: "#C4CCCE", label: "none" },
  { max: 2,        color: "#FBDCBC", label: "1–2" },
  { max: 5,        color: "#F2A36B", label: "3–5" },
  { max: 10,       color: "#E8743C", label: "6–10" },
  { max: 25,       color: "#CC4B24", label: "11–25" },
  { max: Infinity, color: "#93260F", label: "26+" }
];
function countClass(n) {
  if (n == null || n <= 0) return COUNT_CLASSES[0];
  return COUNT_CLASSES.find(c => n <= c.max);
}

require([
  "esri/Map", "esri/views/MapView", "esri/Basemap",
  "esri/layers/WebTileLayer", "esri/layers/FeatureLayer", "esri/layers/TileLayer",
  "esri/widgets/Zoom", "esri/widgets/Home", "esri/widgets/Fullscreen", "esri/widgets/ScaleBar", "esri/widgets/Slider",
  "esri/geometry/Extent"
], function (Map, MapView, Basemap, WebTileLayer, FeatureLayer, TileLayer, Zoom, Home, Fullscreen, ScaleBar, Slider, Extent) {
  "use strict";

  const statusEl = document.getElementById("status");
  const setStatus = (m, err) => {
    if (!statusEl) return;
    if (m === null) return statusEl.classList.add("hidden");
    statusEl.textContent = m; statusEl.classList.toggle("error", !!err); statusEl.classList.remove("hidden");
  };
  const noFill = [0, 0, 0, 0];
  const outline = (rgba, width) => ({ type: "simple-fill", color: noFill, outline: { color: rgba, width } });

  /* ---- Basemap: CARTO Positron (keyless, neutral) ---- */
  const basemap = new Basemap({
    baseLayers: [ new WebTileLayer({
      urlTemplate: "https://{subDomain}.basemaps.cartocdn.com/light_all/{level}/{col}/{row}.png",
      subDomains: ["a", "b", "c", "d"],
      copyright: "&copy; OpenStreetMap contributors &copy; CARTO"
    })],
    title: "Positron"
  });

  /* ---- Buildings: outline only (count lives in the popup) ---- */
  const buildings = new FeatureLayer({
    portalItem: { id: CONFIG.buildingsItemId },
    title: "Building footprints",
    renderer: { type: "simple", symbol: outline([110, 150, 150, 0.9], 0.75), label: "Building footprint" },
    popupTemplate: {
      outFields: ["*"],
      title: (f) => {
        const a = f.graphic.attributes.address;
        return (!a || a === "..") ? "Building" : String(a).split(";")[0].trim();
      },
      content: (f) => {
        const a = f.graphic.attributes, n = a.CountRTU, cc = countClass(n);
        const none = (n == null || n <= 0);
        const el = document.createElement("div"); el.className = "pop";
        el.innerHTML =
          '<span class="count-badge" style="background:' + cc.color + '">' +
            (none ? "None" : n + ' <small>units</small>') + "</span>" +
          '<div class="pop-sub">' + (none ? "no rooftop units detected" : "rooftop units detected") + "</div>";
        const bits = [];
        const add = (v, fmt) => { if (v != null && v !== "" && v !== "..") bits.push(fmt(v)); };
        add(a.type, v => "<b>" + v + "</b>");
        add(a.year_built, v => "Built " + v);
        add(a.sq_ft, v => v + " ft²");
        if (bits.length) {
          const m = document.createElement("div"); m.className = "pop-meta";
          m.innerHTML = bits.join(" &middot; "); el.appendChild(m);
        }
        return el;
      }
    }
  });

  /* ---- RTU detections: outline only, vivid blue (visual hierarchy) ---- */
  const detections = new FeatureLayer({
    portalItem: { id: CONFIG.detectionsItemId },
    title: "RTU detections",
    renderer: { type: "simple", symbol: outline([30, 139, 224, 1], 1.75), label: "RTU detection" },
    popupTemplate: {
      outFields: [CONFIG.confField],
      title: "RTU detection",
      content: (f) => {
        const c = f.graphic.attributes[CONFIG.confField];
        const pct = Math.round(c * 10) / 10;
        const w = Math.max(0, Math.min(100, (c - 85) / 15 * 100));
        const el = document.createElement("div"); el.className = "pop";
        el.innerHTML =
          '<div class="pop-big rtu">' + pct + '<span style="font-size:16px">%</span></div>' +
          '<div class="pop-sub">detection confidence</div>' +
          '<div class="conf-bar"><i style="width:' + w + '%"></i></div>';
        return el;
      }
    }
  });

  /* ---- Eval (validation sample) — off by default ---- */
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
          { value: "TP", label: "Correct (TP)",        symbol: outline([46, 139, 87, 1], 1.4) },
          { value: "FP", label: "False positive (FP)", symbol: outline([214, 69, 69, 1], 1.4) },
          { value: "FN", label: "Missed (FN)",         symbol: outline([232, 163, 61, 1], 1.4) }
        ]
      },
      popupTemplate: {
        title: "Validation: {result}",
        content: "IoU {iou}, confidence {conf}"
      }
    });
  }

  /* ---- Optional ortho ---- */
  let ortho = null;
  if (CONFIG.orthoItemId) {
    ortho = new TileLayer({ portalItem: { id: CONFIG.orthoItemId }, title: "Masked ortho (7.5 cm)" });
  }

  const layers = [];
  if (ortho) layers.push(ortho);
  layers.push(buildings);
  if (evalLayer) layers.push(evalLayer);
  layers.push(detections); // top of the stack → visual hierarchy

  /* ---- Map & view ---- */
  const map = new Map({ basemap, layers });
  const view = new MapView({
    container: "viewDiv",
    map,
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    highlightOptions: { color: [242, 163, 107, 1], haloOpacity: 0.95, fillOpacity: 0.12 },
    popup: { dockEnabled: false, collapseEnabled: false, buttonEnabled: false },
    constraints: {
      minZoom: 10, maxZoom: 21, rotationEnabled: false, snapToZoom: false,
      geometry: new Extent({ ...CONFIG.aoi, spatialReference: { wkid: 4326 } })
    }
  });
  view.ui.components = ["attribution"]; // drop defaults; re-add a flat, ordered cluster

  /* widgets (flat, top-right) */
  view.ui.add(new Zoom({ view }), "top-right");
  view.ui.add(new Home({ view }), "top-right");
  view.ui.add(new Fullscreen({ view }), "top-right");
  view.ui.add(new ScaleBar({ view, unit: "metric" }), "bottom-right");

  /* ---- Custom layer toggles ---- */
  const togglesEl = document.getElementById("layerToggles");
  const toggleDefs = [
    { layer: detections, label: "RTU detections", sw: '<span class="sw" style="border:2px solid #1E8BE0"></span>' },
    evalLayer ? { layer: evalLayer, label: "Model validation (508 bldgs)", sw: '<span class="sw" style="border:2px solid #2E8B57"></span>' } : null,
    { layer: buildings, label: "Building footprints", sw: '<span class="sw" style="border:1.5px solid #6E9696"></span>' },
    ortho ? { layer: ortho, label: "Masked ortho (7.5 cm)", sw: '<span class="sw" style="background:linear-gradient(135deg,#6e6258,#8c7c6a)"></span>' } : null
  ].filter(Boolean);

  toggleDefs.forEach((d) => {
    const row = document.createElement("label");
    row.className = "toggle" + (d.layer.visible ? "" : " is-off");
    row.innerHTML =
      '<input type="checkbox" ' + (d.layer.visible ? "checked" : "") + ">" +
      '<span class="box"></span>' + d.sw +
      '<span class="tg-label">' + d.label + "</span>";
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => { d.layer.visible = cb.checked; row.classList.toggle("is-off", !cb.checked); });
    togglesEl.appendChild(row);
  });

  /* ---- Ortho opacity (only when present) ---- */
  if (ortho) {
    document.getElementById("orthoControl").hidden = false;
    document.querySelector(".lg-ortho").hidden = false;
    const valEl = document.getElementById("orthoOpacityVal");
    const op = new Slider({ container: "orthoOpacity", min: 0, max: 100, values: [100], steps: 5, visibleElements: { labels: false, rangeLabels: true }, labelFormatFunction: v => v + "%" });
    const apply = v => { ortho.opacity = v / 100; valEl.textContent = Math.round(v) + "%"; };
    op.on(["thumb-drag", "thumb-change"], e => apply(e.value != null ? e.value : op.values[0]));
  }

  /* ---- Confidence filter ---- */
  const confValEl = document.getElementById("confVal");
  const confCountEl = document.getElementById("confCount");
  const confSlider = new Slider({
    container: "confSlider", min: CONFIG.confMin, max: CONFIG.confMax, values: [CONFIG.confMin],
    steps: 0.5, snapOnClickEnabled: true, visibleElements: { labels: false, rangeLabels: true }, labelFormatFunction: v => v + "%"
  });
  function setConf(v, doCount) {
    v = Math.round(v * 10) / 10;
    confValEl.textContent = v + "%";
    detections.definitionExpression = CONFIG.confField + " >= " + v;
    if (doCount) {
      detections.queryFeatureCount({ where: detections.definitionExpression }).then(n => {
        confCountEl.textContent = "Showing " + n.toLocaleString() + " of " + CONFIG.totalDetections.toLocaleString() + " detections.";
      }).catch(() => {});
    }
  }
  confSlider.on("thumb-drag", e => setConf(e.value, e.state === "stop"));
  confSlider.on("thumb-change", e => setConf(e.value, true));
  setConf(CONFIG.confMin, true);

  /* ---- Build the count ramp legend ---- */
  const rampEl = document.getElementById("countRamp");
  COUNT_CLASSES.forEach((c) => {
    const seg = document.createElement("div"); seg.className = "seg";
    seg.style.background = c.color;
    seg.innerHTML = '<span>' + c.label + "</span>";
    rampEl.appendChild(seg);
  });

  /* ---- Sidebar collapse ---- */
  document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.getElementById("app").classList.toggle("collapsed");
  });

  /* ---- Frame the AOI ----
   * The hosted layers are stored in a native projection (wkid 2036); projecting
   * their extent in goTo is unreliable (variable scale). The constructor
   * center/zoom already frames the AOI deterministically, so we just confirm load.
   * The Home button returns to this same initial viewpoint. */
  view.when(() => {
    Promise.all([buildings.when().catch(() => {}), detections.when().catch(() => {})])
      .then(() => setStatus(null));
  }, () => setStatus("Failed to load the map.", true));

  window.__rtu = { view, map, buildings, detections, evalLayer, ortho, CONFIG, setConf };
});
