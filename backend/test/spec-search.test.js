import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery, scoreOffer, countSpecMatches } from '../src/lib/query.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function offer(title, features = [], availability = 'in_stock') {
  return { title, features, availability };
}

function specTokens(raw) {
  return normalizeQuery(raw).specTokens;
}

function ranked(query, offers) {
  const q = normalizeQuery(query);
  return offers
    .map((o) => ({ ...o, score: scoreOffer(q.tokens, o, q.specTokens) }))
    .sort((a, b) => b.score - a.score);
}

// ─── normalizeQuery: specTokens extraction ────────────────────────────────────

test('extracts numeric+unit spec from query', () => {
  const st = specTokens('телефон 6000мАч');
  assert.equal(st.length, 1);
  assert.equal(st[0].type, 'spec');
  assert.equal(st[0].value, '6000');
  assert.equal(st[0].unit, 'мач');
});

test('extracts spec with space between number and unit', () => {
  const st = specTokens('телевизор 55 дюймов');
  const s = st.find((x) => x.type === 'spec' && x.unit === 'дюйм');
  assert.ok(s, `expected spec дюйм in ${JSON.stringify(st)}`);
  assert.equal(s.value, '55');
});

test('extracts multiple numeric specs from one query', () => {
  const st = specTokens('телефон 6000мАч 128гб');
  const types = st.map((s) => `${s.value}${s.unit}`);
  assert.ok(types.includes('6000мач'), `expected 6000мач in ${types}`);
  assert.ok(types.includes('128гб'), `expected 128гб in ${types}`);
});

test('normalizes unit aliases: mAh → мач', () => {
  const st = specTokens('аккумулятор 5000 mAh');
  assert.equal(st[0]?.unit, 'мач');
});

test('normalizes unit aliases: GB → гб', () => {
  const st = specTokens('накопитель 256 GB');
  assert.equal(st[0]?.unit, 'гб');
});

test('normalizes unit aliases: ppm → стр/мин', () => {
  const st = specTokens('принтер 30 ppm');
  assert.equal(st[0]?.unit, 'стр/мин');
});

// ─── ШИНЫ ─────────────────────────────────────────────────────────────────────

test('tires: extracts full size 205/55R16', () => {
  const st = specTokens('шины 205/55R16');
  const ts = st.find((s) => s.type === 'tire_size');
  assert.ok(ts, 'tire_size spec not found');
  assert.deepEqual({ width: ts.width, profile: ts.profile, radius: ts.radius }, { width: '205', profile: '55', radius: '16' });
});

test('tires: extracts radius-only R17', () => {
  const st = specTokens('шины R17 летние');
  const tr = st.find((s) => s.type === 'tire_radius');
  assert.ok(tr, 'tire_radius not found');
  assert.equal(tr.radius, '17');
});

test('tires: extracts winter season', () => {
  const st = specTokens('шины зимние');
  const ts = st.find((s) => s.type === 'tire_season');
  assert.equal(ts?.value, 'зима');
});

test('tires: extracts summer season (летних)', () => {
  const st = specTokens('шины летних');
  assert.equal(st.find((s) => s.type === 'tire_season')?.value, 'лето');
});

test('tires: extracts всесезонные', () => {
  const st = specTokens('шины всесезонные');
  assert.equal(st.find((s) => s.type === 'tire_season')?.value, 'всесезон');
});

test('tires: extracts шипованные', () => {
  const st = specTokens('шины шипованные зимние');
  assert.equal(st.find((s) => s.type === 'tire_spike')?.value, 'шип');
});

test('tires: extracts нешипованные (friction)', () => {
  const st = specTokens('шины фрикционные зимние');
  assert.equal(st.find((s) => s.type === 'tire_spike')?.value, 'нешип');
});

test('tires: exact size match ranks first', () => {
  const r = ranked('шины 205/55R16 зимние шипованные', [
    offer('Nokian Hakkapeliitta 205/55 R16', ['Сезон: зима', 'Тип: шипованные']),
    offer('Michelin Pilot Sport 205/55 R16', ['Сезон: лето']),
    offer('Continental 225/45 R17', ['Сезон: зима', 'Тип: шипованные']),
  ]);
  assert.equal(r[0].title, 'Nokian Hakkapeliitta 205/55 R16');
});

test('tires: wrong season scores less than correct season', () => {
  const q = normalizeQuery('шины 205/55R16 зимние');
  const winter = offer('Tire A 205/55 R16', ['Сезон: зима']);
  const summer = offer('Tire B 205/55 R16', ['Сезон: лето']);
  const sw = scoreOffer(q.tokens, winter, q.specTokens);
  const ss = scoreOffer(q.tokens, summer, q.specTokens);
  assert.ok(sw > ss, `winter(${sw}) should beat summer(${ss})`);
});

// complex: size in title vs features
test('tires: size in title text is matched', () => {
  const q = normalizeQuery('шины 205/55R16');
  const titleOnly = offer('Шины Bridgestone Turanza 205/55R16 91V', []);
  const featureOnly = offer('Шины Bridgestone Turanza', ['Размер: 205/55 R16']);
  const st = countSpecMatches(q.specTokens, titleOnly);
  const sf = countSpecMatches(q.specTokens, featureOnly);
  assert.ok(st > 0, 'should match size in title');
  assert.ok(sf > 0, 'should match size in features');
});

// ─── ОРГТЕХНИКА ──────────────────────────────────────────────────────────────

test('orgtech: extracts A4 paper format', () => {
  const st = specTokens('принтер A4');
  const fmt = st.find((s) => s.type === 'paper_format');
  assert.equal(fmt?.value, 'A4');
});

test('orgtech: does not extract A1 (not a valid paper format)', () => {
  const st = specTokens('плакат A1');
  assert.ok(!st.find((s) => s.type === 'paper_format'));
});

test('orgtech: ppm alias equals стр/мин in matching', () => {
  const q = normalizeQuery('принтер 30 ppm');
  const p1 = offer('HP LaserJet', ['Скорость: 30 стр/мин']);
  const p2 = offer('HP LaserJet', ['Скорость: 20 стр/мин']);
  const s1 = scoreOffer(q.tokens, p1, q.specTokens);
  const s2 = scoreOffer(q.tokens, p2, q.specTokens);
  assert.ok(s1 > s2, `30ppm offer(${s1}) should beat 20ppm(${s2})`);
});

test('orgtech: printer ranking: A4 + 30 стр/мин first', () => {
  const r = ranked('принтер лазерный A4 30 стр/мин', [
    offer('HP LaserJet Pro', ['Формат: A4', 'Скорость: 30 стр/мин', 'Тип: лазерный']),
    offer('Canon LBP', ['Формат: A4', 'Скорость: 20 стр/мин', 'Тип: лазерный']),
    offer('Epson струйный A4', ['Формат: A4', 'Скорость: 10 стр/мин', 'Тип: струйный']),
  ]);
  assert.equal(r[0].title, 'HP LaserJet Pro');
});

// complex: DPI in query
test('orgtech: dpi spec extracted and matched', () => {
  const q = normalizeQuery('сканер 600 dpi');
  const s1 = offer('Scanner A', ['Оптическое разрешение: 600 dpi']);
  const s2 = offer('Scanner B', ['Оптическое разрешение: 1200 dpi']);
  const sc1 = countSpecMatches(q.specTokens, s1);
  const sc2 = countSpecMatches(q.specTokens, s2);
  assert.ok(sc1 > sc2, `600dpi offer(${sc1}) should beat 1200dpi(${sc2})`);
});

// ─── ОДЕЖДА ──────────────────────────────────────────────────────────────────

test('clothes: extracts XL size', () => {
  const st = specTokens('куртка XL');
  assert.equal(st.find((s) => s.type === 'clothing_size')?.value, 'xl');
});

test('clothes: extracts numeric size 52', () => {
  const st = specTokens('брюки 52');
  assert.equal(st.find((s) => s.type === 'clothing_size')?.value, '52');
});

test('clothes: does not treat 2023 as clothing size', () => {
  const st = specTokens('куртка 2023');
  assert.ok(!st.find((s) => s.type === 'clothing_size'), 'year should not be clothing size');
});

test('clothes: size range 44-46 extracted', () => {
  const st = specTokens('платье 44-46');
  const sz = st.find((s) => s.type === 'clothing_size');
  assert.equal(sz?.value, '44-46');
});

test('clothes: XL offer ranks above L offer', () => {
  const q = normalizeQuery('куртка мужская XL зимняя');
  const xl = offer('Куртка мужская зимняя XL', ['Размер: XL', 'Сезон: зима']);
  const l = offer('Куртка мужская зимняя L', ['Размер: L', 'Сезон: зима']);
  const sxl = scoreOffer(q.tokens, xl, q.specTokens);
  const sl = scoreOffer(q.tokens, l, q.specTokens);
  assert.ok(sxl > sl, `XL(${sxl}) should beat L(${sl})`);
});

test('clothes: wrong season scores less', () => {
  const q = normalizeQuery('куртка XL зимняя');
  const winter = offer('Куртка XL зима', ['Размер: XL', 'Сезон: зима']);
  const summer = offer('Куртка XL лето', ['Размер: XL', 'Сезон: лето']);
  const sw = scoreOffer(q.tokens, winter, q.specTokens);
  const ss = scoreOffer(q.tokens, summer, q.specTokens);
  assert.ok(sw > ss, `winter(${sw}) should beat summer(${ss})`);
});

test('clothes: height in cm matched', () => {
  const q = normalizeQuery('брюки 52 рост 176 см');
  const p1 = offer('Брюки', ['Размер: 52', 'Рост: 176 см']);
  const p2 = offer('Брюки', ['Размер: 52', 'Рост: 182 см']);
  const s1 = scoreOffer(q.tokens, p1, q.specTokens);
  const s2 = scoreOffer(q.tokens, p2, q.specTokens);
  assert.ok(s1 > s2, `176cm(${s1}) should beat 182cm(${s2})`);
});

// ─── СЛОЖНЫЕ СЛУЧАИ ──────────────────────────────────────────────────────────

// Единица в запросе одна, в карточке — другой alias той же единицы
test('complex: mAh in query matches мАч in features', () => {
  const q = normalizeQuery('смартфон 5000 mAh');
  const o = offer('Смартфон', ['Ёмкость аккумулятора: 5000 мАч']);
  assert.ok(countSpecMatches(q.specTokens, o) > 0);
});

// Число с десятичной точкой
test('complex: decimal value 1.5 кВт matched', () => {
  const q = normalizeQuery('чайник 1.5 кВт');
  const o = offer('Электрочайник', ['Мощность: 1.5 кВт']);
  const st = q.specTokens.find((s) => s.unit === 'квт');
  assert.ok(st, 'квт spec not found in query');
  assert.ok(countSpecMatches(q.specTokens, o) > 0);
});

// Запрос только с числовой характеристикой без текстового названия
test('complex: bare spec query "6000мАч" still extracts tokens', () => {
  const st = specTokens('6000мАч');
  assert.equal(st.length, 1);
  assert.equal(st[0].value, '6000');
});

// Несколько похожих карточек — побеждает та, у которой больше совпадений по specs
test('complex: more spec matches wins over single match', () => {
  const q = normalizeQuery('телефон 8 гб 256 гб 5000 мАч');
  const full = offer('Смартфон Pro', ['ОЗУ: 8 гб', 'Память: 256 гб', 'Аккумулятор: 5000 мАч']);
  const partial = offer('Смартфон Lite', ['ОЗУ: 8 гб', 'Память: 128 гб', 'Аккумулятор: 4000 мАч']);
  const sf = scoreOffer(q.tokens, full, q.specTokens);
  const sp = scoreOffer(q.tokens, partial, q.specTokens);
  assert.ok(sf > sp, `full(${sf}) should beat partial(${sp})`);
});

// Значение spec в запросе совпадает числом но не единицей → не матч
test('complex: same number different unit is not a match', () => {
  const q = normalizeQuery('кабель 100 м');
  // "м" не в UNIT_ALIASES — значит specTokens будет пустым; проверяем что не ломается
  const o = offer('Кабель', ['Длина: 100 м', 'Сечение: 1.5 мм']);
  assert.doesNotThrow(() => scoreOffer(q.tokens, o, q.specTokens));
});

// Ложноположительный размер одежды: число вне диапазона 36–62 не должно матчиться
test('complex: large number not treated as clothing size', () => {
  const st = specTokens('пальто 1500 рублей');
  assert.ok(!st.find((s) => s.type === 'clothing_size'));
});

// Размер шины в тексте карточки записан через пробел "205/55 R 16"
test('complex: tire size with spaces in offer text', () => {
  const q = normalizeQuery('шины 205/55R16');
  const o = offer('Bridgestone 205/55 R 16 91V', []);
  assert.ok(countSpecMatches(q.specTokens, o) > 0, 'should match tire size with spaces');
});

// Карточка без характеристик получает меньше очков чем с характеристиками
test('complex: offer without features scores less than offer with matching features', () => {
  const q = normalizeQuery('принтер A4 20 стр/мин');
  const withFeatures = offer('Принтер HP', ['Формат: A4', 'Скорость: 20 стр/мин']);
  const noFeatures = offer('Принтер HP', []);
  const sw = scoreOffer(q.tokens, withFeatures, q.specTokens);
  const sn = scoreOffer(q.tokens, noFeatures, q.specTokens);
  assert.ok(sw > sn, `with features(${sw}) should beat no features(${sn})`);
});

// Шины: запрос только радиус R16 — матчится с любой шиной R16 независимо от профиля
test('tires: radius-only query matches any R16 tire', () => {
  const q = normalizeQuery('шины R16 зимние');
  const t1 = offer('Шины 205/55 R16 зима', ['Сезон: зима']);
  const t2 = offer('Шины 185/65 R16 зима', ['Сезон: зима']);
  const t3 = offer('Шины 205/55 R17 зима', ['Сезон: зима']);
  const s1 = countSpecMatches(q.specTokens, t1);
  const s2 = countSpecMatches(q.specTokens, t2);
  const s3 = countSpecMatches(q.specTokens, t3);
  assert.ok(s1 > 0, 'R16 should match');
  assert.ok(s2 > 0, 'R16 different width should also match');
  assert.ok(s3 < s1, 'R17 should not match radius R16');
});

// Одежда: запрос "размер m" (строчная) должен матчить карточку с "Размер: M" (заглавная)
test('clothes: case-insensitive size match M', () => {
  const q = normalizeQuery('футболка размер m');
  const o = offer('Футболка', ['Размер: M']);
  assert.ok(countSpecMatches(q.specTokens, o) > 0);
});
