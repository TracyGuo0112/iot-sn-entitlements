import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, validateSnRows, parseSnFile, MAX_FILE_SIZE, MAX_SNS } from '../dist/upload.mjs';

const csvFile = (text, name = 'sn.csv') => new File([text], name, { type: 'text/csv' });

test('CSV handles UTF-8 BOM and all record newline styles', () => {
  assert.deepEqual(parseCsv('\uFEFFSN,备注\r\n0001,甲\n0002,乙\r0003,丙'), [
    ['SN', '备注'], ['0001', '甲'], ['0002', '乙'], ['0003', '丙'],
  ]);
});

test('CSV keeps commas and escaped quotes inside quoted fields', () => {
  assert.deepEqual(parseCsv('SN,备注\n0001,"客户说""你好"",然后离开"'), [['SN', '备注'], ['0001', '客户说"你好",然后离开']]);
});

test('CSV keeps multiline quoted values in a single cell', () => {
  assert.deepEqual(parseCsv('SN,备注\r\n0001,"第一行\r\n第二行"\r\n'), [['SN', '备注'], ['0001', '第一行\r\n第二行']]);
});

test('CSV preserves trailing empty cells without inventing a final empty row', () => {
  assert.deepEqual(parseCsv('SN,\n0001,\n'), [['SN', ''], ['0001', '']]);
  assert.deepEqual(parseCsv('SN,\n0001,'), [['SN', ''], ['0001', '']]);
});

test('CSV preserves actual blank records and rejects non-text input', () => {
  assert.deepEqual(parseCsv('SN\n\n0001\n\n'), [['SN'], [''], ['0001'], ['']]);
  assert.deepEqual(parseCsv(''), []);
  assert.throws(() => parseCsv(null), /必须为文本/u);
});

test('CSV rejects unterminated quotes and invalid quote placement', () => {
  assert.throws(() => parseCsv('SN\n"0001'), /未闭合/u);
  assert.throws(() => parseCsv('SN\n00"01'), /引号位置/u);
  assert.throws(() => parseCsv('SN\n"0001"oops'), /多余内容/u);
});

test('CSV permits whitespace following a quoted cell', () => {
  assert.deepEqual(parseCsv('"SN" ,"备注"\n"0001"\t,ok'), [['SN', '备注'], ['0001', 'ok']]);
});

test('supported SN headers are exact after case normalization and trimming', () => {
  for (const header of ['SN', ' sn ', 'SN设备号', ' 设备sN ']) {
    assert.deepEqual(validateSnRows([[header], ['0001']]).sns, ['0001']);
  }
  for (const header of ['设备编号', 'SN备注', 'SN device', 's n']) {
    assert.throws(() => validateSnRows([[header], ['0001']]), /未找到 SN 列/u);
  }
});

test('the first nonempty row is the header and explanation columns never become SNs', () => {
  const result = validateSnRows([[], ['', ''], ['SN', '', '', '使用说明'], ['0001', '', '', '每一行一个 SN'], ['', '', '', '支持批量查询']]);
  assert.deepEqual(result, { sns: ['0001'], totalRows: 2, duplicateCount: 0, emptyCount: 1, invalidRows: [] });
  assert.throws(() => validateSnRows([['这里是说明'], ['SN'], ['0001']]), /未找到 SN 列/u);
});

test('SN column is selected by header rather than by position', () => {
  const result = validateSnRows([['序号', '说明', '设备SN', '其他'], ['001', 'NOT_A_SN', '00000123', 'ALSO_NOT_A_SN']]);
  assert.deepEqual(result.sns, ['00000123']);
});

test('ambiguous duplicate SN headers are rejected', () => {
  assert.throws(() => validateSnRows([['SN', '设备SN'], ['one', 'two']]), /多个 SN 列/u);
});

test('empty files and files without the required header are rejected', () => {
  assert.throws(() => validateSnRows([]), /文件为空/u);
  assert.throws(() => validateSnRows([[], [' ']]), /文件为空/u);
  assert.throws(() => validateSnRows([['设备', '备注'], ['0001']]), /未找到 SN 列/u);
});

test('a header-only file has a complete empty result for the UI', () => {
  assert.deepEqual(validateSnRows([['SN']]), { sns: [], totalRows: 0, duplicateCount: 0, emptyCount: 0, invalidRows: [] });
});

test('SN deduplication ignores case while keeping the first spelling and leading zeros', () => {
  const result = validateSnRows([['SN'], ['0000123'], ['AbC-01'], ['abc-01'], ['ABC-01'], ['000123']]);
  assert.deepEqual(result.sns, ['0000123', 'AbC-01', '000123']);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.totalRows, 5);
});

test('empty SN cells are counted even when an explanation is present', () => {
  const result = validateSnRows([['SN', '备注'], [], ['', '说明'], ['\t '], ['0001']]);
  assert.equal(result.emptyCount, 3);
  assert.equal(result.totalRows, 4);
  assert.deepEqual(result.sns, ['0001']);
});

test('invalid SN rows are reported with their row numbers and never silently dropped', () => {
  const result = validateSnRows([['SN'], ['中文设备'], ['has space'], ['tab\tinside'], [' leading'], ['trailing '], ['a/b'], ['a'.repeat(65)], ['OK-01']]);
  assert.deepEqual(result.invalidRows.map((item) => item.row), [2, 3, 4, 5, 6, 7, 8]);
  assert.ok(result.invalidRows.every((item) => item.reason.includes('1–64')));
  assert.deepEqual(result.sns, ['OK-01']);
  assert.equal(result.totalRows, 8);
});

test('valid SN syntax includes numeric strings, punctuation, and the maximum length', () => {
  const values = ['0', '0000001', 'a_B-c.D:01', '-001', 'a'.repeat(64)];
  assert.deepEqual(validateSnRows([['SN'], ...values.map((value) => [value])]).sns, values);
});

test('spreadsheet formula rows reject cached values and empty results', () => {
  const result = validateSnRows([['SN'], ['CACHED-01'], [''], ['SAFE-01']], new Set([2, 3]));
  assert.deepEqual(result.sns, ['SAFE-01']);
  assert.deepEqual(result.invalidRows.map((item) => item.row), [2, 3]);
  assert.equal(result.emptyCount, 0);
  assert.ok(result.invalidRows.every((item) => item.reason.includes('公式')));
  assert.throws(() => validateSnRows([['SN']], new Set([1])), /表头不能使用公式/u);
});

test('formula-like CSV strings are rejected instead of used as SNs', () => {
  const result = validateSnRows([['SN'], ['=A1'], ['+SUM(A1)'], ['@value'], ['VALID']]);
  assert.deepEqual(result.invalidRows.map((item) => item.row), [2, 3, 4]);
  assert.deepEqual(result.sns, ['VALID']);
});

test('query limit accepts 100 unique SNs and rejects 101 without truncation', () => {
  assert.equal(MAX_SNS, 100);
  const rows = [['SN'], ...Array.from({ length: MAX_SNS }, (_, index) => [`SN-${index}`])];
  assert.equal(validateSnRows(rows).sns.length, 100);
  assert.throws(() => validateSnRows([...rows, ['SN-100']]), /最多查询 100.*当前有 101/u);
  assert.equal(validateSnRows([...rows, ['sn-0']]).duplicateCount, 1);
});

test('sparse worksheet rows preserve their physical row numbers and empty counts', () => {
  const rows = [];
  rows[2] = ['SN']; rows[5] = ['BAD SN']; rows[6] = ['0001'];
  const result = validateSnRows(rows);
  assert.equal(result.totalRows, 4);
  assert.equal(result.emptyCount, 2);
  assert.deepEqual(result.invalidRows.map((item) => item.row), [6]);
});

test('browser file parser reads UTF-8 CSV and UTF-8 BOM without losing leading zeros', async () => {
  const result = await parseSnFile(csvFile('\uFEFFSN,备注\r\n000001,说明\r\nAbC-02,说明\r\nabc-02,重复\r\n', 'CUSTOMER.CSV'));
  assert.deepEqual(result.sns, ['000001', 'AbC-02']);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.totalRows, 3);
});

test('browser file parser rejects unsupported file extensions including legacy xls', async () => {
  for (const name of ['sn.xls', 'sn.txt', 'sn.csv.exe', 'sn']) {
    await assert.rejects(parseSnFile(csvFile('SN\n0001', name)), /仅支持 .xlsx.*不支持 .xls/u);
  }
  await assert.rejects(parseSnFile(null), /请选择/u);
});

test('browser file parser enforces the 2 MB limit before reading and after reading', async () => {
  assert.equal(MAX_FILE_SIZE, 2097152);
  let read = false;
  await assert.rejects(parseSnFile({ name: 'sn.csv', size: MAX_FILE_SIZE + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } }), /不能超过 2 MB/u);
  assert.equal(read, false);
  await assert.rejects(parseSnFile({ name: 'sn.csv', size: 1, arrayBuffer: async () => new ArrayBuffer(MAX_FILE_SIZE + 1) }), /不能超过 2 MB/u);
});

test('invalid UTF-8 CSV yields an actionable encoding message', async () => {
  await assert.rejects(parseSnFile(csvFile(new Uint8Array([0x53, 0x4e, 0x0a, 0xff, 0xfe]))), /不是有效的 UTF-8.*另存为 UTF-8 CSV/u);
});
