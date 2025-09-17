"""Text utility helpers."""
from __future__ import annotations

from typing import Iterable, List


def is_cjk(character: str) -> bool:
    """Return True if the character is within common CJK Unicode ranges."""
    if not character:
        return False
    code = ord(character)
    return any(
        start <= code <= end
        for start, end in (
            (0x2E80, 0x2EFF),  # CJK Radicals Supplement
            (0x2F00, 0x2FDF),  # Kangxi Radicals
            (0x3040, 0x30FF),  # Hiragana/Katakana (allow for borrowed forms)
            (0x3400, 0x4DBF),  # CJK Unified Ideographs Extension A
            (0x4E00, 0x9FFF),  # CJK Unified Ideographs
            (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
            (0x20000, 0x2A6DF),  # CJK Unified Ideographs Extension B
            (0x2A700, 0x2B73F),  # Extension C
            (0x2B740, 0x2B81F),  # Extension D
            (0x2B820, 0x2CEAF),  # Extension E
            (0x2CEB0, 0x2EBEF),  # Extension F
            (0x30000, 0x3134F),  # Extension G
        )
    )


def unique_preserve_order(text: Iterable[str]) -> List[str]:
    """Return list of characters with duplicates removed while preserving order."""
    seen = set()
    ordered: List[str] = []
    for char in text:
        if char in seen:
            continue
        seen.add(char)
        ordered.append(char)
    return ordered
