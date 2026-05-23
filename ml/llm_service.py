"""
LLM-сервис: расширение поискового запроса (expand_query).

Модель: Qwen/Qwen3-4B-Instruct-2507, HuggingFace transformers, локально.
Единственная задача LLM — expand_query(). Всё остальное — чистая математика.
"""

import json
import logging
import re
import unicodedata
from functools import lru_cache
from threading import Lock

import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

logger = logging.getLogger(__name__)

MODEL_NAME = "Qwen/Qwen3-4B-Instruct-2507"

# ---------------------------------------------------------------------------
# Пре-фильтрация: не тратим LLM на нетоварные запросы
# ---------------------------------------------------------------------------

_NON_PRODUCT_PREFIXES = (
    "где ", "как ", "почему ", "когда ", "сколько стоит", "какой ",
    "что такое", "погода", "доставка ", "скидка", "акция",
)
_MIN_QUERY_LEN = 3
_MAX_QUERY_LEN = 200


def is_product_query(query: str) -> bool:
    """True — запрос похож на товарный и стоит передавать в LLM и парсеры."""
    q = query.strip()
    if len(q) < _MIN_QUERY_LEN or len(q) > _MAX_QUERY_LEN:
        return False
    # Только цифры/пунктуация — бессмысленно
    if re.fullmatch(r'[\d\s\W]+', q):
        return False
    # Повтор одного символа 4+ раз подряд ("яяяяя", ".......")
    if re.search(r'(.)\1{3,}', q):
        return False
    ql = q.lower()
    if any(ql.startswith(p) for p in _NON_PRODUCT_PREFIXES):
        return False
    return True

# ---------------------------------------------------------------------------
# Singleton загрузка модели — один раз при старте, не на каждый запрос
# ---------------------------------------------------------------------------

_model = None
_tokenizer = None
_lock = Lock()


def _load_model():
    global _model, _tokenizer
    if _model is not None:
        return _model, _tokenizer

    with _lock:
        if _model is not None:  # double-checked locking
            return _model, _tokenizer

        logger.info("Загрузка %s...", MODEL_NAME)
        device = "cuda" if torch.cuda.is_available() else "cpu"

        _tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
        _model = AutoModelForCausalLM.from_pretrained(
            MODEL_NAME,
            dtype=torch.float16,   # было: torch_dtype=torch.float16 (deprecated)
            device_map=None,
        ).to(device)
        _model.eval()
        logger.info("Модель загружена на %s", device)

    return _model, _tokenizer


# ---------------------------------------------------------------------------
# expand_query — единственная функция LLM
# ---------------------------------------------------------------------------

_PROMPT = (
    'Исправь опечатки и придумай 3 синонима для поиска ТОВАРА: "{query}"\n\n'
    'Правила:\n'
    '1. Синонимы должны быть РАЗНЫМИ по формулировке.\n'
    '2. Если запрос набран в неправильной раскладке (например "ghjcnfr" → "принтер") — исправь.\n'
    '3. Для технических терминов сохраняй цифры и единицы измерения.\n'
    '4. Сленг раскрывай в полное название товара.\n\n'
    'Примеры (few-shot):\n'
    'Запрос: "клава" → {{"corrected": "клавиатура", "variants": ["клавиатура компьютерная", "клавиатура USB", "беспроводная клавиатура"]}}\n'
    'Запрос: "прнтер лазерный" → {{"corrected": "принтер лазерный", "variants": ["лазерный принтер", "принтер черно-белый лазерный", "МФУ лазерное"]}}\n'
    'Запрос: "вебка" → {{"corrected": "веб-камера", "variants": ["веб-камера для ПК", "камера USB для конференций", "веб-камера Full HD"]}}\n'
    'Запрос: "шина летн 205" → {{"corrected": "шина летняя 205", "variants": ["шина летняя R205", "автошина летняя 205", "покрышка летняя 205"]}}\n\n'
    'Ответь только JSON, без пояснений:\n'
    '{{"corrected": "...", "variants": ["...", "...", "..."]}}'
)


@lru_cache(maxsize=512)
def expand_query(query: str) -> list[str]:
    """
    Возвращает [corrected, variant1, variant2, variant3] — уникальные, без дублей.
    При любой ошибке возвращает [query] — поиск не ломается.
    """
    query = query.strip()
    if not query or len(query) < 2:
        return []

    # Пре-фильтр: явный мусор или нетоварный запрос → сразу пусто
    if not is_product_query(query):
        return []

    try:
        model, tokenizer = _load_model()

        messages = [{"role": "user", "content": _PROMPT.format(query=query)}]

        # enable_thinking=False — отключаем chain-of-thought, иначе +10 сек к latency
        # Guard: старые версии transformers не поддерживают параметр — падаем на обычный вызов
        try:
            text = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False,
            )
        except TypeError:
            text = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )

        inputs = tokenizer(text, return_tensors="pt", add_special_tokens=False)
        inputs = {k: v.to(model.device) for k, v in inputs.items()}

        with torch.no_grad():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=100,  # строго: не даём модели «фантазировать»
                temperature=0.3,
                do_sample=True,
                pad_token_id=tokenizer.eos_token_id,
            )

        # Декодируем только новые токены
        new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
        response = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

        return _parse_response(response, query)

    except Exception as e:
        logger.warning("expand_query failed (%s), searching by original query", e)
        return [query]


def _parse_response(response: str, original: str) -> list[str]:
    """Извлекает и валидирует JSON из ответа модели.
    Возвращает [] если модель не смогла распознать товар.
    """
    match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
    if not match:
        return []

    try:
        data = json.loads(match.group())
    except json.JSONDecodeError:
        return []

    corrected = str(data.get("corrected", "")).strip()
    variants = [str(v).strip() for v in data.get("variants", []) if str(v).strip()]

    if not corrected:
        return []

    # Модель не смогла расширить — вернула то же самое слово во всех вариантах
    # Но товар может существовать → возвращаем оригинал, парсеры найдут сами
    all_results = [corrected, *variants]
    unique_lower = {q.lower() for q in all_results}
    if unique_lower == {original.lower()} or (len(unique_lower) == 1 and corrected.lower() == original.lower()):
        logger.info("LLM не расширила запрос %r, ищем по оригиналу", original)
        return [original]

    # Дедупликация с сохранением порядка
    seen: set[str] = set()
    result: list[str] = []
    for q in all_results:
        key = q.lower()
        if key not in seen:
            seen.add(key)
            result.append(q)

    return result


# ---------------------------------------------------------------------------
# Фильтрация цен и расчёт НМЦК (44-ФЗ п.3.20) — без LLM, чистая математика
# ---------------------------------------------------------------------------

def filter_outliers(prices: list[float], max_deviation: float = 0.33) -> list[float]:
    """Итеративно отбрасывает цены с отклонением от среднего > 33%."""
    if len(prices) < 3:
        return prices

    mean = float(np.mean(prices))
    filtered = [p for p in prices if abs(p - mean) / mean <= max_deviation]

    if len(filtered) < 5:
        return prices  # слишком агрессивная фильтрация — берём оригинал

    if len(filtered) != len(prices):
        return filter_outliers(filtered, max_deviation)

    return filtered


def _select_closest_to_mean(prices: list[float], n: int = 5) -> list[float]:
    if len(prices) <= n:
        return prices
    mean = float(np.mean(prices))
    return sorted(prices, key=lambda p: abs(p - mean))[:n]


def calculate_nmck(prices: list[float]) -> dict:
    """Расчёт НМЦК по 44-ФЗ п.3.20."""
    if not prices:
        return {"nmck": None, "status": "no_data", "price_count": 0,
                "message": "Товары не найдены."}

    if len(prices) < 5:
        return {
            "nmck": round(float(np.mean(prices)), 2),
            "status": "insufficient_data",
            "price_count": len(prices),
            "message": f"Найдено {len(prices)} цен. Для 44-ФЗ нужно минимум 5.",
        }

    filtered = filter_outliers(prices)

    if len(filtered) < 5:
        return {
            "nmck": None,
            "status": "filtered_too_much",
            "price_count": len(prices),
            "filtered_count": len(filtered),
            "message": f"После отсева выбросов осталось {len(filtered)} из {len(prices)}. "
                       f"Разброс цен слишком большой (от {min(prices):.0f} до {max(prices):.0f} ₽).",
        }

    final = _select_closest_to_mean(filtered, 5)
    mean = float(np.mean(final))
    max_dev = max(abs(p - mean) / mean for p in final)

    if max_dev > 0.33:
        return {
            "nmck": None,
            "status": "deviation_too_high",
            "max_deviation_pct": round(max_dev * 100, 1),
            "message": f"Разброс {max_dev*100:.1f}% > 33%. Нужно больше источников.",
        }

    return {
        "nmck": round(mean, 2),
        "status": "success",
        "price_count": len(prices),
        "filtered_count": len(final),
        "filtered_prices": final,
        "min_price": min(final),
        "max_price": max(final),
        "message": f"НМЦК рассчитана по {len(final)} ценам.",
    }


# ---------------------------------------------------------------------------
# Дедупликация товаров — без bge-m3 (570MB RAM, O(n²))
# Нормализация строк даёт ~80% результата бесплатно.
# ---------------------------------------------------------------------------

def _normalize(title: str) -> str:
    t = title.lower()
    t = unicodedata.normalize("NFKD", t)
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def deduplicate(products: list[dict]) -> list[dict]:
    """
    Группирует товары с одинаковым нормализованным названием.
    Цена в группе — медиана (по духу 44-ФЗ).
    """
    groups: dict[str, list[dict]] = {}
    for p in products:
        key = _normalize(p.get("title", p.get("name", "")))
        groups.setdefault(key, []).append(p)

    result = []
    for group in groups.values():
        prices = [p["price"] for p in group if p.get("price")]
        rep = group[0].copy()
        if prices:
            rep["price"] = round(float(np.median(prices)), 2)
        rep["sources_count"] = len(group)
        rep["source_names"] = list({p.get("source", "?") for p in group})
        result.append(rep)

    return result
