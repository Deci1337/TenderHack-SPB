# Python backend: FastAPI + Playwright (для web_agent.py — 4-й источник Рунет).
# Используем официальный Playwright Python образ — Chromium и зависимости уже внутри.
FROM mcr.microsoft.com/playwright/python:v1.55.0-noble

WORKDIR /app

# Системные зависимости для ML (Qwen опционально).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Python зависимости — ставим заранее для слойного кэша.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Копируем исходники.
COPY backend ./backend
COPY ml ./ml

# Python должен находить модули из ml/ (main.py делает sys.path.insert).
ENV PYTHONPATH=/app/ml:/app/backend

EXPOSE 8000

# uvicorn FastAPI — production
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
