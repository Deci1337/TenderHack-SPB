"""
LLM-сервис: расширение поискового запроса (expand_query) и автодополнение (suggest_completions)


Модель: Qwen/Qwen3-4B-Instruct-2507, HuggingFace transformers, локально.
Остальное (НМЦК) — чистая математика без LLM.
"""

import json
import logging
import re
from functools import lru_cache
from threading import Lock

import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

logger = logging.getLogger(__name__)

MODEL_NAME = "Qwen/Qwen3-4B-Instruct-2507"

# ---------------------------------------------------------------------------
# Пре-фильтрация: не тратим LLM на нетоварные запросы, чистим запросы от мусора
# ---------------------------------------------------------------------------

_NON_PRODUCT_WORDS = (
    "где ", "как ", "почему ", "когда ", "сколько ", "какой ", "что такое ",
    "сколько стоит", "какой ", "что такое ",
    "погода ", "доставка ", "скидка ", "акция ",
    "купить ", "заказать ", "найти ", "поискать ",
    "где", "как", "почему", "когда", "сколько", "какой", "какая", "какие",
    "что", "такое", "погода", "доставка", "скидка", "акция",
    "купить", "заказать", "найти", "поискать", "пожалуйста", "можно",
)
_MIN_QUERY_LEN = 3
_MAX_QUERY_LEN = 200

def clean_query(query: str) -> str:
    """Удаляет все стоп-слова и фразы из запроса."""
    q = query.lower().strip()
    
    for word in _NON_PRODUCT_WORDS:
        # Если фраза с пробелом в конце - удаляем только в начале или с пробелом
        if word.endswith(' '):
            if q.startswith(word):
                q = q[len(word):]
            q = q.replace(f' {word}', ' ')
        else:
            q = q.replace(f' {word} ', ' ')
            if q.startswith(f'{word} '):
                q = q[len(word)+1:]
            if q.endswith(f' {word}'):
                q = q[:-len(word)-1]
            if q == word:
                q = ''
    
    q = ' '.join(q.split())
    
    return q if q else query


def is_product_query(query: str) -> bool:
    """Проверяет, стоит ли обрабатывать запрос."""
    q = query.strip()
    if len(q) < _MIN_QUERY_LEN or len(q) > _MAX_QUERY_LEN:
        return False
    
    # Только цифры/пунктуация — бессмысленно
    if re.fullmatch(r'[\d\s\W]+', q):
        return False
    
    # Повтор одного символа 4+ раз подряд
    if re.search(r'(.)\1{3,}', q):
        return False
    
    cleaned = clean_query(q)
    return len(cleaned) != 0


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
            dtype=torch.float16,  
            device_map=None,
        ).to(device)
        _model.eval()
        logger.info("Модель загружена на %s", device)

    return _model, _tokenizer


# ---------------------------------------------------------------------------
# Общие хелперы LLM
# ---------------------------------------------------------------------------

def _extract_json_object(response: str) -> dict | None:
    match = re.search(r"\{[\s\S]*\}", response)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


def _run_chat_completion(messages: list[dict], *, max_new_tokens: int = 120) -> str:
    model, tokenizer = _load_model()
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
            max_new_tokens=max_new_tokens,
            temperature=0.35,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True).strip()


# ---------------------------------------------------------------------------
# expand_query
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
    original = query.strip()
    if not original or len(original) < 2:
        return []

    cleaned = clean_query(original)
    if not cleaned or len(cleaned) < _MIN_QUERY_LEN:
        return []

    # Пре-фильтр: явный мусор или нетоварный запрос → сразу пусто
    if not is_product_query(cleaned):
        return []

    try:
        messages = [{"role": "user", "content": _PROMPT.format(query=cleaned)}]
        response = _run_chat_completion(messages, max_new_tokens=100)
        return _parse_response(response, cleaned)

    except Exception as e:
        logger.warning("expand_query failed (%s), searching by cleaned query", e)
        return [cleaned]


def _parse_response(response: str, original: str) -> list[str]:
    """Извлекает и валидирует JSON из ответа модели.
    Возвращает [] если модель не смогла распознать товар.
    """
    data = _extract_json_object(response)
    if not data:
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
# suggest_completions — автодополнение запроса (как в поисковике)
# ---------------------------------------------------------------------------

_SUGGEST_CATEGORIES = ("Шины", "Оргтехника", "Одежда", "Мебель", "Канцелярия")

_SUGGEST_PROMPT = (
    'Пользователь вводит поисковый запрос товара для госзакупки: "{prefix}"\n\n'
    'Придумай {limit} ПРОДОЛЖЕНИЙ запроса — полные фразы, которые начинаются с этого текста '
    '(или с исправленной опечаткой в начале). Добавляй конкретику: бренд, модель, размер, '
    'характеристики (А4, Wi-Fi, 205/55 R16 и т.п.).\n\n'
    'Правила:\n'
    '1. Каждое продолжение — готовый поисковый запрос, 4–12 слов.\n'
    '2. Все варианты РАЗНЫЕ (разные модели/размеры/комплектации).\n'
    '3. category — одна из: Шины, Оргтехника, Одежда, Мебель, Канцелярия.\n'
    '4. score — уверенность 0.0–1.0 (выше = релевантнее префиксу).\n'
    '5. Только реальные товары, без «где купить», без вопросов.\n\n'
    'Пример для префикса "принтер лаз":\n'
    '{{"completions": [\n'
    '  {{"text": "принтер лазерный А4 черно-белый Pantum P2500W", "category": "Оргтехника", "score": 0.95}},\n'
    '  {{"text": "принтер лазерный HP LaserJet Pro M404dn сетевой", "category": "Оргтехника", "score": 0.9}},\n'
    '  {{"text": "принтер лазерный Kyocera ECOSYS M2040dn дуплекс", "category": "Оргтехника", "score": 0.88}}\n'
    ']}}\n\n'
    'Ответь только JSON:\n'
    '{{"completions": [{{"text": "...", "category": "...", "score": 0.9}}, ...]}}'
)


def _parse_suggest_response(response: str, prefix: str, limit: int) -> list[dict]:
    """Возвращает [{text, category, score}, ...] отсортированные по score."""
    data = _extract_json_object(response)
    if not data:
        return []

    raw = data.get("completions") or data.get("suggestions") or []
    if not isinstance(raw, list):
        return []

    prefix_lower = prefix.strip().lower()
    prefix_words = prefix_lower.split()

    parsed: list[dict] = []
    seen_text: set[str] = set()

    for item in raw:
        if isinstance(item, str):
            text, category, score = item.strip(), "Подсказки", 0.7
        elif isinstance(item, dict):
            text = str(item.get("text") or item.get("query") or "").strip()
            category = str(item.get("category") or "Подсказки").strip()
            try:
                score = float(item.get("score", 0.7))
            except (TypeError, ValueError):
                score = 0.7
        else:
            continue

        if not text or len(text) < len(prefix_lower):
            continue

        key = text.lower()
        if key in seen_text:
            continue

        text_lower = text.lower()
        # Должно продолжать ввод: начинается с префикса или с его исправленного первого слова
        if not text_lower.startswith(prefix_lower):
            if not prefix_words or not text_lower.startswith(prefix_words[0]):
                continue

        if category not in _SUGGEST_CATEGORIES:
            category = "Подсказки"

        seen_text.add(key)
        parsed.append({
            "text": text,
            "category": category,
            "score": max(0.0, min(1.0, score)),
        })

    parsed.sort(key=lambda x: x["score"], reverse=True)
    return parsed[:limit]


def _completions_to_groups(completions: list[dict]) -> list[dict]:
    """Формат для API/фронта: [{category, items: [str, ...]}]."""
    buckets: dict[str, dict] = {}
    order: list[str] = []

    for item in completions:
        cat = item["category"]
        if cat not in buckets:
            buckets[cat] = {"category": cat, "items": []}
            order.append(cat)
        text = item["text"]
        if text not in buckets[cat]["items"]:
            buckets[cat]["items"].append(text)

    return [buckets[c] for c in order]


@lru_cache(maxsize=256)
def suggest_completions(prefix: str, limit: int = 5) -> tuple:
    """
    Автодополнение поискового запроса через Qwen.
    Возвращает tuple для lru_cache → список групп {category, items}.
    При ошибке — пустой tuple ().
    """
    prefix = prefix.strip()
    if len(prefix) < 2 or len(prefix) > _MAX_QUERY_LEN:
        return ()

    if not is_product_query(prefix):
        return ()

    try:
        cleaned = clean_query(prefix)
        query_for_llm = cleaned if cleaned else prefix

        messages = [{
            "role": "user",
            "content": _SUGGEST_PROMPT.format(
                prefix=query_for_llm,
                limit=limit,
            ),
        }]
        response = _run_chat_completion(messages, max_new_tokens=350)
        completions = _parse_suggest_response(response, query_for_llm, limit)
        if not completions:
            return ()

        groups = _completions_to_groups(completions)
        return tuple(groups) if groups else ()

    except Exception as e:
        logger.warning("suggest_completions failed (%s)", e)
        return ()


def suggest_completions_list(prefix: str, limit: int = 5) -> list[dict]:
    """Обёртка: list[dict] вместо tuple из кэша (копия, чтобы не мутировать кэш)."""
    cached = suggest_completions(prefix, limit)
    if not cached:
        return []
    return [{"category": g["category"], "items": list(g["items"])} for g in cached]


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

    mean = float(np.mean(filtered))
    max_dev = max(abs(p - mean) / mean for p in filtered)

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
        "filtered_count": len(filtered),
        "filtered_prices": filtered,
        "min_price": min(filtered),
        "max_price": max(filtered),
        "message": f"НМЦК рассчитана по {len(filtered)} ценам.",
    }
