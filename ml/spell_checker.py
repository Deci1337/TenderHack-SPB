"""
Локальная проверка опечаток через symspellpy + локальные словари ru_dict.txt / ru_dict_domain.txt.

Слова, которых нет в словаре, не исправляются — их обрабатывает Qwen (expand_query / suggest).
"""

import os
import threading
from pathlib import Path

from symspellpy import SymSpell, Verbosity

_ML_DIR = Path(__file__).resolve().parent
DICT_PATH = str(_ML_DIR / "ru_dict.txt")
DOMAIN_DICT_PATH = str(_ML_DIR / "ru_dict_domain.txt")

_sym: SymSpell | None = None
_lock = threading.Lock()


def dictionary_paths() -> dict[str, str]:
    return {"main": DICT_PATH, "domain": DOMAIN_DICT_PATH}


def ensure_dictionaries() -> None:
    """Проверяет наличие локальных словарей до первого correct()."""
    missing = [p for p in (DICT_PATH, DOMAIN_DICT_PATH) if not os.path.isfile(p)]
    if missing:
        raise FileNotFoundError(
            "Не найдены файлы словаря для spell-check:\n"
            + "\n".join(f"  - {p}" for p in missing)
            + "\n\nСловарь должен лежать в ml/ (файл в git). "
            "Скачивание по интернету не поддерживается."
        )


def _load() -> SymSpell:
    global _sym
    if _sym is not None:
        return _sym
    with _lock:
        if _sym is not None:
            return _sym
        ensure_dictionaries()
        sym = SymSpell(max_dictionary_edit_distance=2, prefix_length=7)
        sym.load_dictionary(DICT_PATH, term_index=0, count_index=1, encoding="utf-8")
        if os.path.isfile(DOMAIN_DICT_PATH):
            sym.load_dictionary(DOMAIN_DICT_PATH, term_index=0, count_index=1, encoding="utf-8")
        _sym = sym
    return _sym


def _is_cyrillic(word: str) -> bool:
    return all("Ѐ" <= c <= "ӿ" for c in word)


def _in_dictionary(sym: SymSpell, word: str) -> bool:
    return bool(sym.lookup(word.lower(), Verbosity.TOP, max_edit_distance=0))


def correct(query: str) -> str:
    """
    Исправляет опечатки в запросе. 
    Возвращает запрос без изменений для слов, которых нет в словаре.
    """
    if not query or len(query.strip()) < 3:
        return query

    sym = _load()
    words = query.split()
    corrected = []

    for word in words:
        if not word.isalpha() or not _is_cyrillic(word):
            corrected.append(word)
            continue

        if len(word) <= 3:
            corrected.append(word)
            continue

        lower = word.lower()
        if _in_dictionary(sym, lower):
            corrected.append(word)
        else:
            # Не в словаре — не трогаем, Qwen исправит при expand/suggest
            corrected.append(word)

    return " ".join(corrected)
