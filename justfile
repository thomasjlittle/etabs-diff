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

# open the viewer on the hackathon models (frontend/demo_viewer/models/), Before/After dropdowns on Hack_v01a to Hack_v02
demo:
    python3 -m diff_engine.serve

# rediff every pair of the hackathon models into frontend/demo_viewer/diffs/ (run after adding or changing a model)
demo-diffs:
    python3 -m diff_engine.demo_diffs

# diff the seeded synthetic demo pair (fixtures/demo/) and open the viewer on it
demo-seeded:
    python3 -m diff_engine fixtures/demo/before.e2k fixtures/demo/after.e2k --view

# open the viewer on the bundled example diff
example:
    python3 -m diff_engine.serve frontend/demo_viewer/example-diff.json

# type-check backend/diff_engine with pyright in strict mode (pyrightconfig.json)
typecheck:
    pyright

# type-check, then run the diff engine tests
test: typecheck
    python3 -m unittest discover -s backend/diff_engine/tests -t backend

# --- UI (the React app in frontend/, needs node and npm) ---

# install the UI's dependencies from package-lock.json
ui-install:
    cd frontend && npm ci

# type-check and build the UI into frontend/dist/ (installs first if node_modules is missing)
ui-build:
    cd frontend && { [ -d node_modules ] || npm ci; } && npm run build
    @echo "built into frontend/dist/"

# run the UI dev server at http://127.0.0.1:5173 (Ctrl+C stops it)
ui-dev:
    cd frontend && npm run dev

# run the UI tests
ui-test:
    cd frontend && npm test

# serve the built UI from frontend/dist/ at http://127.0.0.1:4173 (run ui-build first)
ui-preview:
    cd frontend && npx vite preview --host 127.0.0.1
