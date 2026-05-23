import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const standardFontDataUrl = pathToFileURL(
  `${path.resolve(moduleDir, '../../node_modules/pdfjs-dist/standard_fonts/')}${path.sep}`
).href;

function compact(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLines(text = '') {
  return String(text)
    .split(/\n+/)
    .map((line) => compact(line))
    .filter(Boolean);
}

function moneyToNumber(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMoneyAmounts(text = '') {
  return [...String(text).matchAll(/(\d{1,3}(?:\s\d{3})+[.,]\d{2})/g)]
    .map((match) => moneyToNumber(match[1]))
    .filter((value) => value !== null);
}

function extractPercent(text = '') {
  const match = String(text).match(/([0-9]+(?:[.,][0-9]+)?)\s*%/);
  if (!match) return null;
  const parsed = Number(match[1].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function detectDocumentType(fullText = '') {
  const text = compact(fullText);
  if (/РЕЕСТР ТОВАРОВ/i.test(text)) {
    return 'product_registry';
  }
  if (/ОБОСНОВАНИЕ/i.test(text) && /НМЦК/i.test(text)) {
    return 'nmck_justification';
  }
  return 'generic_pdf';
}

function findLineIndex(lines, marker) {
  return lines.findIndex((line) => compact(line).includes(marker));
}

function sliceLinesBetween(lines, startMarker, endMarker) {
  const start = findLineIndex(lines, startMarker);
  if (start < 0) return [];

  const end = endMarker
    ? lines.findIndex((line, index) => index > start && compact(line).includes(endMarker))
    : -1;

  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function sliceTextBetween(text, startMarker, endMarker) {
  const rawText = String(text);
  const rawStart = rawText.indexOf(startMarker);
  if (rawStart < 0) return '';

  const rawEnd = endMarker ? rawText.indexOf(endMarker, rawStart + startMarker.length) : -1;

  return rawText.slice(rawStart + startMarker.length, rawEnd < 0 ? rawText.length : rawEnd);
}

function parseNumberedRows(lines) {
  const rows = [];
  let current = null;
  let pending = [];

  for (const rawLine of lines) {
    const line = compact(rawLine);
    if (!line) continue;

    const match = line.match(/^(\d+)\s+(.*)$/);
    if (match) {
      if (current) rows.push(current);
      current = {
        index: Number(match[1]),
        lines: [...pending, match[2]],
      };
      pending = [];
      continue;
    }

    if (/^(?:https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}(?:\/\S+)?)$/i.test(line)) {
      if (current) {
        current.lines.push(line);
      } else {
        pending.push(line);
      }
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else {
      pending.push(line);
    }
  }

  if (current) rows.push(current);

  return rows.map((row) => ({
    index: row.index,
    text: compact(row.lines.join(' ')),
  }));
}

function parseTableRow(rowText) {
  const normalized = compact(rowText?.text ?? rowText).replace(/^\d+\s+/, '').trim();
  const priceMatches = [...normalized.matchAll(/(\d{1,3}(?:\s\d{3})+,\d{2})/g)];
  const lastPriceMatch = priceMatches[priceMatches.length - 1];
  const price = lastPriceMatch ? moneyToNumber(lastPriceMatch[1]) : null;

  let prefix = lastPriceMatch ? normalized.slice(0, lastPriceMatch.index).trim() : normalized;
  const linkMatch = normalized.match(/(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}(?:\/\S+)?)/i);
  const link = linkMatch?.[1] ?? '';
  if (linkMatch) {
    prefix = prefix.replace(linkMatch[1], '').trim();
  }

  const requisitesMatch = prefix.match(/\b(Исх\.?№?|Скриншот|Дата заключения)\b/i);
  const source = requisitesMatch ? prefix.slice(0, requisitesMatch.index).trim() : prefix;
  const requisites = requisitesMatch ? prefix.slice(requisitesMatch.index).trim() : '';

  return {
    source,
    requisites,
    price,
    price_text: lastPriceMatch?.[1] ?? null,
    link,
    raw_text: normalized,
  };
}

function extractPageLines(pageItems) {
  const grouped = new Map();

  for (const item of pageItems) {
    const text = compact(item.str);
    if (!text) continue;

    const y = Math.round(item.transform[5] * 10) / 10;
    const x = Math.round(item.transform[4] * 10) / 10;

    if (!grouped.has(y)) {
      grouped.set(y, []);
    }
    grouped.get(y).push({ x, text });
  }

  return [...grouped.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) => items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
    .map((line) => compact(line))
    .filter(Boolean);
}

async function readPdfPages(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await pdfjsLib.getDocument({
    data,
    disableWorker: true,
    standardFontDataUrl,
  }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = extractPageLines(content.items);
    pages.push({
      page_number: pageNumber,
      lines,
      text: lines.join('\n'),
    });
  }

  return {
    page_count: pdf.numPages,
    pages,
  };
}

function parseRegistryPosition(blockText) {
  const lines = splitLines(blockText);
  const titleLine = lines.find((line) => /^Позиция\s+\d+\./i.test(line)) ?? '';
  const positionNumber = Number(titleLine.match(/^Позиция\s+(\d+)\./i)?.[1] ?? 0);
  const title = compact(titleLine.replace(/^Позиция\s+\d+\.\s*/i, ''));

  const summaryCutCandidates = [
    blockText.indexOf('Технические характеристики:'),
    blockText.indexOf('Источники ценовой информации:'),
    blockText.indexOf('Принятая цена за ед.:'),
  ].filter((value) => value >= 0);
  const summaryCut = summaryCutCandidates.length > 0 ? Math.min(...summaryCutCandidates) : blockText.length;
  const summaryText = compact(blockText.slice(0, summaryCut));
  const okpd2 = compact(summaryText.match(/ОКПД2:\s*([0-9.]+)/i)?.[1] ?? '');
  const ktruLine = lines.find((line) => /^\d{2}\.\d{2}\.\d{2}\.\d+-\d+$/i.test(line));
  const ktru = compact(ktruLine ?? summaryText.match(/КТРУ:\s*([0-9.\-]+)/i)?.[1] ?? '');
  const summaryMoney = extractMoneyAmounts(summaryText);
  const quantityMatch = summaryText.match(/(\d+(?:[.,]\d+)?)\s*(шт\.?|комп\.?)/i);
  const vatPercent = Number((blockText.match(/с НДС\s*([0-9.,]+)\s*%/i)?.[1] ?? '').replace(',', '.')) || null;

  const technicalCharacteristics = sliceLinesBetween(lines, 'Технические характеристики:', 'Источники ценовой информации:');
  const sourceRows = parseNumberedRows(sliceLinesBetween(lines, 'Источники ценовой информации:', 'Принятая цена за ед.:'))
    .map((row) => parseTableRow(row));

  const acceptedPriceText = blockText.match(/Принятая цена за ед\.:\s*([0-9\s]+,[0-9]{2})/i)?.[1] ?? null;
  const acceptedPrice = moneyToNumber(acceptedPriceText);
  const averageSourcePriceText = blockText.match(/Среднее по источникам —\s*([0-9\s]+,[0-9]{2})/i)?.[1] ?? null;
  const averageSourcePrice = moneyToNumber(averageSourcePriceText);
  const deviationPercent = Number((blockText.match(/Отклонение[^%]*([0-9]+(?:[.,][0-9]+)?)\s*%/i)?.[1] ?? '').replace(',', '.')) || null;

  return {
    position_number: positionNumber || null,
    title,
    okpd2: okpd2 || null,
    ktru: ktru || null,
    quantity: quantityMatch
      ? {
          value: Number(quantityMatch[1].replace(',', '.')),
          unit: quantityMatch[2].replace(/\.$/, ''),
        }
      : null,
    price_per_unit: summaryMoney[0] ?? null,
    total_price: summaryMoney[1] ?? null,
    vat_percent: vatPercent,
    technical_characteristics_text: technicalCharacteristics.join('\n'),
    source_rows: sourceRows,
    accepted_price: acceptedPrice,
    average_source_price: averageSourcePrice,
    deviation_percent: deviationPercent,
    raw_text: compact(blockText),
  };
}

function parseRegistryDocument(pages, fullText) {
  const lines = splitLines(fullText);
  const positionIndices = lines
    .map((line, index) => (/^Позиция\s+\d+\./i.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const blocks = positionIndices.map((startIndex, blockIndex) => {
    const start = Math.max(0, startIndex - 1);
    const end = positionIndices[blockIndex + 1] ?? lines.length;
    return lines.slice(start, end).join('\n');
  });

  return {
    positions: blocks.map(parseRegistryPosition),
    summary: {
      position_count: blocks.length,
    },
  };
}

function parseNmckSources(fullText) {
  const lines = splitLines(fullText);
  const sourceLines = sliceLinesBetween(lines, '3. ИСТОЧНИКИ ЦЕНОВОЙ ИНФОРМАЦИИ', '4. РАСЧЁТ НМЦК');
  return parseNumberedRows(sourceLines).map((row) => parseTableRow(row));
}

function parseNmckCalculation(fullText) {
  const section = compact(sliceTextBetween(fullText, '4. РАСЧЁТ НМЦК', '5. НОРМАТИВНЫЕ ОСНОВАНИЯ И ПРИМЕЧАНИЯ'));

  const sourcePriceRows = [...section.matchAll(/Цена №\s*(\d+)\s*\((.*?)\)\s*([0-9\s]+,[0-9]{2})\s*руб\./gi)].map((match) => ({
    index: Number(match[1]),
    label: compact(match[2]),
    price: moneyToNumber(match[3]),
    raw_text: compact(match[0]),
  }));

  return {
    source_prices: sourcePriceRows,
    average_price: moneyToNumber(section.match(/Среднеарифметическое значение \(НМЦК\)\s*([0-9\s]+,[0-9]{2})/i)?.[1] ?? null),
    variation_percent: Number((section.match(/Коэффициент вариации \(V\)\s*([0-9.,]+)\s*%/i)?.[1] ?? '').replace(',', '.')) || null,
    total_price: moneyToNumber(section.match(/НМЦК \(с НДС 20%\), итого\s*([0-9\s]+,[0-9]{2})/i)?.[1] ?? null),
    vat_amount: moneyToNumber(section.match(/НДС 20 % —\s*([0-9\s]+(?:,\d{2})?)/i)?.[1] ?? null),
    raw_text: section,
  };
}

function parseNmckDocument(pages, fullText) {
  const text = compact(fullText);
  const lines = splitLines(fullText);
  const objectLine = lines.find((line) => line.startsWith('Наименование объекта'));
  const ikzLine = lines.find((line) => line.startsWith('Идентификационный код'));
  const methodLine = lines.find((line) => line.startsWith('Способ определения'));
  const fundingLine = lines.find((line) => line.startsWith('Источник'));
  const dateLine = lines.find((line) => line.startsWith('Дата составления'));
  return {
    customer: {
      name: compact(text.match(/Наименование[\s\S]*?заказчика:\s*([\s\S]*?)\nИНН \/ КПП заказчика:/i)?.[1] ?? ''),
      inn_kpp: compact(text.match(/ИНН \/ КПП заказчика:\s*([0-9\s/]+)/i)?.[1] ?? ''),
    },
    procurement: {
      object_name: compact(
        objectLine?.replace(/^Наименование объекта\s*/i, '')
          ?? text.match(/Наименование\s+объекта\s+закупки:\s*([\s\S]*?)\nИдентификационный код закупки/i)?.[1]
          ?? text.match(/Наименование[\s\S]*?объекта\s*([\s\S]*?)\nзакупки:\s*([\s\S]*?)\nИдентификационный код закупки/i)?.[1]
          ?? ''
      ),
      ikz: compact(
        ikzLine?.replace(/^Идентификационный код\s*/i, '')
          ?? text.match(/Идентификационный код закупки(?: \(ИКЗ\))?:\s*([0-9]+)/i)?.[1]
          ?? ''
      ),
      method: compact(
        methodLine?.replace(/^Способ определения\s*/i, '')
          ?? text.match(/Способ\s+определения\s+поставщика:\s*([\s\S]*?)\nИсточник финансирования:/i)?.[1]
          ?? ''
      ),
      funding_source: compact(
        fundingLine?.replace(/^Источник\s*/i, '')
          ?? text.match(/Источник\s+финансирования:\s*([\s\S]*?)\nДата составления обоснования:/i)?.[1]
          ?? ''
      ),
      date: compact(
        dateLine?.replace(/^Дата составления\s*/i, '')
          ?? text.match(/Дата\s+составления\s+обоснования:\s*([^\n]+)/i)?.[1]
          ?? ''
      ),
    },
    source_prices: parseNmckSources(fullText),
    calculation: parseNmckCalculation(fullText),
    normative_basis: sliceLinesBetween(splitLines(fullText), '5. НОРМАТИВНЫЕ ОСНОВАНИЯ И ПРИМЕЧАНИЯ', 'Контрактный')
      .map((line) => line.replace(/^•\s*/, ''))
      .filter(Boolean),
  };
}

function parseGenericDocument() {
  return {};
}

export function parseProcurementPdfText({
  filePath,
  pages,
}) {
  const normalizedPages = pages.map((page, index) => ({
    page_number: page.page_number ?? index + 1,
    lines: page.lines ?? splitLines(page.text ?? ''),
    text: compact(page.text ?? (page.lines ?? []).join('\n')),
  }));
  const fullText = normalizedPages.map((page) => page.text).join('\n');
  const documentType = detectDocumentType(fullText);

  const parsed = documentType === 'product_registry'
    ? parseRegistryDocument(normalizedPages, fullText)
    : documentType === 'nmck_justification'
      ? parseNmckDocument(normalizedPages, fullText)
      : parseGenericDocument(normalizedPages, fullText);

  return {
    file_path: filePath,
    file_name: filePath ? path.basename(filePath) : null,
    document_type: documentType,
    title: compact(normalizedPages[0]?.lines?.[0] ?? path.basename(filePath ?? 'document.pdf')),
    page_count: normalizedPages.length,
    extracted_at: new Date().toISOString(),
    pages: normalizedPages,
    parsed,
    full_text: fullText,
  };
}

export async function parseProcurementPdfFile(filePath) {
  const { page_count, pages } = await readPdfPages(filePath);
  return parseProcurementPdfText({
    filePath,
    pages: pages.slice(0, page_count),
  });
}
