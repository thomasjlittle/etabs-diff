# etabs-diff

Visual diff for ETABS models. Point it at two exports of the same model (`.e2k` or the `.$et` ETABS writes on save) and it shows what changed: members added, removed, or modified in a 3D view, plus tables for the non-spatial stuff like materials, load cases, and combos.

# Quick start

Needs Python 3.9+ (stdlib only). From the repo root:

```
python3 -m diff_engine before.e2k after.e2k --view
```

That diffs the two files, serves the viewer on 127.0.0.1, prints the URL, and tries to open it in your browser (under WSL it may not, so open the printed URL yourself). You'll see the model in 3D with unchanged elements in gray and anything that changed in red (the viewer loads three.js from a CDN, so it needs internet). Ctrl+C stops it. The diff JSON goes to a temp file, or to `-o diff.json` if you pass one. Without `--view` the CLI works as before and prints or writes the JSON. Add `--csv changes.csv` to also write the changes as a spreadsheet-friendly list, one row per change (works with `-o` and `--view`).

With [just](https://github.com/casey/just) installed:

| Recipe | What it does |
| --- | --- |
| `just` | list the recipes |
| `just view before.e2k after.e2k` | diff two files and open the viewer on the result |
| `just csv before.e2k after.e2k changes.csv` | diff two files and write the CSV change report |
| `just demo` | diff the bundled demo pair in `fixtures/demo/` and open the viewer on it |
| `just example` | open the viewer on the bundled example diff |
| `just typecheck` | type-check `diff_engine/` with pyright in strict mode |
| `just test` | type-check, then run the diff engine tests |

`just typecheck` (and so `just test`) needs [pyright](https://github.com/microsoft/pyright) on your PATH (`npm install -g pyright` or `pip install pyright`). It's a dev tool only, the engine itself stays stdlib only.

# Links
[Miro](https://miro.com/welcomeonboard/UlBzSDVtUjZIMHlLU2pQRjkzNlZZSTJhUXhlTlkvSlJwdjU1WmNMTFk2MXdUVDNVeEp3Vk1sd3p3ZjFzSmRhS3orYmtFTWhVWnQrQmhWeUVrRjRDemZhdkJDbDhrdTFuNzZYL1ZUOXdGZDBJZittcG1pVHBta0U2MllVc2FpR3dBd044SHFHaVlWYWk0d3NxeHNmeG9BPT0hdjE=?share_link_id=573872713675)
