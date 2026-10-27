import json
from pathlib import Path

from etabs_register.schema import Diff, Model
from etabs_register.diff import diff

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_fixtures_match_schema():
    Model.model_validate(load("model-a.json"))
    Model.model_validate(load("model-b.json"))
    Diff.model_validate(load("diff.json"))


def test_diff_matches_fixture():
    model_a = Model.model_validate(load("model-a.json"))
    model_b = Model.model_validate(load("model-b.json"))
    expected = Diff.model_validate(load("diff.json"))

    result = diff(model_a, model_b)
    assert result == expected
