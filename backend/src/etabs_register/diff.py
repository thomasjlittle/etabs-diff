from etabs_register.schema import Diff, Model


def diff(model_a: Model, model_b: Model) -> Diff:
    """Compute the diff between two models."""
    raise NotImplementedError()
