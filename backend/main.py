from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys, os, asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'ml'))
from suggestions import get_suggestions
from web_agent import search_runet

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
    products = await search_runet(q, region=region)
    return [
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
    ]


@app.get("/health")
def health():
    return {"status": "ok"}
