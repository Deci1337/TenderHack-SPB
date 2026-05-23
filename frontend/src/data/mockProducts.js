const makeProduct = (id, name, price, source, brand, extra = {}) => ({
  id,
  name,
  price,
  image_url: `https://placehold.co/400x400/EFF6FF/0369A1?text=${encodeURIComponent(brand)}`,
  source_url: '#',
  source,
  characteristics: {
    Бренд: brand,
    Сезон: 'Летняя',
    Размер: '205/55 R16',
    'Индекс скорости': 'V (до 240 км/ч)',
    'Индекс нагрузки': '91 (615 кг)',
    Страна: extra.country || 'Германия',
    Гарантия: '2 года',
    ...extra,
  },
})

export const MOCK_PRODUCTS = [
  // Wildberries — 10 товаров
  makeProduct(1,  'Шина летняя Michelin Primacy 4 205/55 R16 91V',              6490, 'wildberries', 'Michelin',    { Страна: 'Франция' }),
  makeProduct(2,  'Шина летняя Bridgestone Turanza T005 205/55 R16 91W',         5890, 'wildberries', 'Bridgestone', { Страна: 'Япония' }),
  makeProduct(3,  'Шина летняя Continental ContiPremiumContact 5 205/55 R16',    5290, 'wildberries', 'Continental', { Страна: 'Германия' }),
  makeProduct(4,  'Шина летняя Nokian Hakka Green 3 205/55 R16 91H',             4990, 'wildberries', 'Nokian',      { Страна: 'Финляндия' }),
  makeProduct(5,  'Шина летняя Pirelli Cinturato P7 205/55 R16 91W',             6190, 'wildberries', 'Pirelli',     { Страна: 'Италия' }),
  makeProduct(6,  'Шина летняя Goodyear EfficientGrip Performance 205/55 R16',   5590, 'wildberries', 'Goodyear',    { Страна: 'США' }),
  makeProduct(7,  'Шина летняя Hankook Ventus Prime3 K125 205/55 R16 91V',       4390, 'wildberries', 'Hankook',     { Страна: 'Корея' }),
  makeProduct(8,  'Шина летняя Kumho Ecsta HS51 205/55 R16 91V',                 3890, 'wildberries', 'Kumho',       { Страна: 'Корея' }),
  makeProduct(9,  'Шина летняя Yokohama BluEarth-ES ES32 205/55 R16 91V',        4790, 'wildberries', 'Yokohama',    { Страна: 'Япония' }),
  makeProduct(10, 'Шина летняя Toyo Proxes CF2 205/55 R16 91V',                  4290, 'wildberries', 'Toyo',        { Страна: 'Япония' }),

  // Ozon — 10 товаров
  makeProduct(11, 'Шина летняя Michelin Pilot Sport 4 205/55 R16 91Y',           7290, 'ozon', 'Michelin',    { Страна: 'Франция', 'Индекс скорости': 'Y (до 300 км/ч)' }),
  makeProduct(12, 'Шина летняя Bridgestone Potenza Sport 205/55 R16 91W',        6890, 'ozon', 'Bridgestone', { Страна: 'Япония' }),
  makeProduct(13, 'Шина летняя Continental SportContact 7 205/55 R16 91Y',       7490, 'ozon', 'Continental', { Страна: 'Германия', 'Индекс скорости': 'Y (до 300 км/ч)' }),
  makeProduct(14, 'Шина летняя Nokian Tyres Powerproof 205/55 R16 91W',          5490, 'ozon', 'Nokian',      { Страна: 'Финляндия' }),
  makeProduct(15, 'Шина летняя Pirelli P Zero 205/55 R16 91W',                   8190, 'ozon', 'Pirelli',     { Страна: 'Италия' }),
  makeProduct(16, 'Шина летняя Goodyear Eagle F1 Asymmetric 6 205/55 R16',       6790, 'ozon', 'Goodyear',    { Страна: 'США' }),
  makeProduct(17, 'Шина летняя Dunlop Sport Maxx RT2 205/55 R16 91W',            5990, 'ozon', 'Dunlop',      { Страна: 'Япония' }),
  makeProduct(18, 'Шина летняя Falken Ziex ZE310R Ecorun 205/55 R16 91V',        4190, 'ozon', 'Falken',      { Страна: 'Япония' }),
  makeProduct(19, 'Шина летняя Nexen NFera SU1 205/55 R16 91W',                  3990, 'ozon', 'Nexen',       { Страна: 'Корея' }),
  makeProduct(20, 'Шина летняя Maxxis Premitra HP5 205/55 R16 91V',              3590, 'ozon', 'Maxxis',      { Страна: 'Тайвань' }),

  // Яндекс Маркет — 10 товаров
  makeProduct(21, 'Шина летняя Michelin Energy Saver+ 205/55 R16 91V',           5990, 'yandex_market', 'Michelin',    { Страна: 'Франция' }),
  makeProduct(22, 'Шина летняя Bridgestone Ecopia EP300 205/55 R16 91V',         5190, 'yandex_market', 'Bridgestone', { Страна: 'Япония' }),
  makeProduct(23, 'Шина летняя Continental EcoContact 6 205/55 R16 91V',         5690, 'yandex_market', 'Continental', { Страна: 'Германия' }),
  makeProduct(24, 'Шина летняя Nokian Tyres Wetproof 205/55 R16 91V',            5290, 'yandex_market', 'Nokian',      { Страна: 'Финляндия' }),
  makeProduct(25, 'Шина летняя Pirelli Cinturato P1 205/55 R16 91V',             5490, 'yandex_market', 'Pirelli',     { Страна: 'Италия' }),
  makeProduct(26, 'Шина летняя Goodyear EfficientGrip 2 205/55 R16 91V',         5090, 'yandex_market', 'Goodyear',    { Страна: 'США' }),
  makeProduct(27, 'Шина летняя Vredestein Ultrac 205/55 R16 91Y',                5890, 'yandex_market', 'Vredestein',  { Страна: 'Нидерланды' }),
  makeProduct(28, 'Шина летняя Giti GitiSynergy H2 205/55 R16 91V',              2990, 'yandex_market', 'Giti',        { Страна: 'Китай' }),
  makeProduct(29, 'Шина летняя Ikon Tyres Autograph Eco 3 205/55 R16 91V',       3290, 'yandex_market', 'Ikon',        { Страна: 'Финляндия' }),
  makeProduct(30, 'Шина летняя Sailun Atrezzo Elite 205/55 R16 91V',             2790, 'yandex_market', 'Sailun',      { Страна: 'Китай' }),

  // Рунет — 10 товаров
  makeProduct(31, 'Michelin Primacy 4 205/55 R16 — магазин Шинторг',             6290, 'runet', 'Michelin',    { Страна: 'Франция', Магазин: 'shintorg.ru' }),
  makeProduct(32, 'Bridgestone Turanza T005 205/55 R16 — Колесо.ру',             5690, 'runet', 'Bridgestone', { Страна: 'Япония',  Магазин: 'koleso.ru' }),
  makeProduct(33, 'Continental Premium 5 205/55 R16 — Тайрекс',                  5090, 'runet', 'Continental', { Страна: 'Германия', Магазин: 'tyrex.ru' }),
  makeProduct(34, 'Nokian Hakka Green 3 205/55 R16 — Автодок',                   4790, 'runet', 'Nokian',      { Страна: 'Финляндия', Магазин: 'autodoc.ru' }),
  makeProduct(35, 'Pirelli Cinturato P7 205/55 R16 — ШинаДар',                   5990, 'runet', 'Pirelli',     { Страна: 'Италия', Магазин: 'shinadar.ru' }),
  makeProduct(36, 'Goodyear EfficientGrip 205/55 R16 — Резинка',                 5390, 'runet', 'Goodyear',    { Страна: 'США', Магазин: 'rezinka.ru' }),
  makeProduct(37, 'Hankook Ventus Prime3 205/55 R16 — 4Шина',                    4190, 'runet', 'Hankook',     { Страна: 'Корея', Магазин: '4shina.ru' }),
  makeProduct(38, 'Yokohama BluEarth 205/55 R16 — Шинсервис',                    4590, 'runet', 'Yokohama',    { Страна: 'Япония', Магазин: 'shinservice.ru' }),
  makeProduct(39, 'Dunlop Sport Maxx 205/55 R16 — ТД Шины',                      5790, 'runet', 'Dunlop',      { Страна: 'Япония', Магазин: 'tdshiny.ru' }),
  makeProduct(40, 'Kumho Ecsta HS51 205/55 R16 — Шинный Центр',                  3690, 'runet', 'Kumho',       { Страна: 'Корея', Магазин: 'shincenter.ru' }),
]
