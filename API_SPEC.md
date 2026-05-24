# PriceHunter API — контракт

> Единая точка входа для фронтенда: **`http://localhost:8009`** (Python FastAPI).  
> Фронтенд не знает о Node.js-сервере (8008) и stealth-прокси (9377) — это внутренние детали.

---

## Базовый URL

```
http://localhost:8009
```

В prod-окружении заменяется на реальный домен. Vite-прокси `/api → http://localhost:8009`.

---

## Общие типы

### `Product`

```json
{
  "id":              "wildberries_0",   // string — уникальный в рамках запроса
  "name":            "Принтер HP 107a", // string
  "price":           7490.0,            // number (рублей, без копеек)
  "image_url":       "https://...",     // string | null
  "source_url":      "https://...",     // string — ссылка на карточку товара
  "source":          "wildberries",     // "wildberries"|"ozon"|"yandex_market"|"runet"
  "characteristics": {                  // object<string,string> | {}
    "Бренд": "HP",
    "Тип печати": "лазерный"
  },
  "delivery_text":   "завтра",          // string | null — только WB/Ozon/YM
  "delivery_days":   1                  // number | null
}
```

### `SearchResponse`

```json
{
  "source":   "wildberries",  // string
  "liveHit":  true,           // bool — true если данные живые (не fallback)
  "products": [ /* Product[] */ ]
}
```

---

## Эндпоинты

### GET `/api/suggest`

Автодополнение поискового запроса (офлайн-словарь).

**Query params:**

| Параметр | Тип    | По умолчанию | Описание              |
|----------|--------|--------------|-----------------------|
| `q`      | string | `""`         | Начало запроса        |
| `limit`  | int    | `7`          | Макс. кол-во подсказок|

**Response** `200`:

```json
["принтер лазерный", "принтер струйный", "принтер МФУ"]
```

---

### GET `/api/correct`

Исправление опечаток (symspellpy, офлайн).

**Query params:**

| Параметр | Тип    | Описание       |
|----------|--------|----------------|
| `q`      | string | Запрос пользователя |

**Response** `200`:

```json
{
  "original":  "прнтр",
  "corrected": "принтер",
  "changed":   true
}
```

---

### GET `/api/search/wildberries`

**Query params:**

| Параметр | Тип    | По умолчанию | Описание     |
|----------|--------|--------------|--------------|
| `q`      | string | `""`         | Поисковый запрос |
| `region` | string | `"Москва"`   | Регион доставки  |

**Response** `200` → `SearchResponse`

---

### GET `/api/search/ozon`

Те же параметры и тот же формат ответа, что у `/wildberries`.

---

### GET `/api/search/yandex_market`

Те же параметры и тот же формат ответа.

---

### GET `/api/search/runet`

**Query params:**

| Параметр | Тип    | По умолчанию | Описание     |
|----------|--------|--------------|--------------|
| `q`      | string | `""`         | Поисковый запрос |
| `region` | string | `"Москва"`   | Регион        |

**Response** `200`:

```json
{
  "corrected_query": "принтер лазерный",
  "variants":        ["принтер лазерный", "лазерный принтер"],
  "products":        [ /* Product[] */ ]
}
```

> ⚠️ Структура отличается от других источников — есть `corrected_query` и `variants`.  
> Фронтенд должен читать `data.products`, а не `data` напрямую.

---

### GET `/health`

Проверка состояния сервисов.

**Response** `200`:

```json
{
  "status":        "ok",
  "parser_server": true
}
```

---

## Сценарий работы фронтенда

```
1. Пользователь вводит запрос
   → GET /api/suggest?q=прнтр   (автодополнение в реальном времени)

2. Пользователь отправляет форму
   → GET /api/correct?q=прнтр   (показать баннер «прнтр → принтер»)

3. Параллельно запускаем 4 запроса с задержками:
   +0.8s  GET /api/search/wildberries?q=...&region=...
   +2.2s  GET /api/search/ozon?q=...&region=...
   +3.8s  GET /api/search/yandex_market?q=...&region=...
   +5.0s  GET /api/search/runet?q=...&region=...

4. Каждый ответ → добавить карточки в UI (progressive loading)

5. После получения всех ответов → рассчитать НМЦК по ценам
```

---

## Коды ошибок

Все эндпоинты возвращают `200` даже при ошибке парсера.  
Признак неудачи — пустой массив `products: []` и `liveHit: false`.  
HTTP 4xx/5xx — только при неверных параметрах или краше сервера.

---

## Внутренняя архитектура (для бэкендера)

```
Frontend (5173)
    ↓ /api/*
Python FastAPI (8009)          ← единая точка входа
    ↓ httpx
Node.js parser server (8008)   ← WB / Ozon / YM
    ↓ REST
Stealth proxy (9377)           ← playwright-extra (или camofox Docker)
    ↓ browser automation
Маркетплейсы

Python FastAPI (8009)          ← Рунет (отдельный путь)
    ↓ Playwright
DuckDuckGo → сайты магазинов
```
