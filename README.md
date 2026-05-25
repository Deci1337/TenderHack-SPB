# TenderHack SPB — Агрегатор цен для госзакупок

> Система мониторинга цен по маркетплейсам для расчёта НМЦК (начальной максимальной цены контракта). Ищет товары на Wildberries, Ozon, Яндекс Маркет и в открытом рунете — параллельно, без VPN, с нормализацией запросов через локальную LLM.

Мы правда старались))
---

## Скриншоты

**Результаты поиска** — параллельная выдача по источникам с медианной ценой

![Результаты поиска](docs/preview-results.png)

---

## Содержание

- [Возможности](#возможности)
- [Архитектура](#архитектура)
- [Стек технологий](#стек-технологий)
- [Быстрый старт](#быстрый-старт)
- [API](#api)
- [Переменные окружения](#переменные-окружения)
- [Структура проекта](#структура-проекта)

---

## Возможности

- **Поиск по 4 источникам** — Wildberries, Ozon, Яндекс Маркет, рунет (DuckDuckGo + Playwright)
- **Нормализация запроса** — исправление опечаток, раскладки клавиатуры, профессионального жаргона через Qwen 3-4B
- **Автодополнение** — группированные подсказки по категориям с оценкой уверенности
- **Расчёт НМЦК** — медианная цена с фильтрацией выбросов (±33%)
- **Региональные цены** — выбор из 10 городов России
- **Фильтрация по цене** — диапазон мин/макс
- **Stealth-парсинг** — Chromium с анти-детект плагином в отдельном Docker-сервисе
- **Работа без VPN** — все источники доступны с российских серверов

---

## Архитектура

```
┌─────────────┐     ┌─────────────┐     ┌───────────────┐     ┌───────────────┐
│   Frontend  │────▶│   Backend   │────▶│ Parser Server │────▶│ Stealth Proxy │
│  React+Vite │     │   FastAPI   │     │   Node.js     │     │  Playwright   │
│   :80       │     │   :8000     │     │   :8008       │     │   :9377       │
└─────────────┘     └──────┬──────┘     └───────────────┘     └───────────────┘
                           │
                    ┌──────▼──────┐
                    │  ML Service │
                    │  Qwen 3-4B  │
                    │  (опционал) │
                    └─────────────┘
```

**Цепочка запроса:**

1. Пользователь вводит запрос → Frontend отправляет на Backend
2. Backend нормализует запрос (spell-check + синонимы через LLM)
3. Backend параллельно запрашивает Parser Server по каждому источнику
4. Parser Server пытается получить данные: httpx API → HTML-парсинг → Playwright stealth
5. Web Agent ищет в рунете через DuckDuckGo: JSON-LD → OpenGraph → DOM → LLM-фолбэк
6. Backend применяет медианный отбор, возвращает результаты на Frontend

---

## Стек технологий

| Слой | Технологии |
|------|-----------|
| **Frontend** | React 18, Vite, React Router, nginx |
| **Backend** | Python 3.12, FastAPI, uvicorn, httpx |
| **Parser** | Node.js, Playwright, puppeteer-extra stealth |
| **ML** | Qwen3-4B-Instruct (HuggingFace), symspellpy, PyTorch |
| **Инфра** | Docker Compose, nginx reverse proxy |

---

## Быстрый старт

### Требования

- Docker ≥ 24
- Docker Compose ≥ 2.20

### Запуск

```bash
git clone https://github.com/Deci1337/TenderHack-SPB.git
cd TenderHack-SPB

docker compose up -d
```

Приложение доступно на `http://localhost`.

### Первый запуск с LLM

LLM не используется по умолчанию (`USE_LLM=0`). Для включения:

```bash
# Скачать модель (только один раз)
docker compose run --rm backend python ml/download_model.py

# Включить LLM
USE_LLM=1 docker compose up -d
```

---

## API

### `GET /health`

Проверка состояния сервиса.

```json
{ "ok": true }
```

---

### `GET /search`

Поиск товаров на маркетплейсе.

| Параметр | Тип | Обязательный | Описание |
|----------|-----|:---:|---------|
| `source` | string | ✓ | `wildberries` \| `ozon` \| `yandex_market` \| `runet` |
| `q` | string | ✓ | Поисковый запрос |
| `region` | string | — | Город (по умолчанию: Москва) |
| `limit` | integer | — | Макс. результатов, до 10 |

**Ответ:**

```json
{
  "source": "wildberries",
  "liveHit": true,
  "products": [
    {
      "id": "string",
      "name": "string",
      "price": 1490,
      "image_url": "https://...",
      "source_url": "https://...",
      "source": "wildberries",
      "characteristics": {},
      "delivery_text": "Завтра",
      "delivery_days": 1,
      "availability": "in_stock"
    }
  ]
}
```

---

### `GET /suggest`

Автодополнение по префиксу запроса.

| Параметр | Тип | Описание |
|----------|-----|---------|
| `q` | string | Начало запроса |
| `limit` | integer | Макс. подсказок |

**Ответ:** список подсказок, сгруппированных по категориям (Шины, Оргтехника, Одежда и т.д.), с полем `confidence` от 0.0 до 1.0.

---

### `POST /nmck`

Расчёт НМЦК по набору цен.

```json
{ "prices": [1490, 1650, 1520, 12000, 1580] }
```

```json
{
  "median": 1550,
  "status": "ok",
  "message": "Медианная цена рассчитана по 4 значениям (1 выброс отфильтрован)"
}
```

---

## Переменные окружения

| Переменная | Сервис | По умолчанию | Описание |
|-----------|--------|:---:|---------|
| `USE_LLM` | backend | `0` | Включить Qwen для нормализации запросов |
| `PARSER_SERVER_URL` | backend | `http://parser-server:8008` | URL парсер-сервера |
| `STEALTH_BROWSER_URL` | parser-server | `http://stealth-proxy:9377` | URL stealth-браузера |
| `PARSER_PORT` | parser-server | `8008` | Порт парсер-сервера |
| `PUBLIC_PORT` | frontend | `80` | Внешний порт фронтенда |

---

## Структура проекта

```
TenderHack-SPB/
├── frontend/               # React + Vite SPA
│   ├── src/
│   │   ├── pages/          # SearchPage, ResultsPage
│   │   ├── components/     # UI-компоненты
│   │   └── api/            # HTTP-клиент к backend
│   ├── nginx.conf
│   └── Dockerfile
│
├── backend/                # FastAPI — оркестратор
│   ├── main.py             # Точка входа, эндпоинты
│   ├── src/
│   │   └── lib/            # Парсеры, утилиты, pdf-ingest
│   ├── server.js           # Node.js парсер-сервер
│   ├── stealth-proxy.js    # Stealth-браузер сервис
│   └── requirements.txt
│
├── ml/                     # ML-модули (Python)
│   ├── llm_service.py      # Qwen: expand_query, suggest_completions, НМЦК
│   ├── marketplace_parsers.py   # Нативные парсеры WB / Ozon / ЯМ
│   ├── marketplace_playwright.py # Playwright-фолбэк
│   ├── web_agent.py        # Поиск в рунете (DuckDuckGo + Playwright + LLM)
│   ├── query_normalize.py  # Нормализация + spell-check
│   ├── ru_dict.txt         # Русский словарь (symspellpy)
│   └── ru_dict_domain.txt  # Доменный словарь (товары, закупки)
│
└── docker-compose.yml
```

---

## Лицензия

MIT
