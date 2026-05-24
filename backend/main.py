from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys, os, asyncio, json, logging
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ml'))
from suggestions import get_suggestions
from web_agent import search_runet
from spell_checker import correct
from marketplace_parsers import search_wildberries as _py_wb, search_ozon as _py_ozon, search_yandex_market as _py_ym

logger = logging.getLogger(__name__)

PARSER_BASE = os.getenv("PARSER_SERVER_URL", "http://localhost:8008")

# expand_query тянет Qwen модель (~8 ГБ). Включается после `python ml/download_model.py`
# Чтобы включить — поставь USE_LLM=1 в окружении
USE_LLM = os.getenv("USE_LLM") == "1"
if USE_LLM:
    from llm_service import expand_query

app = FastAPI(title="PriceHunter API")

# В проде frontend проксирует /api/* в backend через nginx (same-origin) — CORS не
# нужен. Для dev-режима с Vite на :5173 разрешаем явный список, плюс можно расширить
# через ENV CORS_ORIGINS (через запятую).
_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/suggest")
def suggest(q: str = "", limit: int = 7):
    return get_suggestions(q, limit)


@app.get("/api/correct")
def correct_query(q: str = ""):
    if not q.strip():
        return {"original": q, "corrected": q, "changed": False}
    corrected = correct(q)
    return {"original": q, "corrected": corrected, "changed": corrected != q}


@app.get("/api/search/runet")
async def search_runet_endpoint(q: str = "", region: str = "Москва"):
    if not q.strip():
        return []

    # 1. Исправляем опечатки локально (symspellpy, без интернета)
    corrected = correct(q)

    # 2. LLM расширяет запрос (если модель скачана и USE_LLM=1)
    variants = [corrected]
    if USE_LLM:
        try:
            ext = expand_query(corrected)
            if ext:
                variants = ext
        except Exception:
            pass

    # 3. Ищем по первому варианту
    primary = variants[0]
    products = await search_runet(primary, region=region)

    # 4. Если мало — добираем по синонимам
    if len(products) < 3 and len(variants) > 1:
        for variant in variants[1:]:
            if len(products) >= 5:
                break
            extra = await search_runet(variant, region=region)
            seen = {p.source_url for p in products}
            products += [p for p in extra if p.source_url not in seen]

    # Фильтр мусора: фото обязательно, цена > 0, совпадение хотя бы одного
    # значимого токена запроса в названии — это отсекает посторонние карточки
    # вроде «12 ₽» (где число — не цена, а посторонняя цифра из чужого поля).
    q_tokens = [t for t in corrected.lower().split() if len(t) > 2]
    def matches_query(name: str) -> bool:
        n = name.lower()
        return any(t in n for t in q_tokens) if q_tokens else True

    filtered = [
        p for p in products
        if p.price > 0 and matches_query(p.name)
    ]
    filtered.sort(key=lambda p: p.confidence, reverse=True)
    top = filtered[:10]

    return {
        "corrected_query": corrected,
        "variants": variants,
        "liveHit": bool(top),
        "products": [
            {
                "id": f"runet_{i}",
                "name": p.name,
                "price": p.price,
                "image_url": p.image_url,
                "source_url": p.source_url,
                "source": "runet",
                "characteristics": p.characteristics,
                "confidence": p.confidence,
                "extraction_method": p.extraction_method,
            }
            for i, p in enumerate(top)
        ],
    }


async def _call_parser(source: str, q: str, region: str, limit: int = 15) -> dict:
    """Вызывает Node.js parser server. Возвращает {products, liveHit}."""
    try:
        async with httpx.AsyncClient(timeout=50.0) as client:
            r = await client.get(
                f"{PARSER_BASE}/search",
                params={"source": source, "q": q, "region": region, "limit": limit},
            )
            return r.json()
    except Exception as e:
        logger.warning("Parser server unavailable for %s: %s", source, e)
        return {"source": source, "products": [], "liveHit": False}


def _mp_to_dict(p, source: str, idx: int) -> dict:
    return {
        "id": f"{source}_{idx}",
        "name": p.name,
        "price": p.price,
        "image_url": p.image_url,
        "source_url": p.source_url,
        "source": source,
        "characteristics": p.characteristics or {},
    }


async def _search_with_fallback(source: str, q: str, region: str, py_fn):
    data = await _call_parser(source, q, region)
    if data.get("products"):
        return data
    # Node.js server unavailable or returned 0 results — use Python parser
    try:
        products = await py_fn(q, region, 15)
        return {
            "source": source,
            "products": [_mp_to_dict(p, source, i) for i, p in enumerate(products)],
            "liveHit": bool(products),
        }
    except Exception as e:
        logger.warning("Python parser failed for %s: %s", source, e)
        return {"source": source, "products": [], "liveHit": False}


@app.get("/api/search/wildberries")
async def search_wb(q: str = "", region: str = "Москва"):
    if not q.strip():
        return {"products": [], "liveHit": False}
    corrected = correct(q)
    return await _search_with_fallback("wildberries", corrected, region, _py_wb)


@app.get("/api/search/ozon")
async def search_ozon(q: str = "", region: str = "Москва"):
    if not q.strip():
        return {"products": [], "liveHit": False}
    corrected = correct(q)
    return await _search_with_fallback("ozon", corrected, region, _py_ozon)


@app.get("/api/search/yandex_market")
async def search_ym(q: str = "", region: str = "Москва"):
    if not q.strip():
        return {"products": [], "liveHit": False}
    corrected = correct(q)
    return await _search_with_fallback("yandex_market", corrected, region, _py_ym)


@app.get("/health")
async def health():
    parser_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{PARSER_BASE}/health")
            parser_ok = r.json().get("ok", False)
    except Exception:
        pass
    return {"status": "ok", "parser_server": parser_ok}
