from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse

from etabs_register.parse import parse
from etabs_register.diff import diff
from etabs_register.schema import Model

app = FastAPI()


@app.post("/api/diff")
async def compute_diff(a: UploadFile = File(...), b: UploadFile = File(...)):
    """Compute the diff between two ETABS model files."""
    content_a = await a.read()
    content_b = await b.read()

    model_a = parse(content_a.decode())
    model_b = parse(content_b.decode())
    delta = diff(model_a, model_b)

    return JSONResponse({
        "modelA": model_a.model_dump(mode="json"),
        "modelB": model_b.model_dump(mode="json"),
        "diff": delta.model_dump(mode="json"),
    })
