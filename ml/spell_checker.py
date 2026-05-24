"""
Локальная орфография через symspellpy + ru_dict_domain.txt (закупочная лексика).

Исправляем только опечатки с edit distance ≤ 1, если результат — слово из domain-словаря.
Сленг и слова вне словаря не трогаем — их обрабатывает Qwen.
"""

import os
import threading
from pathlib import Path

from symspellpy import SymSpell, Verbosity

_ML_DIR = Path(__file__).resolve().parent
DOMAIN_DICT_PATH = str(_ML_DIR / "ru_dict_domain.txt")

MAX_EDIT_DISTANCE = 1

_sym: SymSpell | None = None
_lock = threading.Lock()


def dictionary_paths() -> dict[str, str]:
    return {"domain": DOMAIN_DICT_PATH}


def ensure_dictionaries() -> None:
    if not os.path.isfile(DOMAIN_DICT_PATH):
        raise FileNotFoundError(
            f"Не найден domain-словарь: {DOMAIN_DICT_PATH}\n"
            "Файл должен лежать в ml/ (коммитится в git)."
        )


def _load() -> SymSpell:
    global _sym
    if _sym is not None:
        return _sym
    with _lock:
        if _sym is not None:
            return _sym
        ensure_dictionaries()
        sym = SymSpell(max_dictionary_edit_distance=MAX_EDIT_DISTANCE, prefix_length=7)
        sym.load_dictionary(DOMAIN_DICT_PATH, term_index=0, count_index=1, encoding="utf-8")
        _sym = sym
    return _sym


def _is_cyrillic(word: str) -> bool:
    return all("Ѐ" <= c <= "ӿ" for c in word)


def _in_domain(sym: SymSpell, word: str) -> bool:
    return bool(sym.lookup(word.lower(), Verbosity.TOP, max_edit_distance=0))


def _apply_case(original: str, corrected: str) -> str:
    if original.isupper():
        return corrected.upper()
    if original[0].isupper():
        return corrected.capitalize()
    return corrected


def _fix_word(sym: SymSpell, word: str) -> str:
    lower = word.lower()
    if _in_domain(sym, lower):
        return word

    suggestions = sym.lookup(lower, Verbosity.CLOSEST, max_edit_distance=MAX_EDIT_DISTANCE)
    if not suggestions:
        return word

    best = suggestions[0]
    if best.distance == 0 or best.distance > MAX_EDIT_DISTANCE:
        return word
    if not _in_domain(sym, best.term):
        return word
    if len(lower) >= 3 and lower[:2] != best.term[:2]:
        return word

    return _apply_case(word, best.term)


def correct(query: str) -> str:
    """Опечатки в domain-лексике; остальное без изменений."""
    if not query or len(query.strip()) < 3:
        return query

    sym = _load()
    corrected = []
    for word in query.split():
        if not word.isalpha() or not _is_cyrillic(word) or len(word) <= 3:
            corrected.append(word)
            continue
        corrected.append(_fix_word(sym, word))

    return " ".join(corrected)
