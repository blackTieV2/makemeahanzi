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


def lookup_character(character: str) -> Optional[CharacterData]:
    """Return data for a given character, if available."""
    dictionary = load_dictionary()
    entry = dictionary.get(character)
    if not entry:
        return None
    if entry["stroke_count"] is None:
        populate_stroke_counts(dictionary)
        entry = dictionary.get(character)
    return entry
