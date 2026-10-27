# list recipes
default:
    @just --list

# diff two .e2k/.$et files and open the viewer on the result
view before after:
    python3 -m diff_engine "{{before}}" "{{after}}" --view

# diff two .e2k/.$et files and write the changes as a CSV report
csv before after out:
    python3 -m diff_engine "{{before}}" "{{after}}" --csv "{{out}}" --summary

# diff the bundled demo pair (fixtures/demo/) and open the viewer on it
demo:
    python3 -m diff_engine fixtures/demo/before.e2k fixtures/demo/after.e2k --view

# open the viewer on the bundled example diff
example:
    python3 -m diff_engine.serve viewer/example-diff.json

# type-check diff_engine with pyright in strict mode (pyrightconfig.json)
typecheck:
    pyright

# type-check, then run the diff engine tests
test: typecheck
    python3 -m unittest discover -s diff_engine/tests -t .
