"""
Локальная проверка опечаток через symspellpy + русский словарь.
"""

import os
import threading
from symspellpy import SymSpell, Verbosity

_sym: SymSpell | None = None
_lock = threading.Lock()

DICT_PATH = os.path.join(os.path.dirname(__file__), "ru_dict.txt")
DOMAIN_DICT_PATH = os.path.join(os.path.dirname(__file__), "ru_dict_domain.txt")


def _load() -> SymSpell:
    global _sym
    if _sym is not None:
        return _sym
    with _lock:
        if _sym is not None:
            return _sym
        sym = SymSpell(max_dictionary_edit_distance=2, prefix_length=7)
        sym.load_dictionary(DICT_PATH, term_index=0, count_index=1, encoding="utf-8")
        if os.path.isfile(DOMAIN_DICT_PATH):
            sym.load_dictionary(DOMAIN_DICT_PATH, term_index=0, count_index=1, encoding="utf-8")
        _sym = sym
    return _sym


def correct(query: str) -> str:
    """
    Исправляет опечатки в запросе.
    Возвращает исправленную строку или оригинал если словарь не помог.

    Примеры:
        "принтер лазерны"  → "принтер лазерный"
        "шина летняя"      → "шина летняя"  (без изменений)
        "HP LaserJet 1020" → "HP LaserJet 1020"  (спецсимволы не трогаем)
    """
    if not query or len(query.strip()) < 3:
        return query

    sym = _load()
    words = query.split()
    corrected = []

    for word in words:
        # Не трогаем: числа, артикулы, латиницу, спецсимволы
        if not word.isalpha() or not _is_cyrillic(word):
            corrected.append(word)
            continue

        if len(word) <= 3:
            corrected.append(word)
            continue

        suggestions = sym.lookup(word.lower(), Verbosity.CLOSEST, max_edit_distance=2)
        if suggestions and suggestions[0].distance > 0:
            # Сохраняем регистр оригинального слова
            fix = suggestions[0].term
            if word[0].isupper():
                fix = fix.capitalize()
            corrected.append(fix)
        else:
            corrected.append(word)

    result = " ".join(corrected)
    return result


def _is_cyrillic(word: str) -> bool:
    return all('Ѐ' <= c <= 'ӿ' for c in word)
