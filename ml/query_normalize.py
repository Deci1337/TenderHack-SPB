"""
Нормализация поискового запроса: орфография + стоп-слова.
Без torch/LLM — можно импортировать отдельно от llm_service.
"""

import re

from spell_checker import correct

_NON_PRODUCT_WORDS = (
    "где ", "как ", "почему ", "когда ", "сколько ", "какой ", "что такое ",
    "сколько стоит", "какой ", "что такое ",
    "погода ", "доставка ", "скидка ", "акция ",
    "купить ", "заказать ", "найти ", "поискать ",
    "где", "как", "почему", "когда", "сколько", "какой", "какая", "какие",
    "что", "такое", "погода", "доставка", "скидка", "акция",
    "купить", "заказать", "найти", "поискать", "пожалуйста", "можно",
)
MIN_QUERY_LEN = 3
MAX_QUERY_LEN = 200


def clean_query(query: str) -> str:
    """Удаляет стоп-слова из запроса."""
    q = query.lower().strip()

    for word in _NON_PRODUCT_WORDS:
        if word.endswith(" "):
            if q.startswith(word):
                q = q[len(word):]
            q = q.replace(f" {word}", " ")
        else:
            q = q.replace(f" {word} ", " ")
            if q.startswith(f"{word} "):
                q = q[len(word) + 1:]
            if q.endswith(f" {word}"):
                q = q[:-len(word) - 1]
            if q == word:
                q = ""

    q = " ".join(q.split())
    return q if q else query


def is_product_query(query: str) -> bool:
    """Проверяет, стоит ли обрабатывать запрос."""
    q = query.strip()
    if len(q) < MIN_QUERY_LEN or len(q) > MAX_QUERY_LEN:
        return False

    if re.fullmatch(r"[\d\s\W]+", q):
        return False

    if re.search(r"(.)\1{3,}", q):
        return False

    return len(clean_query(q)) != 0


def normalize_query(query: str) -> str:
    """SymSpell (опечатки) → clean_query (стоп-слова)."""
    raw = query.strip()
    if not raw:
        return ""
    spelled = correct(raw) if len(raw) >= 3 else raw
    cleaned = clean_query(spelled)
    return cleaned if cleaned else spelled
