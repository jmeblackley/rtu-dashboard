# Rooftop Unit Detection — Moncton, NB

An embeddable web dashboard showcasing automated rooftop-unit (RTU) detection over Moncton, New Brunswick, from 7.5 cm orthoimagery. Built for the ReCover Initiative; analysis by Licker Geospatial Consulting.

Static single-page app (ArcGIS Maps SDK for JavaScript 4.31, no build step) over public ArcGIS Online layers.

## Layers (public AGOL items, org `oomh8HZ3HzM4fYHL`)

| Layer | Item id | Notes |
|---|---|---|
| RTU detections | `69530e45a4334f2994c33369058560e1` | `Confidence` 0–100; outline only |
| Building footprints | `331c90a3a3b042f4ba9a454ea9349ac1` | `CountRTU` per building (in popup) |
| Model validation (508 bldgs) | `a5c11039ebf94acb873486277154c985` | `result` TP/FP/FN; off by default |
| Masked ortho (7.5 cm) | `87a5bf4db71349d48512494f1b9af86f` | Web Mercator hosted tile layer |

## Run locally

Any static server, e.g.:

```
npx http-server . -p 8787 -c-1
```

Then open `http://localhost:8787`. Headline metrics, layer item ids, and the AOI frame are configured at the top of `app.js` (`CONFIG`).

## Embed

```html
<iframe src="https://<user>.github.io/rtu-dashboard/?embed=1"
        width="100%" height="640" style="border:0"
        title="Moncton RTU Detection Dashboard" loading="lazy" allowfullscreen></iframe>
```

`?embed=1` hides the brand header and credit for a clean embedded view.

## Notes

- The AGOL layers must remain shared publicly for the no-login dashboard to load.
- Requires an internet connection at runtime (AGOL layers + Esri CDN); there is no offline mode.
