"""Utility functions for loading character data from Make Me a Hanzi."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional


ROOT = Path(__file__).resolve().parents[2]
DICTIONARY_PATH = ROOT / "dictionary.txt"
GRAPHICS_PATH = ROOT / "graphics.txt"


class CharacterData(dict):
    """Typed dictionary storing information about a character."""

    character: str  # type: ignore[assignment]
    definition: Optional[str]
    pinyin: List[str]
    decomposition: Optional[str]
    radical: Optional[str]
    matches: Optional[List]
    stroke_count: Optional[int]
    strokes: List[str]
    medians: List


def _load_json_lines(path: Path) -> Iterable[Dict]:
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            yield json.loads(line)


@lru_cache(maxsize=1)
def load_dictionary() -> Dict[str, CharacterData]:
    """Load dictionary.txt and return mapping of character to data."""
    data: Dict[str, CharacterData] = {}
    for entry in _load_json_lines(DICTIONARY_PATH):
        character = entry.get("character")
        if not character:
            continue
        entry.setdefault("pinyin", [])
        entry.setdefault("definition", None)
        entry.setdefault("decomposition", None)
        entry.setdefault("radical", None)
        entry.setdefault("matches", None)
        entry["stroke_count"] = None
        entry.setdefault("strokes", [])
        entry.setdefault("medians", [])
        data[character] = entry  # type: ignore[assignment]
    return data


@lru_cache(maxsize=1)
def load_stroke_counts() -> Dict[str, int]:
    """Load stroke counts derived from graphics.txt."""
    counts: Dict[str, int] = {}
    for entry in _load_json_lines(GRAPHICS_PATH):
        character = entry.get("character")
        if not character:
            continue
        strokes = entry.get("strokes") or []
        counts[character] = len(strokes)
    return counts


def populate_stroke_counts(dictionary: Dict[str, CharacterData]) -> None:
    """Attach stroke counts to the provided dictionary."""
    counts = load_stroke_counts()
    for character, count in counts.items():
        if character in dictionary:
            dictionary[character]["stroke_count"] = count


@lru_cache(maxsize=1)
def load_graphics() -> Dict[str, Dict[str, List]]:
    """Load stroke and median data for each character."""
    graphics: Dict[str, Dict[str, List]] = {}
    for entry in _load_json_lines(GRAPHICS_PATH):
        character = entry.get("character")
        if not character:
            continue
        strokes = entry.get("strokes") or []
        medians = entry.get("medians") or []
        graphics[character] = {"strokes": strokes, "medians": medians}
    return graphics


def _attach_graphics(entry: CharacterData, character: str) -> CharacterData:
    graphics = load_graphics().get(character)
    if not graphics:
        entry["strokes"] = []
        entry["medians"] = []
        return entry
    entry["strokes"] = graphics.get("strokes", [])
    entry["medians"] = graphics.get("medians", [])
    return entry


def lookup_character(character: str) -> Optional[CharacterData]:
    """Return data for a given character, if available."""
    dictionary = load_dictionary()
    entry = dictionary.get(character)
    if not entry:
        return None
    if entry["stroke_count"] is None:
        populate_stroke_counts(dictionary)
        entry = dictionary.get(character)
    if not entry:
        return None
    return _attach_graphics(entry, character)


TONE_TRANSLATION = str.maketrans(
    {
        "ā": "a",
        "á": "a",
        "ǎ": "a",
        "à": "a",
        "ē": "e",
        "é": "e",
        "ě": "e",
        "è": "e",
        "ī": "i",
        "í": "i",
        "ǐ": "i",
        "ì": "i",
        "ō": "o",
        "ó": "o",
        "ǒ": "o",
        "ò": "o",
        "ū": "u",
        "ú": "u",
        "ǔ": "u",
        "ù": "u",
        "ǖ": "v",
        "ǘ": "v",
        "ǚ": "v",
        "ǜ": "v",
        "ü": "v",
        "ḿ": "m",
        "ń": "n",
        "ň": "n",
        "ǹ": "n",
        "ê": "e",
    }
)


def normalize_pinyin(value: str) -> str:
    """Normalize pinyin by removing tones, digits, and separators."""
    if not value:
        return ""
    lowered = value.lower().strip().replace("u:", "v")
    translated = lowered.translate(TONE_TRANSLATION)
    return "".join(ch for ch in translated if ch.isalpha())


@lru_cache(maxsize=1)
def load_pinyin_index() -> Dict[str, List[str]]:
    """Build an index of tone-insensitive pinyin to characters."""
    dictionary = load_dictionary()
    index: Dict[str, List[str]] = {}
    for character, entry in dictionary.items():
        for reading in entry.get("pinyin", []):
            key = normalize_pinyin(reading)
            if not key:
                continue
            bucket = index.setdefault(key, [])
            if character not in bucket:
                bucket.append(character)
            if "v" in key:
                alt_key = key.replace("v", "u")
                alt_bucket = index.setdefault(alt_key, [])
                if character not in alt_bucket:
                    alt_bucket.append(character)
    return index


def search_characters_by_pinyin(pinyin: str, limit: int = 25) -> List[str]:
    """Return characters that match the provided pinyin string."""
    key = normalize_pinyin(pinyin)
    if not key:
        return []
    matches = load_pinyin_index().get(key, [])
    if limit:
        return matches[:limit]
    return matches
