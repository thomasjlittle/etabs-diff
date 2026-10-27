# list recipes
default:
    @just --list

# diff two .e2k/.$et files and open the viewer on the result
view before after:
    python3 -m diff_engine "{{before}}" "{{after}}" --view

# diff the bundled demo pair (fixtures/demo/) and open the viewer on it
demo:
    python3 -m diff_engine fixtures/demo/before.e2k fixtures/demo/after.e2k --view

# open the viewer on the bundled example diff
example:
    python3 -m diff_engine.serve viewer/example-diff.json

# run the diff engine tests
test:
    python3 -m unittest discover -s diff_engine/tests -t .
