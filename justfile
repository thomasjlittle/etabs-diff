# the engine lives in backend/diff_engine; file paths stay relative to the repo root
export PYTHONPATH := "backend"

# list recipes
default:
    @just --list

# diff two .e2k/.$et files and open the viewer on the result
view before after:
    python3 -m diff_engine "{{before}}" "{{after}}" --view

# diff two .e2k/.$et files and write the changes as a CSV report
csv before after out:
    python3 -m diff_engine "{{before}}" "{{after}}" --csv "{{out}}" --summary

# open the viewer on the hackathon models (frontend/demo_viewer/models/), Before/After dropdowns over all of them
demo:
    python3 -m diff_engine.serve

# open the viewer on the bundled example diff
example:
    python3 -m diff_engine.serve frontend/demo_viewer/example-diff.json

# egit: git-style log, show, diff, add, status, pull, push over the model history (just egit --help)
[no-cd]
[positional-arguments]
egit *args:
    @"{{justfile_directory()}}/egit" "$@"

# type-check backend/diff_engine with pyright in strict mode (pyrightconfig.json)
typecheck:
    pyright

# type-check, then run the diff engine tests and the React app's tests (installs the app first if needed)
test: typecheck
    python3 -m unittest discover -s backend/diff_engine/tests -t backend
    cd frontend && if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then npm ci; fi && npm test

# --- UI (the React app in frontend/, needs node and npm) ---

# show the UI: install if needed, start the dev server at http://127.0.0.1:5173, try to open a browser (Ctrl+C stops it)
ui:
    #!/usr/bin/env sh
    set -e
    cd frontend
    if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then npm ci; fi
    echo ""
    echo "  UI: http://127.0.0.1:5173  (Ctrl+C stops it)"
    echo ""
    (sleep 2; wslview http://127.0.0.1:5173 || xdg-open http://127.0.0.1:5173 || open http://127.0.0.1:5173) >/dev/null 2>&1 &
    exec npm run dev
