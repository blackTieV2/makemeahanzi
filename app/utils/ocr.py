"""Wrapper around RapidOCR for simplified character extraction."""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from typing import List

import numpy as np
from PIL import Image, UnidentifiedImageError
from rapidocr_onnxruntime import RapidOCR

from .text import is_cjk


@lru_cache(maxsize=1)
def _get_ocr() -> RapidOCR:
    return RapidOCR()


def _load_image(image_bytes: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(image_bytes))
    except UnidentifiedImageError as exc:
        raise ValueError("Unsupported image format") from exc
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")
    return image


def extract_characters(image_bytes: bytes) -> List[str]:
    """Use OCR to detect Chinese characters from an image."""
    image = _load_image(image_bytes)
    ocr = _get_ocr()
    result = ocr(np.array(image))[0]
    if not result:
        return []

    texts: List[str] = []
    for item in result:
        if not item:
            continue
        # Result may include bounding boxes. Text is typically the second element.
        if isinstance(item, list) and len(item) >= 2 and isinstance(item[1], str):
            candidate = item[1]
        elif isinstance(item, list) and len(item) >= 1 and isinstance(item[0], str):
            candidate = item[0]
        else:
            continue
        for char in candidate:
            if is_cjk(char):
                texts.append(char)
    return texts
