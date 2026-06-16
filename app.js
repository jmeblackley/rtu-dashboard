/* Moncton Rooftop Unit (RTU) Detection Dashboard
 * ArcGIS Maps SDK for JavaScript 4.31 (CDN AMD, no build step).
 *
 * Data lives on ArcGIS Online (public hosted layers). Fill in orthoItemId /
 * evalItemId below as those layers come online — everything else works now.
 */

const CONFIG = {
  // Hosted feature layers (public). Single-layer services → FeatureLayer resolves
  // the sublayer automatically, so we never hardcode a /0 or /1 index.
  detectionsItemId: "69530e45a4334f2994c33369058560e1", // rtu_detections_moncton
  buildingsItemId:  "331c90a3a3b042f4ba9a454ea9349ac1", // part3_buildings_moncton (has CountRTU)

  // Set when the local .tpkx is published as a hosted tile layer:
  orthoItemId: null,   // e.g. "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  // Set when eval_run_001 is published public:
  evalItemId:  null,   // e.g. "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

  // Confidence field is on a 0–100 scale (range ~85–100).
  confField: "Confidence",
  confMin: 85,
  confMax: 100,

  // Initial view (Moncton, NB)
  center: [-64.78, 46.10],
  zoom: 13
};

const params = new URLSearchParams(window.location.search);
const EMBED = params.has("embed") && params.get("embed") !== "0";
if (EMBED) document.body.classList.add("embed");

require([
  "esri/Map",
  "esri/views/MapView",
  "esri/Basemap",
  "esri/layers/WebTileLayer",
  "esri/layers/FeatureLayer",
  "esri/layers/TileLayer",
  "esri/widgets/Legend",
  "esri/widgets/LayerList",
  "esri/widgets/Expand",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/ScaleBar",
  "esri/widgets/Slider"
], function (
  Map, MapView, Basemap, WebTileLayer, FeatureLayer, TileLayer,
  Legend, LayerList, Expand, Home, Search, ScaleBar, Slider
) {
  "use strict";

  const statusEl = document.getElementById("status");
  const setStatus = (msg, isError) => {
    if (!statusEl) return;
    if (msg === null) { statusEl.classList.add("hidden"); return; }
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
    statusEl.classList.remove("hidden");
  };

  // ---- Helpers ---------------------------------------------------------------
  const fill = (rgba, outline) => ({
    type: "simple-fill",
    color: rgba,
    outline: outline || { color: [255, 255, 255, 0.55], width: 0.3 }
  });

  // ---- Basemap: CARTO Positron (keyless, neutral / data-forward) -------------
  const basemap = new Basemap({
    baseLayers: [
      new WebTileLayer({
        urlTemplate: "https://{subDomain}.basemaps.cartocdn.com/light_all/{level}/{col}/{row}.png",
        subDomains: ["a", "b", "c", "d"],
        copyright: "&copy; OpenStreetMap contributors &copy; CARTO"
      })
    ],
    title: "Positron",
    id: "carto-positron"
  });

  // ---- Buildings: choropleth by CountRTU -------------------------------------
  const buildingsRenderer = {
    type: "class-breaks",
    field: "CountRTU",
    legendOptions: { title: "RTUs per building" },
    defaultSymbol: fill([224, 224, 224, 0.30]),
    defaultLabel: "no data",
    classBreakInfos: [
      { minValue: 0,    maxValue: 0.5,    symbol: fill([232, 232, 232, 0.28]), label: "0 (none)" },
      { minValue: 0.5,  maxValue: 2.5,    symbol: fill([255, 255, 178, 0.78]), label: "1–2" },
      { minValue: 2.5,  maxValue: 5.5,    symbol: fill([254, 204, 92, 0.82]),  label: "3–5" },
      { minValue: 5.5,  maxValue: 10.5,   symbol: fill([253, 141, 60, 0.85]),  label: "6–10" },
      { minValue: 10.5, maxValue: 25.5,   symbol: fill([240, 59, 32, 0.88]),   label: "11–25" },
      { minValue: 25.5, maxValue: 100000, symbol: fill([189, 0, 38, 0.90]),    label: "26+" }
    ]
  };

  const buildings = new FeatureLayer({
    portalItem: { id: CONFIG.buildingsItemId },
    title: "Building footprints (RTU count)",
    renderer: buildingsRenderer,
    outFields: ["CountRTU", "address", "type", "year_built", "source_id"],
    popupTemplate: {
      title: "{expression/bldgTitle}",
      outFields: ["*"],
      expressionInfos: [
        {
          name: "bldgTitle",
          title: "Building",
          expression:
            "var a = $feature.address;" +
            "if (IsEmpty(a) || a == '..') { return 'Building'; }" +
            "return Trim(Split(a, ';')[0]);"
        },
        {
          name: "detail",
          title: "Detail",
          expression:
            "var n = $feature.CountRTU;" +
            "var t = $feature.type; var y = $feature.year_built;" +
            "var html = \"<p style='font-size:15px;margin:0 0 6px'><b>\" + Text(n) + \"</b> rooftop unit(s) detected on this building.</p>\";" +
            "var sub = [];" +
            "if (!IsEmpty(t) && t != '..') { Push(sub, 'Type: ' + t); }" +
            "if (!IsEmpty(y) && y != '..') { Push(sub, 'Built: ' + y); }" +
            "if (Count(sub) > 0) { html += \"<p style='margin:0;color:#5a6573;font-size:12px'>\" + Concatenate(sub, ' &middot; ') + \"</p>\"; }" +
            "return html;"
        }
      ],
      content: [{ type: "text", text: "{expression/detail}" }]
    }
  });

  // ---- RTU detections: outline + fill tinted by Confidence -------------------
  const detectionsRenderer = {
    type: "simple",
    symbol: {
      type: "simple-fill",
      color: [0, 0, 0, 0],
      outline: { color: [40, 44, 51, 0.85], width: 0.75 }
    },
    label: "RTU detection",
    visualVariables: [{
      type: "color",
      field: CONFIG.confField,
      legendOptions: { title: "Detection confidence" },
      stops: [
        { value: 85,   color: [198, 219, 239, 0.50], label: "85%" },
        { value: 92.5, color: [66, 146, 198, 0.62] },
        { value: 100,  color: [8, 48, 107, 0.72], label: "100%" }
      ]
    }]
  };

  const detections = new FeatureLayer({
    portalItem: { id: CONFIG.detectionsItemId },
    title: "RTU detections",
    renderer: detectionsRenderer,
    outFields: [CONFIG.confField, "Class"],
    popupTemplate: {
      title: "RTU detection",
      expressionInfos: [{
        name: "conf",
        title: "Confidence",
        expression: "Round($feature." + CONFIG.confField + ", 1)"
      }],
      content: [{
        type: "text",
        text: "<p style='font-size:15px;margin:0'>Confidence: <b>{expression/conf}%</b></p>"
      }]
    }
  });

  // ---- Optional layers (added when their item ids are set) --------------------
  const layers = [];

  let ortho = null;
  if (CONFIG.orthoItemId) {
    ortho = new TileLayer({
      portalItem: { id: CONFIG.orthoItemId },
      title: "Masked ortho (7.5 cm)",
      opacity: 1
    });
    layers.push(ortho); // bottom (above basemap)
  }

  layers.push(buildings, detections);

  let evalLayer = null;
  if (CONFIG.evalItemId) {
    evalLayer = new FeatureLayer({
      portalItem: { id: CONFIG.evalItemId },
      title: "Model validation (508-building sample)",
      visible: false,
      outFields: ["result", "iou", "conf"],
      renderer: {
        type: "unique-value",
        field: "result",
        uniqueValueInfos: [
          { value: "TP", label: "Correct (true positive)", symbol: fill([0, 0, 0, 0], { color: [27, 158, 90, 0.95], width: 1.4 }) },
          { value: "FP", label: "False positive",          symbol: fill([0, 0, 0, 0], { color: [214, 39, 40, 0.95], width: 1.4 }) },
          { value: "FN", label: "Missed (false negative)", symbol: fill([0, 0, 0, 0], { color: [255, 159, 28, 0.95], width: 1.4 }) }
        ]
      },
      popupTemplate: {
        title: "Validation: {result}",
        content: "IoU: {iou}<br>Confidence: {conf}"
      }
    });
    layers.push(evalLayer);
  }

  // ---- Map & view ------------------------------------------------------------
  const map = new Map({ basemap: basemap, layers: layers });

  const view = new MapView({
    container: "viewDiv",
    map: map,
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    constraints: { snapToZoom: false },
    popup: { dockEnabled: false, collapseEnabled: false }
  });

  // Widgets
  view.ui.move("zoom", "top-right");
  view.ui.add(new Home({ view: view }), "top-right");
  view.ui.add(new ScaleBar({ view: view, unit: "metric" }), "bottom-right");

  const layerListExpand = new Expand({
    view: view,
    content: new LayerList({ view: view }),
    expandTooltip: "Layers",
    group: "top-right"
  });
  const legendExpand = new Expand({
    view: view,
    content: new Legend({ view: view }),
    expanded: !EMBED,
    expandTooltip: "Legend",
    group: "top-right"
  });
  view.ui.add([layerListExpand, legendExpand], "top-right");

  if (!EMBED) {
    const searchExpand = new Expand({
      view: view,
      content: new Search({ view: view }),
      expandTooltip: "Search address",
      group: "top-left-search"
    });
    view.ui.add(searchExpand, "top-left");
  }

  // ---- Confidence filter slider ----------------------------------------------
  const confValueEl = document.getElementById("confValue");
  const confSlider = new Slider({
    container: "confSlider",
    min: CONFIG.confMin,
    max: CONFIG.confMax,
    values: [CONFIG.confMin],
    steps: 0.5,
    snapOnClickEnabled: true,
    visibleElements: { labels: false, rangeLabels: true },
    labelFormatFunction: (v) => v + "%"
  });
  const applyConfidence = (v) => {
    if (confValueEl) confValueEl.textContent = Math.round(v * 10) / 10 + "%";
    detections.definitionExpression = CONFIG.confField + " >= " + v;
  };
  confSlider.on(["thumb-drag", "thumb-change", "segment-drag"], (e) => applyConfidence(e.value != null ? e.value : confSlider.values[0]));
  applyConfidence(CONFIG.confMin);

  // ---- Imagery opacity slider (only when ortho present) ----------------------
  if (ortho) {
    const block = document.getElementById("orthoBlock");
    const valEl = document.getElementById("orthoOpacityValue");
    if (block) block.hidden = false;
    const op = new Slider({
      container: "orthoOpacity",
      min: 0, max: 100, values: [100], steps: 5,
      visibleElements: { labels: false, rangeLabels: true },
      labelFormatFunction: (v) => v + "%"
    });
    const apply = (v) => { ortho.opacity = v / 100; if (valEl) valEl.textContent = Math.round(v) + "%"; };
    op.on(["thumb-drag", "thumb-change", "segment-drag"], (e) => apply(e.value != null ? e.value : op.values[0]));
  }

  // ---- Frame the data once loaded --------------------------------------------
  view.when(async () => {
    try {
      await buildings.when();
      if (buildings.fullExtent) {
        await view.goTo(buildings.fullExtent.expand(1.05), { animate: false });
      }
      setStatus(null);
    } catch (err) {
      console.error(err);
      setStatus("Loaded, but couldn't frame the data extent.", false);
    }
  }, (err) => {
    console.error(err);
    setStatus("Failed to load the map view.", true);
  });

  // Hide the loading toast once the layers report ready (fallback)
  Promise.all([detections.when().catch(() => {}), buildings.when().catch(() => {})])
    .then(() => setTimeout(() => setStatus(null), 600));

  // expose for debugging / console verification
  window.__rtu = { view, map, buildings, detections, evalLayer, ortho, CONFIG };
});
