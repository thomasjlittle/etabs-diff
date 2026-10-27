# keepTABS Viewer

A simple 3D viewer for the output of the keepTABS diff engine (`backend/diff_engine/`). The engine compares two ETABS exports of the same model and writes a JSON diff. This page draws every element in that diff: unchanged elements in transparent gray, anything that changed (added, removed, modified, or affected) in red.

![Viewer showing the example diff](screenshot.png)

It's one static HTML file. There's no install and no build step. It loads three.js 0.160.0 from the jsDelivr CDN, so it needs internet access.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole viewer. |
| `contract.ts` | The exact shape of the diff JSON. This is the source of truth. |
| `CONTRACT.md` | The same contract explained field by field. Start here. |
| `example-diff.json` | A made-up 3-story, 2x2-bay steel building with elements in every status, so you can work on the viewer without the engine. |
| `models/` | Six versions of a small hackathon model (`Hack_v01`, `Hack_v01a`, `Hack_v02`, `Hack_v02a` in lb and ft, `Hack_v03`, `Hack_v04`). |
| `diffs/` | The engine's diff of every ordered pair of `models/`, plus `manifest.json` listing the models. Rebuild with `just demo-diffs`. |

## Opening It

Either works:

- **From disk:** double-click `index.html`. Load a diff with the file picker or by dragging the JSON onto the page. The "Load example" button can't read neighboring files from a `file://` page (browsers block it), so it opens the picker and you pick `example-diff.json`.
- **From a static server** (makes "Load example" one click): from this folder run `python -m http.server 8000` and open http://localhost:8000.
- **Straight to a diff:** put the JSON in the served folder and open `index.html?diff=<relative path>`, e.g. http://localhost:8000/?diff=example-diff.json. Handy for sharing a link to one comparison.

**Comparing the bundled models:** when the page is served, Before and After dropdowns show up next to the file picker, filled from `diffs/manifest.json`. Changing either one loads that pair from `diffs/`, and the pair goes in the URL (`?before=Hack_v03&after=Hack_v04`) so a comparison can be shared. Picking the same model on both sides draws everything gray. With no `?diff=` or pair in the URL it opens on the first two models. `just demo` from the repo root serves this folder and opens it.

![Before/After dropdowns on Hack_v03 to Hack_v04](compare.png)

Controls: left drag to orbit, right drag to pan, scroll to zoom. The top right shows the counts per status plus the number of table changes. If nothing in 3D changed but the tables did, a red note under the counts says so.

Filters sit in the top bar. **Red** turns each status on or off, **Affects** keeps an element red only if one of its changes touches an enabled category (affected elements use their upstream definition's categories; added and removed elements have none, so only their status toggle applies), and **Story** fades everything off the chosen story. A filtered-out element draws gray like unchanged, so the model stays whole. The counts follow what's shown, and the filters are saved in the URL (`&status=`, `&affects=`, `&story=`) so a filtered view can be shared as a link.

Click (or tap) an element to see its label, story, kind, status, each change (field, before, after, affects) and, for affected elements, the `via` list. Click empty space or Clear to drop the selection. The selected element turns blue.

The side panel also lists every table in the diff's `tables` (stories, materials, sections, load patterns, and any extra tables the engine adds) as added, removed, or modified with before and after values. Click a modified row to highlight in blue every member whose `via` names it.

## Loading a Real Engine Output

Run the engine on two `.e2k` files and load the JSON it writes, the same way you'd load the example. Anything that follows `contract.ts` will draw. If the page says it's not an etabs-diff output, the file is missing the `elements` array.

`example-diff.json` is a stand-in for working on the viewer without the engine. If you change the example, keep it valid against `contract.ts` and keep `summary` matching the element counts.

## How It Draws

- `frame` elements are lines between their two `geometry` points.
- `area` elements are filled faces through their corners (fan triangulated, which is right for convex shapes).
- `point` elements are small square markers.
- `status === "unchanged"` is gray and transparent. Every other status is red.
- Coordinates are in inches, Z up, straight from `geometry`. The camera frames the whole model on load.

## Follow-Up Ideas

Not built yet, in rough priority order:

1. Separate colors per status (e.g. green added, red removed, orange modified, yellow affected).
2. Thicker lines for red frames (WebGL lines are always 1px; three.js `Line2` fixes this).
3. Proper triangulation for non-convex areas (L-shaped slabs or walls) with `THREE.ShapeUtils`.
4. Warn when `schemaVersion` isn't `"0.1"`.
