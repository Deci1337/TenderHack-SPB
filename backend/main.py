from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys, os, asyncio, logging
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ml'))
from web_agent import search_runet
from query_normalize import is_product_query, normalize_query
from marketplace_parsers import search_wildberries as _py_wb, search_ozon as _py_ozon, search_yandex_market as _py_ym

logger = logging.getLogger(__name__)

PARSER_BASE = os.getenv("PARSER_SERVER_URL", "http://localhost:8008")

from pydantic import BaseModel, Field

from llm_service import expand_query, suggest_completions_list, calculate_nmck

app = FastAPI(title="PriceHunter API")

_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)


class NmckRequest(BaseModel):
    prices: list[float] = Field(..., min_length=1)
    product_count: int | None = None
    source_count: int | None = None

# Один expand_query на запрос: фронт шлёт /correct + 4 источника параллельно
_variant_cache: dict[str, list[str]] = {}
_variant_locks: dict[str, asyncio.Lock] = {}
_VARIANT_CACHE_MAX = 128


async def _search_variants(q: str) -> list[str]:
    """
    Qwen: исправление + синонимы. При сбое LLM — нормализованный запрос без стоп-слов.
    Пустой список = мусорный запрос, поиск не запускаем.
    """
    raw = q.strip()
    if not raw:
        return []

    key = raw.lower()
    if key in _variant_cache:
        return _variant_cache[key]

    if key not in _variant_locks:
        _variant_locks[key] = asyncio.Lock()

    async with _variant_locks[key]:
        if key in _variant_cache:
            return _variant_cache[key]

        loop = asyncio.get_running_loop()
        try:
            variants = await loop.run_in_executor(None, expand_query, raw)
            if variants:
                result = variants
            else:
                normalized = normalize_query(raw)
                result = [normalized] if normalized and is_product_query(normalized) else []
        except Exception as e:
            logger.warning("expand_query failed: %s", e)
            normalized = normalize_query(raw)
            result = [normalized] if normalized and is_product_query(normalized) else []

        if len(_variant_cache) >= _VARIANT_CACHE_MAX:
            _variant_cache.pop(next(iter(_variant_cache)))
        _variant_cache[key] = result
        return result


@app.get("/api/suggest")
async def suggest(q: str = "", limit: int = 3):
    q = q.strip()
    if len(q) < 2:
        return []
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, suggest_completions_list, q, min(limit, 8),
        )
    except Exception as e:
        logger.warning("LLM suggest failed: %s", e)
        return []


@app.get("/api/correct")
async def correct_query(q: str = ""):
    raw = q.strip()
    if not raw:
        return {"original": q, "corrected": q, "changed": False}

    variants = await _search_variants(raw)
    corrected = variants[0] if variants else raw
    return {
        "original": raw,
        "corrected": corrected,
        "changed": corrected.lower() != raw.lower(),
    }


@app.post("/api/nmck")
def nmck_endpoint(body: NmckRequest):
    """НМЦК: медиана после отсева выбросов (>33% от медианы), минимум 3 цены."""
    prices = sorted(float(p) for p in body.prices if p and float(p) > 0)
    result = calculate_nmck(prices)
    result["product_count"] = body.product_count if body.product_count is not None else len(prices)
    result["source_count"] = body.source_count
    return result


def _empty_runet_response(corrected: str = ""):
    return {"corrected_query": corrected, "variants": [corrected] if corrected else [], "products": []}


@app.get("/api/search/runet")
async def search_runet_endpoint(q: str = "", region: str = "Москва"):
    if not q.strip():
        return _empty_runet_response()

    variants = await _search_variants(q)
    if not variants:
        return _empty_runet_response(q.strip())

    corrected = variants[0]
    products = await search_runet(corrected, region=region)

    if len(products) < 3 and len(variants) > 1:
        for variant in variants[1:]:
            if len(products) >= 5:
                break
            products += await search_runet(variant, region=region)

    q_tokens = [t for t in corrected.lower().split() if len(t) > 2]

    def matches_query(name: str) -> bool:
        n = name.lower()
        return any(t in n for t in q_tokens) if q_tokens else True

    filtered = [p for p in products if p.price > 0 and matches_query(p.name)]
    filtered.sort(key=lambda p: p.confidence, reverse=True)
    top = filtered[:10]

    return {
        "corrected_query": corrected,
        "variants": variants,
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


async def _call_parser(source: str, q: str, region: str, limit: int = 10) -> dict:
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
    try:
        products = await py_fn(q, region, 10)
        return {
            "source": source,
            "products": [_mp_to_dict(p, source, i) for i, p in enumerate(products)],
            "liveHit": bool(products),
        }
    except Exception as e:
        logger.warning("Python parser failed for %s: %s", source, e)
        return {"source": source, "products": [], "liveHit": False}


async def _search_marketplace(source: str, q: str, region: str, py_fn):
    variants = await _search_variants(q)
    if not variants:
        return {"products": [], "liveHit": False, "corrected_query": q.strip(), "variants": []}

    corrected = variants[0]
    data = await _search_with_fallback(source, corrected, region, py_fn)

    if len(data.get("products", [])) < 3 and len(variants) > 1:
        for variant in variants[1:]:
            if len(data.get("products", [])) >= 5:
                break
            extra = await _search_with_fallback(source, variant, region, py_fn)
            if extra.get("products"):
                seen = {p.get("source_url") for p in data["products"]}
                for p in extra["products"]:
                    if p.get("source_url") not in seen:
                        data["products"].append(p)
                        seen.add(p.get("source_url"))

    data["corrected_query"] = corrected
    data["variants"] = variants
    return data


@app.get("/api/search/wildberries")
async def search_wb(q: str = "", region: str = "Москва"):
    if not q.strip():
        return {"products": [], "liveHit": False}
    return await _search_marketplace("wildberries", q, region, _py_wb)


@app.get("/api/search/ozon")
async def search_ozon(q: str = "", region: str = "Москва"):
    if not q.strip():
        return {"products": [], "liveHit": False}
    return await _search_marketplace("ozon", q, region, _py_ozon)


@app.get("/api/search/yandex_market")
async def search_ym(q: str = "", region: str = "Москва"):
    if not q.strip():
        return {"products": [], "liveHit": False}
    return await _search_marketplace("yandex_market", q, region, _py_ym)


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
