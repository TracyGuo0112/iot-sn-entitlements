import { unzipSync } from './vendor/fflate.mjs';

export const MAX_FILE_SIZE = 2 * 1024 * 1024;
export const MAX_SNS = 100;
const MAX_UNZIPPED_SIZE = 8 * 1024 * 1024;

const SN_HEADERS = new Set(['sn', 'sn设备号', '设备sn']);
const isSnHeader = (value) => SN_HEADERS.has(String(value ?? '').trim().toLowerCase());
const firstContentRow = (rows) => rows.findIndex((row) => row?.some((value) => String(value ?? '').trim() !== ''));

export const parseCsv = (text) => {
  if (typeof text !== 'string') throw new Error('CSV 内容必须为文本。');
  const source = text.replace(/^\uFEFF/u, '');
  if (!source) return [];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  let physicalRow = 1;
  let endedWithNewline = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    endedWithNewline = false;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; closedQuote = true; }
      } else {
        cell += char;
        if (char === '\n' || (char === '\r' && source[index + 1] !== '\n')) physicalRow += 1;
      }
      continue;
    }
    if (char === '"') {
      if (cell || closedQuote) throw new Error(`CSV 格式错误：第 ${physicalRow} 行的引号位置不正确。`);
      quoted = true;
    } else if (char === ',') {
      row.push(cell); cell = ''; closedQuote = false;
    } else if (char === '\r' || char === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; closedQuote = false;
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      physicalRow += 1;
      endedWithNewline = true;
    } else if (closedQuote) {
      if (char !== ' ' && char !== '\t') throw new Error(`CSV 格式错误：第 ${physicalRow} 行的引号后存在多余内容。`);
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 格式错误：存在未闭合的引号。');
  if (!endedWithNewline) { row.push(cell); rows.push(row); }
  return rows;
};

export const validateSnRows = (rows, formulaRows = new Set()) => {
  const headerIndex = firstContentRow(rows);
  if (headerIndex === -1) throw new Error('文件为空，请使用包含 SN 列的查询模板。');
  const snColumns = rows[headerIndex].flatMap((value, index) => isSnHeader(value) ? [index] : []);
  if (snColumns.length === 0) throw new Error('未找到 SN 列，表头须为 SN、SN设备号或设备SN。');
  if (snColumns.length > 1) throw new Error('文件包含多个 SN 列，请只保留一个 SN 列。');
  if (formulaRows.has(headerIndex + 1)) throw new Error('SN 表头不能使用公式，请改为文本。');
  const snColumn = snColumns[0];
  const seen = new Set();
  const sns = [];
  const invalidRows = [];
  let emptyCount = 0;
  let duplicateCount = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const number = index + 1;
    const raw = String(rows[index]?.[snColumn] ?? '');
    const sn = raw.trim();
    if (formulaRows.has(number) || /^[=+@]/u.test(sn)) {
      // Spreadsheet formulas must never be mistaken for their cached values.
      invalidRows.push({ row: number, reason: '不支持公式单元格，请将 SN 粘贴为文本值。' });
      continue;
    }
    if (!sn) { emptyCount += 1; continue; }
    if (raw !== sn || !/^[A-Za-z0-9_.:-]{1,64}$/u.test(sn)) {
      invalidRows.push({ row: number, reason: 'SN 须为 1–64 位英文字母、数字、下划线、短横线、点或冒号，不能含空白或中文。' });
      continue;
    }
    const key = sn.toLowerCase();
    if (seen.has(key)) { duplicateCount += 1; continue; }
    seen.add(key); sns.push(sn);
  }
  if (sns.length > MAX_SNS) throw new Error(`单次最多查询 ${MAX_SNS} 个不同 SN，当前有 ${sns.length} 个，请拆分文件后重试。`);
  return { sns, totalRows: rows.length - headerIndex - 1, duplicateCount, emptyCount, invalidRows };
};

export const parseSnFile = async (file) => {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择需要查询的文件。');
  const extension = String(file.name ?? '').toLowerCase().split('.').at(-1);
  if (!['xlsx', 'csv'].includes(extension)) throw new Error('仅支持 .xlsx 或 UTF-8 编码 .csv 文件，不支持 .xls。');
  if (file.size > MAX_FILE_SIZE) throw new Error('文件不能超过 2 MB，请拆分文件后重试。');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_FILE_SIZE) throw new Error('文件不能超过 2 MB，请拆分文件后重试。');
  if (extension === 'xlsx') return parseXlsx(buffer);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('CSV 文件不是有效的 UTF-8 编码，请另存为 UTF-8 CSV 后重试。'); }
  return validateSnRows(parseCsv(text));
};

const elements = (node, localName) => [...node.getElementsByTagNameNS('*', localName)];
const child = (node, localName) => [...node.children].find((element) => element.localName === localName);
const cellText = (node) => elements(node, 't').map((element) => element.textContent).join('');

const readXml = (bytes) => {
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Excel 内部数据编码异常，请另存为 .xlsx 后重试。'); }
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) throw new Error('Excel 包含不支持的 XML 内容，请使用查询模板。');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (elements(doc, 'parsererror').length) throw new Error('Excel 内部数据格式错误，请另存为 .xlsx 后重试。');
  return doc;
};

const normalizePath = (directory, target) => {
  const segments = (target.startsWith('/') ? target.slice(1) : `${directory}/${target}`).split('/');
  return segments.reduce((path, segment) => {
    if (segment === '..') path.pop();
    else if (segment && segment !== '.') path.push(segment);
    return path;
  }, []).join('/');
};

const numericFormats = (archive) => {
  if (!archive['xl/styles.xml']) return [];
  const doc = readXml(archive['xl/styles.xml']);
  const formats = new Map(elements(doc, 'numFmt').map((element) => [element.getAttribute('numFmtId'), element.getAttribute('formatCode')]));
  const cellXfs = elements(doc, 'cellXfs')[0];
  return cellXfs ? [...cellXfs.children].map((element) => formats.get(element.getAttribute('numFmtId')) ?? '') : [];
};

const sheetRows = (bytes, sharedStrings, formats) => {
  const doc = readXml(bytes);
  const rows = [];
  const formulaRows = new Set();
  let nextRow = 1;
  for (const rowElement of elements(doc, 'row')) {
    const rowNumber = Number(rowElement.getAttribute('r') || nextRow);
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1048576) throw new Error('Excel 行号异常，请使用查询模板重新整理。');
    nextRow = rowNumber + 1;
    const row = [];
    let nextColumn = 0;
    for (const cell of elements(rowElement, 'c')) {
      const reference = cell.getAttribute('r');
      const letters = reference?.match(/^[A-Z]+/iu)?.[0];
      const column = letters ? [...letters.toUpperCase()].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1 : nextColumn;
      if (column > 16383) throw new Error('Excel 列号异常，请使用查询模板重新整理。');
      nextColumn = column + 1;
      if (child(cell, 'f')) formulaRows.add(rowNumber);
      const type = cell.getAttribute('t');
      const value = child(cell, 'v')?.textContent ?? '';
      let text = value;
      if (type === 's') {
        const stringIndex = Number(value);
        if (!/^[0-9]+$/u.test(value) || !Number.isInteger(stringIndex) || stringIndex >= sharedStrings.length) throw new Error('Excel 文本索引异常，请另存为 .xlsx 后重试。');
        text = sharedStrings[stringIndex];
      } else if (type === 'inlineStr') text = cellText(child(cell, 'is') ?? cell);
      else if ((!type || type === 'n') && /^[0-9]+$/u.test(value)) {
        const format = formats[Number(cell.getAttribute('s') || 0)];
        // A zero mask is part of the visible identifier, not a numeric conversion.
        if (format && /^0{1,64}$/u.test(format)) text = value.padStart(format.length, '0');
      }
      row[column] = text;
    }
    rows[rowNumber - 1] = row;
  }
  return { rows, formulaRows };
};

const parseXlsx = (buffer) => {
  if (typeof DOMParser === 'undefined') throw new Error('Excel 文件需要在浏览器中读取。');
  const bytes = new Uint8Array(buffer);
  let archive;
  try {
    let unzippedSize = 0;
    // Inspect every declared size before allocating any inflated entry.
    unzipSync(bytes, { filter: (entry) => {
      unzippedSize += entry.originalSize;
      if (!Number.isSafeInteger(unzippedSize) || unzippedSize > MAX_UNZIPPED_SIZE) throw new Error('EXCEEDS_UNZIPPED_LIMIT');
      return false;
    } });
    archive = unzipSync(bytes, { filter: (entry) => /\.xml(?:\.rels)?$/iu.test(entry.name) || /\.rels$/iu.test(entry.name) });
  } catch (error) {
    if (error.message === 'EXCEEDS_UNZIPPED_LIMIT') throw new Error('Excel 解压后的内容不能超过 8 MB，请使用精简的查询模板。');
    throw new Error('无法读取 Excel 文件，文件可能损坏、加密或并非真正的 .xlsx 格式。');
  }
  const workbook = archive['xl/workbook.xml'];
  const relationships = archive['xl/_rels/workbook.xml.rels'];
  if (!workbook || !relationships) throw new Error('Excel 缺少工作簿信息，请使用查询模板或另存为 .xlsx。');
  const relations = new Map(elements(readXml(relationships), 'Relationship').map((element) => [element.getAttribute('Id'), element]));
  const sharedStrings = archive['xl/sharedStrings.xml'] ? elements(readXml(archive['xl/sharedStrings.xml']), 'si').map(cellText) : [];
  const formats = numericFormats(archive);
  for (const sheet of elements(readXml(workbook), 'sheet')) {
    const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
    const relation = relations.get(id);
    if (!relation || relation.getAttribute('TargetMode') === 'External') continue;
    if (!relation.getAttribute('Type')?.endsWith('/worksheet')) continue;
    const path = normalizePath('xl', relation.getAttribute('Target') ?? '');
    if (!archive[path]) throw new Error('Excel 工作表内容缺失，请另存为 .xlsx 后重试。');
    const result = sheetRows(archive[path], sharedStrings, formats);
    const headerIndex = firstContentRow(result.rows);
    if (headerIndex >= 0 && result.rows[headerIndex].some(isSnHeader)) return validateSnRows(result.rows, result.formulaRows);
  }
  throw new Error('Excel 中未找到包含 SN 列的工作表，表头须为 SN、SN设备号或设备SN。');
};
