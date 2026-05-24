from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys, os, asyncio, json, logging
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ml'))
from suggestions import get_suggestions
from web_agent import search_runet
from spell_checker import correct

logger = logging.getLogger(__name__)

PARSER_BASE = os.getenv("PARSER_SERVER_URL", "http://localhost:8008")
PARSER_TIMEOUT_S = float(os.getenv("PARSER_TIMEOUT_S", "120"))
PARSER_RETRIES = max(1, int(os.getenv("PARSER_RETRIES", "2")))
MAX_CARDS_PER_SOURCE = 10

# expand_query тянет Qwen модель (~8 ГБ). Включается после `python ml/download_model.py`
# Чтобы включить — поставь USE_LLM=1 в окружении
USE_LLM = os.getenv("USE_LLM") == "1"
if USE_LLM:
    from llm_service import expand_query

app = FastAPI(title="PriceHunter API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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
async def search_runet_endpoint(q: str = "", region: str = "Москва", limit: int = MAX_CARDS_PER_SOURCE):
    if not q.strip():
        return {"corrected_query": q, "variants": [], "products": [], "error": "empty_query"}

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
    runet_limit = max(1, min(limit, MAX_CARDS_PER_SOURCE))
    products = await search_runet(primary, region=region, limit=runet_limit)

    # 4. Если мало — добираем по синонимам
    if len(products) < 3 and len(variants) > 1:
        for variant in variants[1:]:
            if len(products) >= runet_limit:
                break
            extra = await search_runet(variant, region=region, limit=runet_limit)
            seen = {p.source_url for p in products}
            products += [p for p in extra if p.source_url not in seen]
            products = products[:runet_limit]

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
            for i, p in enumerate(products)
        ],
        "error": None if products else "no_runet_products_found",
    }


def _normalize_limit(limit: int) -> int:
    return max(1, min(limit, MAX_CARDS_PER_SOURCE))


async def _call_parser(source: str, q: str, region: str, limit: int = MAX_CARDS_PER_SOURCE) -> dict:
    """Вызывает Node.js parser server. Возвращает {products, liveHit}."""
    last_error = None
    for attempt in range(1, PARSER_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=PARSER_TIMEOUT_S) as client:
                r = await client.get(
                    f"{PARSER_BASE}/search",
                    params={"source": source, "q": q, "region": region, "limit": _normalize_limit(limit)},
                )
                r.raise_for_status()
                payload = r.json()
                payload.setdefault("source", source)
                payload.setdefault("products", [])
                payload.setdefault("liveHit", False)
                payload["parser_attempt"] = attempt
                return payload
        except Exception as e:
            last_error = e
            logger.warning("Parser call failed for %s (attempt %d/%d): %s", source, attempt, PARSER_RETRIES, e)
            if attempt < PARSER_RETRIES:
                await asyncio.sleep(0.8 * attempt)

    return {
        "source": source,
        "products": [],
        "liveHit": False,
        "error": str(last_error) if last_error else "parser_call_failed",
    }


@app.get("/api/search/wildberries")
async def search_wb(q: str = "", region: str = "Москва", limit: int = MAX_CARDS_PER_SOURCE):
    if not q.strip():
        return {"products": [], "liveHit": False}
    corrected = correct(q)
    return await _call_parser("wildberries", corrected, region, limit)


@app.get("/api/search/ozon")
async def search_ozon(q: str = "", region: str = "Москва", limit: int = MAX_CARDS_PER_SOURCE):
    if not q.strip():
        return {"products": [], "liveHit": False}
    corrected = correct(q)
    return await _call_parser("ozon", corrected, region, limit)


@app.get("/api/search/yandex_market")
async def search_ym(q: str = "", region: str = "Москва", limit: int = MAX_CARDS_PER_SOURCE):
    if not q.strip():
        return {"products": [], "liveHit": False}
    corrected = correct(q)
    return await _call_parser("yandex_market", corrected, region, limit)


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
