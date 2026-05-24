# marketplace-parser

Система сбора ценовых предложений из 4 источников для расчёта НМЦК по 44-ФЗ.

| Источник | Стек | Эндпоинт/интерфейс |
|----------|------|--------------------|
| Wildberries | Node.js, stealth-браузер | CLI / `pipeline.js` |
| Ozon | Node.js, stealth-браузер | CLI / `pipeline.js` |
| Яндекс Маркет | Node.js, stealth-браузер | CLI / `pipeline.js` |
| Рунет (DDG + Playwright) | Python, FastAPI | `GET /api/search/runet` |

**Node.js-часть** (`src/`) — структурированный парсинг маркетплейсов: цена, характеристики, изображение, доставка.  
**Python-часть** (`ml/web_agent.py` + `backend/main.py`) — широкий поиск по рунету через DuckDuckGo Lite с последующим скрейпингом найденных страниц через Playwright. Результаты нормализуются в единый формат и отдаются через FastAPI.

## Требования

- Node.js 20+
- Docker (для антидетект-браузера)

## Установка

```bash
git clone https://github.com/mikhaildvortsov/marketplace-parser.git
cd marketplace-parser
npm install
```

## Антидетект-браузер (обязательно для Ozon / ЯМ / WB)

Маркетплейсы блокируют обычные headless-браузеры. Используется [camofox-browser](https://github.com/jo-inc/camofox-browser) — Firefox с антидетектом на уровне C++.

```bash
# Запустить контейнер (один раз)
docker run -d --name stealth-browser -p 9377:9377 ghcr.io/jo-inc/camofox-browser:latest

# Проверить статус
curl -sS http://127.0.0.1:9377/health
# Ожидаемый ответ: {"ok":true,"browserConnected":true,...}
```

Остановить контейнер:
```bash
docker rm -f stealth-browser
```

## Переменные окружения

Создайте файл `.env` в корне проекта:

```env
# URL антидетект-браузера (по умолчанию http://127.0.0.1:9377)
STEALTH_BROWSER_URL=http://127.0.0.1:9377

# Прокси для обхода блокировок по IP (опционально, но рекомендуется)
# HTTPS_PROXY=http://user:pass@proxy-host:port

# Включить/отключить stealth-браузер (по умолчанию включён)
# USE_PLAYWRIGHT=0

# Таймаут stealth-браузера в мс (по умолчанию 90000)
# PLAYWRIGHT_TIMEOUT=90000
```

> **Важно про IP:** датацентровые IP блокируются WB и Ozon по ASN.
> Для стабильной работы нужен резидентный прокси (`HTTPS_PROXY`).
> YM работает с большинства IP через stealth-браузер.

## Запуск

```bash
# Базовый поиск
node src/cli.js "кофемашина"

# С ограничением и форматом JSON
node src/cli.js "кофемашина" --limit 10 --json

# Только определённые источники
node src/cli.js "кофемашина" --sources wildberries,ozon

# Вывод в файл
node src/cli.js "кофемашина" --out result.json

# Универсальная JSON-схема
node src/cli.js "кофемашина" --schema --limit 10
```

## Флаги CLI

| Флаг | Описание |
|------|----------|
| `--json` | Вывести сырой JSON |
| `--schema` | Универсальная схема с top-N офферами |
| `--verbose` | Подробности по источникам |
| `--limit N` | Ограничить количество офферов |
| `--out file` | Записать результат в файл |
| `--sources a,b` | Искать только в указанных источниках |

## Структура оффера

Каждый оффер в результате содержит:

```json
{
  "source": "wildberries",
  "title": "Кофемашина рожковая CT-1160",
  "price": 3509,
  "currency": "RUB",
  "product_url": "https://www.wildberries.ru/catalog/46467713/detail.aspx",
  "image_url": "",
  "availability": "unknown",
  "features": [
    "Артикул: 46467713",
    "Гарантийный срок: 1 год",
    "Мощность устройства (Вт): 800 Вт",
    "Тип управления: механическое",
    "Объем емкости для воды: 0.35 л",
    "Тип капучинатора: ручной",
    "Материал корпуса: металл; пластик"
  ],
  "relevance_score": 50,
  "fetched_at": "2026-05-22T10:00:00.000Z"
}
```

## Как работает сбор характеристик

| Источник | Метод |
|----------|-------|
| Wildberries | DOM-парсинг карточки через stealth-браузер (`th.cellKey` + `td.cellValue`) |
| Ozon | DOM-парсинг `dl/dt/dd` внутри `[data-widget="webCharacteristics"]` |
| Яндекс Маркет | DOM-парсинг `[data-auto="product-spec"]` пар |

Характеристики собираются с карточек товаров параллельно для топ-5 офферов каждого источника.

## Архитектура

```
src/
├── cli.js               # CLI-точка входа
├── pipeline.js          # Оркестрация: источники → дедупликация → сводка
├── catalog.js           # Адаптеры источников
├── dedupe.js            # Дедупликация офферов
├── summary.js           # Ценовая сводка
└── lib/
    ├── stealth-browser.js    # REST-клиент camofox-browser
    ├── stealth-scraper.js    # DOM-парсеры WB/Ozon/YM через stealth-browser
    ├── item-details.js       # Сбор характеристик с карточек товаров
    ├── playwright-scraper.js # WB API + Playwright fallback
    ├── wildberries-api.js    # WB internal API (v18/v9)
    ├── product-pages.js      # HTTP-парсер страниц (fallback)
    ├── query.js              # Нормализация запросов и скоринг
    └── universal-schema.js   # Единая JSON-схема ответа
```

## Тесты

```bash
node --test
```

## Источники и ограничения

### Node.js источники (CLI)
- **Wildberries**: stealth-браузер → WB internal API → fallback. От датацентровых IP блокируется.
- **Ozon**: stealth-браузер → Ozon API → fallback. Требует резидентного IP или хорошего прокси.
- **Яндекс Маркет**: stealth-браузер → HTTP-fallback. Работает с большинства IP.

### Python источник (FastAPI)
- **Рунет** (`GET /api/search/runet?q=...&region=...`): поиск через DuckDuckGo Lite → ранжирование URL по коммерческим сигналам → извлечение цены/изображения через JSON-LD, OpenGraph или DOM (Playwright). Берёт топ-20 URL из DDG. Работает с любого IP, не требует прокси.

## Обоснование лимита карточек

Целевой результат на выходе — не более 35 офферов (достаточно для расчёта НМЦК по методу анализа рынка согласно 44-ФЗ).

С учётом потерь при обработке:
- ~30% отсеивается при дедупликации (одинаковые товары от разных продавцов)
- ~10% отсеивается как невалидные записи (нет цены или характеристик)

Необходимый лимит на входе:

```
limit = ceil(35 / (1 − 0.30) / (1 − 0.10)) = ceil(55.6) = 56
```

Делим на 3 источника (WB, Ozon, ЯМ): `56 / 3 ≈ 19 → 20`

Поэтому каждый источник запрашивает **20 карточек**.

При блокировке источника система возвращает частичный результат (не падает).
