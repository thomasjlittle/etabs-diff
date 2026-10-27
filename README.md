# etabs-diff

Visual diff for ETABS models. Point it at two exports of the same model (`.e2k` or the `.$et` ETABS writes on save) and it shows what changed: members added, removed, or modified in a 3D view, plus tables for the non-spatial stuff like materials, load cases, and combos.

# Quick start

Needs Python 3.9+ (stdlib only). The engine lives in `backend/diff_engine/` and the viewer in `frontend/demo_viewer/`. From `backend/`:

```
python3 -m diff_engine before.e2k after.e2k --view
```

That diffs the two files, serves the viewer on 127.0.0.1, prints the URL, and tries to open it in your browser (under WSL it may not, so open the printed URL yourself). You'll see the model in 3D with unchanged elements in gray and anything that changed in red (the viewer loads three.js from a CDN, so it needs internet). Ctrl+C stops it. The diff JSON goes to a temp file, or to `-o diff.json` if you pass one. Without `--view` the CLI works as before and prints or writes the JSON. Add `--csv changes.csv` to also write the changes as a spreadsheet-friendly list, one row per change (works with `-o` and `--view`).

To try it on a real model first, run `just demo` from the repo root (or `python3 -m diff_engine ../fixtures/hack/Hack_v01a.e2k ../fixtures/hack/Hack_v02.e2k --view` from `backend/`). That pair is a small 3-story hackathon model with one column rotated 90 degrees, one column resized, and a concrete section's material bumped from 4 ksi to 6 ksi.

With [just](https://github.com/casey/just) installed, from the repo root (the recipes point Python at `backend/`, so file paths stay relative to the root):

| Recipe | What it does |
| --- | --- |
| `just` | list the recipes |
| `just view before.e2k after.e2k` | diff two files and open the viewer on the result |
| `just csv before.e2k after.e2k changes.csv` | diff two files and write the CSV change report |
| `just demo` | diff the hackathon example pair in `fixtures/hack/` (`Hack_v01a.e2k` to `Hack_v02.e2k`) and open the viewer on it |
| `just demo-seeded` | diff the seeded synthetic pair in `fixtures/demo/` (the one the tests use) and open the viewer on it |
| `just example` | open the viewer on the bundled example diff |
| `just typecheck` | type-check `backend/diff_engine/` with pyright in strict mode |
| `just test` | type-check, then run the diff engine tests |

`just typecheck` (and so `just test`) needs [pyright](https://github.com/microsoft/pyright) on your PATH (`npm install -g pyright` or `pip install pyright`). It's a dev tool only, the engine itself stays stdlib only.

# Links
[Miro](https://miro.com/welcomeonboard/UlBzSDVtUjZIMHlLU2pQRjkzNlZZSTJhUXhlTlkvSlJwdjU1WmNMTFk2MXdUVDNVeEp3Vk1sd3p3ZjFzSmRhS3orYmtFTWhVWnQrQmhWeUVrRjRDemZhdkJDbDhrdTFuNzZYL1ZUOXdGZDBJZittcG1pVHBta0U2MllVc2FpR3dBd044SHFHaVlWYWk0d3NxeHNmeG9BPT0hdjE=?share_link_id=573872713675)
