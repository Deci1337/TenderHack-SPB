// Maps a normalized query to a relevant 4th marketplace source.
// Priority: keyword match → category match → default ('oldi').

const KEYWORD_SOURCE = [
  // Одежда и обувь → Lamoda
  { pattern: /\b(платье|юбка|брюки|джинсы|пальто|куртка|пуховик|свитер|блузка|рубашка|футболка|кроссовки|туфли|сапоги|ботинки|кеды|кроссовки|одежда|обувь)\b/i, source: 'lamoda' },
  // Шины / диски / авто → Exist
  { pattern: /\b(шина|шины|покрышка|диск|диски|колесо|колёса|автозапчасти|запчасти|автомасло|масло\s+моторное)\b/i, source: 'exist' },
  // Бытовая / оргтехника, электроника → DNS
  { pattern: /\b(ноутбук|компьютер|планшет|принтер|мфу|монитор|телевизор|проектор|наушники|колонка|смартфон|телефон|iphone|samsung|xiaomi|процессор|видеокарта|материнская|жёсткий\s+диск|ssd|ram|оперативная|клавиатура|мышь|роутер|wi-fi|wifi|usb|кофемашина|кофеварка|пылесос|холодильник|стиральная|посудомоечная|духовка|микроволновка|блендер|мультиварка|чайник|утюг|фен)\b/i, source: 'dns' },
  // Спорт → Decathlon (HTTP-парсинг)
  { pattern: /\b(велосипед|лыжи|скейт|ролики|палатка|рюкзак|спальник|гантели|штанга|коврик|фитнес|тренажер)\b/i, source: 'decathlon' },
  // Детские товары → Детский мир
  { pattern: /\b(игрушка|игрушки|коляска|кроватка|детское|памперс|подгузник|конструктор|кукла|пазл)\b/i, source: 'detmir' },
  // Стройматериалы → Леруа Мерлен / ОБИ (Leroy используем как oldi – оба HTTP)
  { pattern: /\b(ламинат|паркет|плитка|краска|грунт|шпатлёвка|цемент|кирпич|утеплитель|обои|сантехника|смеситель|труба|кабель|розетка|выключатель|дрель|шуруповёрт|перфоратор)\b/i, source: 'leroy' },
];

// Sources that we have working parsers for; rest fall back to 'oldi'.
const IMPLEMENTED = new Set(['dns', 'oldi']);

/**
 * Returns the best 4th-source name for the given normalizedQuery.
 * Falls back to 'oldi' if nothing matched or source is not yet implemented.
 */
export function routeFourthSource(normalizedQuery) {
  const text = normalizedQuery.original + ' ' + normalizedQuery.normalized;
  for (const { pattern, source } of KEYWORD_SOURCE) {
    if (pattern.test(text)) {
      return IMPLEMENTED.has(source) ? source : 'oldi';
    }
  }
  return 'oldi';
}
