# list recipes
default:
    @just --list

# diff two .e2k/.$et files and open the viewer on the result
view before after:
    python3 -m diff_engine "{{before}}" "{{after}}" --view

# open the viewer on the bundled example diff
example:
    python3 -m diff_engine.serve viewer/example-diff.json

# run the diff engine tests
test:
    python3 -m unittest discover -s diff_engine/tests -t .
