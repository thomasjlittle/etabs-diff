import json
from pathlib import Path

from etabs_register.schema import Diff, Model

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def test_fixtures_match_schema():
    Model.model_validate(load("model-a.json"))
    Model.model_validate(load("model-b.json"))
    Diff.model_validate(load("diff.json"))
