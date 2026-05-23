from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ml'))
from suggestions import get_suggestions
from web_agent import search_runet
from spell_checker import correct
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


@app.get("/api/search/runet")
async def search_runet_endpoint(q: str = "", region: str = "Москва"):
    if not q.strip():
        return []

    # 1. Исправляем опечатки локально (symspellpy, без интернета)
    corrected = correct(q)

    # 2. LLM расширяет запрос: "шина летняя" → ["шина летняя", "летние шины", "автошина"]
    variants = expand_query(corrected)
    if not variants:
        variants = [corrected]

    # 3. Ищем по первому (основному) варианту — он уже исправлен и расширен
    primary = variants[0]
    products = await search_runet(primary, region=region)

    # 4. Если мало результатов — добираем по синонимам
    if len(products) < 3 and len(variants) > 1:
        for variant in variants[1:]:
            if len(products) >= 5:
                break
            extra = await search_runet(variant, region=region)
            seen = {p.source_url for p in products}
            products += [p for p in extra if p.source_url not in seen]

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
    }


@app.get("/health")
def health():
    return {"status": "ok"}
