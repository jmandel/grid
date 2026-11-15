# Precise Ruler

Static web app (installable as an Android PWA) that draws a ruler, grid, or angle fan at true physical size.

- Browsers don't know a screen's physical size, so calibrate once against a bank card (85.60 mm), banknote, ruler, or known PPI. Stored as device pixels per mm, so browser zoom doesn't disturb it.
- The canvas is sized in exact device pixels; straight lines are snapped so each line centre is within ½ device pixel of its true position, and errors do not accumulate.
- Light/medium/heavy line widths are set in device pixels.
- "Print / SVG" emits the same pattern in real mm units with a 100 mm check bar.

Serve the folder with any static server (e.g. `python3 -m http.server`). The service worker needs HTTPS or localhost.
