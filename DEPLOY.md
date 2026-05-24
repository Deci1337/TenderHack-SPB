# Deploy — PriceHunter (TenderHack SPB)

Один файл, одна команда — все 4 источника (WB, Ozon, Я.Маркет, Рунет) работают.

## Требования

- Docker 24+ и Docker Compose v2
- **Российский IP** (без VPN на западную страну) — Ozon и Я.Маркет режут датацентровые ASN и иностранные IP. На рос. сервере (Selectel, Timeweb, REG.ru, VK Cloud) — работает из коробки.
- ~3 ГБ RAM, ~5 ГБ диска (Playwright Chromium внутри образов)

## Запуск

```bash
git clone <repo> && cd TenderHack-SPB
docker compose up -d --build
```

Открыть: <http://server-ip/>

## Проверка что все 4 источника живые

```bash
# Health-check всех сервисов
docker compose ps

# Тест API напрямую
curl "http://localhost/api/search/wildberries?q=кофе+молотый"
curl "http://localhost/api/search/ozon?q=кофе+молотый"
curl "http://localhost/api/search/yandex_market?q=кофе+молотый"
curl "http://localhost/api/search/runet?q=кофе+молотый"
```

Каждый должен вернуть `{"products": [...]}` с 5-10 товарами.

## Архитектура

```
[ Internet ]
     ↓ :80
┌─────────────┐
│  frontend   │  nginx + SPA, проксирует /api/* в backend
└──────┬──────┘
       ↓
┌─────────────┐
│  backend    │  FastAPI :8000 — оркестратор, spell-check, Рунет-агент (Playwright)
└──────┬──────┘
       ↓
┌─────────────┐
│parser-server│  Node :8008 — WB direct API + Ozon/YM через stealth
└──────┬──────┘
       ↓
┌─────────────┐
│stealth-proxy│  Node :9377 — playwright-extra + stealth-plugin, обходит антибот
└─────────────┘
```

**Поток запроса:**
1. Браузер → `GET /api/search/wildberries?q=...` → nginx → FastAPI
2. FastAPI → `GET parser-server:8008/search?source=wildberries&q=...`
3. parser-server: для WB — прямой API c правильными headers; для Ozon/YM — через stealth-proxy
4. Если parser-server недоступен — FastAPI падает на Python-фолбэк (httpx + Playwright)
5. Рунет — отдельный endpoint, идёт напрямую в DuckDuckGo + Playwright

## Переменные окружения (опционально, через .env)

```env
PUBLIC_PORT=80          # порт frontend на хосте
USE_LLM=0               # включить Qwen для расширения запросов (нужно ~8 ГБ RAM)
```

## Команды эксплуатации

```bash
docker compose logs -f backend          # логи FastAPI
docker compose logs -f parser-server    # логи Node-парсера
docker compose logs -f stealth-proxy    # логи stealth-браузера
docker compose restart parser-server    # рестарт только парсера
docker compose down                     # остановить всё
docker compose down -v                  # + удалить volumes
```

## Troubleshooting

| Симптом | Решение |
|---|---|
| Ozon/YM возвращают 0 товаров | Проверь IP сервера — `curl ifconfig.me`. Должен быть российский ASN. |
| WB 498 в логах parser-server | Stealth-proxy упал — `docker compose restart stealth-proxy` |
| `backend` не стартует | `docker compose logs backend` — обычно проблема в `requirements.txt` |
| Долгий старт stealth-proxy | Нормально — Chromium прогревается до 30с. Healthcheck ждёт. |

## Прод-чеклист

- [ ] SSL: поставить Caddy/Traefik перед nginx или вынести SSL в nginx
- [ ] CORS: в `main.py` сейчас разрешены только localhost — добавить домен
- [ ] Rate limit: nginx `limit_req_zone` на `/api/`
- [ ] Логи: `docker compose logs --tail 100 -f` → ELK/Loki
