// Гео-справочник для маркетплейсов. У каждого источника свой код региона:
//   wbDest    — Wildberries параметр `dest` (ID региона доставки)
//   ymLr      — Yandex `lr` (Listing Region, он же регион для market.yandex.ru)
//   ozonCity  — Ozon название города для geo-куки `__Secure-ext_xcid`/`x-o3-app-name`
//               (Ozon хранит регион в куках; в URL региона нет)
//   deliveryLocation — системная точка доставки для отчёта/фронта. Быстрый
//               вариант: центр города; точный PVZ можно добавить отдельным ID.
const CITY_TABLE = {
  'москва': { wbDest: '-1257786', ymLr: '213', ozonCity: 'Москва', deliveryLocation: { type: 'city_center', city: 'Москва', address: 'Тверская улица, 1' } },
  'санкт-петербург': { wbDest: '-1123300', ymLr: '2', ozonCity: 'Санкт-Петербург', deliveryLocation: { type: 'city_center', city: 'Санкт-Петербург', address: 'Невский проспект, 1' } },
  'спб': { wbDest: '-1123300', ymLr: '2', ozonCity: 'Санкт-Петербург', deliveryLocation: { type: 'city_center', city: 'Санкт-Петербург', address: 'Невский проспект, 1' } },
  'питер': { wbDest: '-1123300', ymLr: '2', ozonCity: 'Санкт-Петербург', deliveryLocation: { type: 'city_center', city: 'Санкт-Петербург', address: 'Невский проспект, 1' } },
  'новосибирск': { wbDest: '-364763', ymLr: '65', ozonCity: 'Новосибирск', deliveryLocation: { type: 'city_center', city: 'Новосибирск', address: 'Красный проспект, 1' } },
  'екатеринбург': { wbDest: '-1221148', ymLr: '54', ozonCity: 'Екатеринбург', deliveryLocation: { type: 'city_center', city: 'Екатеринбург', address: 'проспект Ленина, 24' } },
  'казань': { wbDest: '-2133463', ymLr: '43', ozonCity: 'Казань', deliveryLocation: { type: 'city_center', city: 'Казань', address: 'улица Баумана, 1' } },
  'нижний новгород': { wbDest: '-1216601', ymLr: '47', ozonCity: 'Нижний Новгород', deliveryLocation: { type: 'city_center', city: 'Нижний Новгород', address: 'Большая Покровская улица, 1' } },
  'челябинск': { wbDest: '-2204618', ymLr: '56', ozonCity: 'Челябинск', deliveryLocation: { type: 'city_center', city: 'Челябинск', address: 'проспект Ленина, 1' } },
  'самара': { wbDest: '-2210958', ymLr: '51', ozonCity: 'Самара', deliveryLocation: { type: 'city_center', city: 'Самара', address: 'Ленинградская улица, 1' } },
  'краснодар': { wbDest: '-1717366', ymLr: '35', ozonCity: 'Краснодар', deliveryLocation: { type: 'city_center', city: 'Краснодар', address: 'Красная улица, 1' } },
  'ростов-на-дону': { wbDest: '-1281020', ymLr: '39', ozonCity: 'Ростов-на-Дону', deliveryLocation: { type: 'city_center', city: 'Ростов-на-Дону', address: 'Большая Садовая улица, 1' } },
  'уфа': { wbDest: '-1248568', ymLr: '172', ozonCity: 'Уфа', deliveryLocation: { type: 'city_center', city: 'Уфа', address: 'проспект Октября, 1' } },
  'пермь': { wbDest: '-2030222', ymLr: '50', ozonCity: 'Пермь', deliveryLocation: { type: 'city_center', city: 'Пермь', address: 'улица Ленина, 1' } },
  'волгоград': { wbDest: '-1264932', ymLr: '38', ozonCity: 'Волгоград', deliveryLocation: { type: 'city_center', city: 'Волгоград', address: 'проспект Ленина, 1' } },
  'воронеж': { wbDest: '-1272285', ymLr: '193', ozonCity: 'Воронеж', deliveryLocation: { type: 'city_center', city: 'Воронеж', address: 'улица Пушкинская, 1' } },
  'омск': { wbDest: '-1219954', ymLr: '66', ozonCity: 'Омск', deliveryLocation: { type: 'city_center', city: 'Омск', address: 'улица Ленина, 1' } },
  'красноярск': { wbDest: '-1282985', ymLr: '62', ozonCity: 'Красноярск', deliveryLocation: { type: 'city_center', city: 'Красноярск', address: 'проспект Мира, 1' } },
  'саратов': { wbDest: '-1277536', ymLr: '194', ozonCity: 'Саратов', deliveryLocation: { type: 'city_center', city: 'Саратов', address: 'проспект Кирова, 1' } },
  'тюмень': { wbDest: '-1978807', ymLr: '55', ozonCity: 'Тюмень', deliveryLocation: { type: 'city_center', city: 'Тюмень', address: 'улица Республики, 1' } },
  'тольятти': { wbDest: '-2210958', ymLr: '970', ozonCity: 'Тольятти', deliveryLocation: { type: 'city_center', city: 'Тольятти', address: 'Новый город, 1' } },
  'ижевск': { wbDest: '-2221954', ymLr: '44', ozonCity: 'Ижевск', deliveryLocation: { type: 'city_center', city: 'Ижевск', address: 'улица Пушкинская, 1' } },
  'барнаул': { wbDest: '-1221420', ymLr: '197', ozonCity: 'Барнаул', deliveryLocation: { type: 'city_center', city: 'Барнаул', address: 'проспект Ленина, 1' } },
  'иркутск': { wbDest: '-1277900', ymLr: '63', ozonCity: 'Иркутск', deliveryLocation: { type: 'city_center', city: 'Иркутск', address: 'улица Ленина, 1' } },
  'хабаровск': { wbDest: '-1700013', ymLr: '76', ozonCity: 'Хабаровск', deliveryLocation: { type: 'city_center', city: 'Хабаровск', address: 'улица Муравьёва-Амурского, 1' } },
  'владивосток': { wbDest: '-1265703', ymLr: '75', ozonCity: 'Владивосток', deliveryLocation: { type: 'city_center', city: 'Владивосток', address: 'Светланская улица, 1' } },
  'ярославль': { wbDest: '-1256786', ymLr: '16', ozonCity: 'Ярославль', deliveryLocation: { type: 'city_center', city: 'Ярославль', address: 'улица Кирова, 1' } },
  'владимир': { wbDest: '-1256843', ymLr: '192', ozonCity: 'Владимир', deliveryLocation: { type: 'city_center', city: 'Владимир', address: 'Большая Московская улица, 1' } },
  'тверь': { wbDest: '-1261313', ymLr: '14', ozonCity: 'Тверь', deliveryLocation: { type: 'city_center', city: 'Тверь', address: 'Советская улица, 1' } },
  'рязань': { wbDest: '-1269413', ymLr: '11', ozonCity: 'Рязань', deliveryLocation: { type: 'city_center', city: 'Рязань', address: 'улица Ленина, 1' } },
  'липецк': { wbDest: '-1275526', ymLr: '9', ozonCity: 'Липецк', deliveryLocation: { type: 'city_center', city: 'Липецк', address: 'площадь Ленина, 1' } },
  'тула': { wbDest: '-1257668', ymLr: '15', ozonCity: 'Тула', deliveryLocation: { type: 'city_center', city: 'Тула', address: 'проспект Ленина, 1' } },
  'калининград': { wbDest: '-1258928', ymLr: '22', ozonCity: 'Калининград', deliveryLocation: { type: 'city_center', city: 'Калининград', address: 'проспект Мира, 1' } },
  'мурманск': { wbDest: '-1256944', ymLr: '23', ozonCity: 'Мурманск', deliveryLocation: { type: 'city_center', city: 'Мурманск', address: 'проспект Ленина, 1' } },
  'архангельск': { wbDest: '-1256685', ymLr: '20', ozonCity: 'Архангельск', deliveryLocation: { type: 'city_center', city: 'Архангельск', address: 'Троицкий проспект, 1' } },
};

function normalizeCityKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function defaultDeliveryLocation(city) {
  if (!city) return null;
  const normalizedCity = String(city).trim();
  return {
    type: 'city_center',
    city: normalizedCity,
    address: `${normalizedCity}, центр`,
  };
}

// Возвращает {wbDest, ymLr, ozonCity, city, deliveryLocation} или null.
// Приоритет у явных кодов (override), затем — справочник по имени города.
export function resolveGeo({ city, wbDest, ymLr, ozonCity, deliveryLocation } = {}) {
  const fromTable = city ? CITY_TABLE[normalizeCityKey(city)] : null;
  const resolved = {
    city: city ?? fromTable?.city ?? null,
    wbDest: wbDest ?? fromTable?.wbDest ?? null,
    ymLr: ymLr ?? fromTable?.ymLr ?? null,
    ozonCity: ozonCity ?? fromTable?.ozonCity ?? (city ?? null),
    deliveryLocation: deliveryLocation ?? fromTable?.deliveryLocation ?? defaultDeliveryLocation(city),
  };
  if (!resolved.wbDest && !resolved.ymLr && !resolved.ozonCity && !resolved.city && !resolved.deliveryLocation) {
    return null;
  }
  return resolved;
}

export function listGeoCities() {
  return Object.keys(CITY_TABLE);
}
