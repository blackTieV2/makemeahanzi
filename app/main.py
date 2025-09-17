"""FastAPI application serving Chinese learning tools."""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .utils.data_loader import (
    CharacterData,
    lookup_character,
    search_characters_by_pinyin,
)
from .utils.ocr import extract_characters
from .utils.text import is_cjk, unique_preserve_order

APP_ROOT = Path(__file__).resolve().parent
SVG_DIR = Path(__file__).resolve().parents[1] / "svgs"

app = FastAPI(
    title="Make Me a Hanzi Companion",
    description="Interactive lookup tool for Chinese characters using the Make Me a Hanzi dataset.",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory=str(APP_ROOT / "static")), name="static")
app.mount("/stroke", StaticFiles(directory=str(SVG_DIR)), name="stroke")

templates = Jinja2Templates(directory=str(APP_ROOT / "templates"))


def _character_summary(character: str, data: CharacterData | None = None) -> Dict:
    data = data or lookup_character(character)
    svg_file = SVG_DIR / f"{ord(character)}.svg"
    summary = {
        "character": character,
        "codepoint": f"U+{ord(character):04X}",
        "svg": f"/stroke/{svg_file.name}" if svg_file.exists() else None,
        "available": data is not None,
    }
    if not data:
        return summary
    summary.update(
        {
            "definition": data.get("definition"),
            "pinyin": data.get("pinyin", []),
            "decomposition": data.get("decomposition"),
            "radical": data.get("radical"),
            "stroke_count": data.get("stroke_count"),
        }
    )
    return summary


def _character_detail(character: str) -> Dict:
    data = lookup_character(character)
    detail = _character_summary(character, data)
    if not data:
        detail.update({"strokes": [], "medians": []})
        return detail
    detail.update(
        {
            "strokes": data.get("strokes", []),
            "medians": data.get("medians", []),
        }
    )
    return detail


def _prepare_characters(characters: List[str]) -> List[Dict]:
    filtered = [char for char in characters if is_cjk(char)]
    unique_chars = unique_preserve_order(filtered)
    return [_character_summary(char) for char in unique_chars]


@app.get("/", response_class=HTMLResponse)
async def read_index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/lookup")
async def api_lookup(text: str) -> Dict:
    characters = _prepare_characters(list(text))
    return {"query": text, "characters": characters}


@app.get("/api/search")
async def api_search(pinyin: str) -> Dict:
    matches = search_characters_by_pinyin(pinyin)
    characters = [_character_summary(char) for char in matches]
    return {"query": pinyin, "characters": characters}


@app.post("/api/ocr")
async def api_ocr(file: UploadFile = File(...)) -> Dict:
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    try:
        detected_characters = extract_characters(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    characters = _prepare_characters(detected_characters)
    recognized_text = "".join(detected_characters)
    return {
        "recognized_text": recognized_text,
        "characters": characters,
    }


@app.get("/api/character/{character}")
async def api_character(character: str) -> Dict:
    return _character_detail(character)
