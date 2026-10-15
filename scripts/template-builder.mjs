import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeModules = '/Users/xmly/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const runtimePython = '/Users/xmly/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const executeFile = promisify(execFile);
const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sn-query-template-'));
const runtimeLink = path.join(runtimeDirectory, 'node_modules');
await fs.symlink(runtimeModules, runtimeLink, 'dir');

try {
  const require = createRequire(path.join(runtimeDirectory, 'package.json'));
  const { SpreadsheetFile, Workbook } = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('SN清单');
  const content = sheet.getRange('A1:D12');
  content.format = {
    fill: '#FFFFFF',
    font: { name: 'Arial', size: 11, color: '#5F6368' },
    verticalAlignment: 'center',
    horizontalAlignment: 'left',
    rowHeight: 30,
    wrapText: false,
  };

  // Device identifiers must retain leading zeroes when customers replace the examples.
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('A1:A4').values = [
    ['SN'],
    ['XMSN202600001'],
    ['XMSN202600004'],
    ['XMSN202600005'],
  ];
  sheet.getRange('D1:D5').values = [
    ['填写说明'],
    ['用实际 SN 替换 A 列示例，每行一台设备。'],
    ['保留首行 SN 表头，单次最多 100 台。'],
    ['填写后保存为 .xlsx，上传到批量查询。'],
    ['本表仅查询，不改变设备权益。'],
  ];
  const headerStyle = {
    fill: '#E8793B',
    font: { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' },
    rowHeight: 34,
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
  };
  sheet.getRange('A1').format = headerStyle;
  sheet.getRange('D1').format = headerStyle;
  sheet.getRange('A1:A101').format.columnWidth = 26;
  sheet.getRange('B1:C12').format.columnWidth = 3;
  sheet.getRange('D1:D12').format.columnWidth = 66;
  sheet.getRange('A2:A4').format.font = { name: 'Arial', size: 11, color: '#374151' };
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.tabColor = '#E8793B';
  sheet.getRange('A1:A101').setNumberFormat('@');

  workbook.recalculate();
  const inspection = await workbook.inspect({
    kind: 'table',
    range: "'SN清单'!A1:D5",
    include: 'values,formulas',
    tableMaxRows: 5,
    tableMaxCols: 4,
    maxChars: 2600,
  });
  console.log(inspection.ndjson);
  const formulaErrors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
    options: { useRegex: true, maxResults: 20 },
    maxChars: 1000,
    summary: 'template formula error scan',
  });
  console.log(formulaErrors.ndjson);

  const preview = await workbook.render({ sheetName: 'SN清单', range: 'A1:D8', scale: 1.5, format: 'png' });
  const previewPath = path.join(projectRoot, 'artifacts', 'template-preview.png');
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

  const outputPath = path.join(projectRoot, 'dist', 'templates', 'sn-query-template.xlsx');
  const deliverablePath = path.join(projectRoot, 'outputs', '01a13eee-5116-7ca0-ae4a-0a7a8c534fc7', 'sn-query-template.xlsx');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(deliverablePath), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  // The exporter omits whole-column defaults; a native column style preserves text entry beyond existing rows.
  const columnStylePatch = `
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import sys
import xml.etree.ElementTree as ET

target = Path(sys.argv[1])
namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
namespaces = {'m': namespace}
ET.register_namespace('', namespace)
with ZipFile(target) as archive:
    entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
    worksheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    styles = ET.fromstring(archive.read('xl/styles.xml'))
cells = {cell.attrib['r']: cell for cell in worksheet.findall('m:sheetData/m:row/m:c', namespaces)}
input_style = cells['A2'].attrib['s']
cell_styles = styles.findall('m:cellXfs/m:xf', namespaces)
custom_formats = {item.attrib['numFmtId']: item.attrib['formatCode'] for item in styles.findall('m:numFmts/m:numFmt', namespaces)}
for row in range(1, 102):
    format_id = cell_styles[int(cells[f'A{row}'].attrib['s'])].attrib['numFmtId']
    assert format_id == '49' or custom_formats.get(format_id) == '@'
column = worksheet.find('m:cols/m:col[@min="1"]', namespaces)
assert column is not None and column.attrib['max'] == '1'
column.set('style', input_style)
sheet_bytes = ET.tostring(worksheet, encoding='utf-8', xml_declaration=True)
buffer = BytesIO()
with ZipFile(buffer, 'w') as patched:
    for info, content in entries:
        patched.writestr(info, sheet_bytes if info.filename == 'xl/worksheets/sheet1.xml' else content)
with ZipFile(BytesIO(buffer.getvalue())) as checked:
    assert checked.testzip() is None
target.write_bytes(buffer.getvalue())
print('Verified text format for A1:A101 and native A-column default.')
`;
  const columnCheck = await executeFile(runtimePython, ['-c', columnStylePatch, outputPath]);
  console.log(columnCheck.stdout.trim());
  await fs.unlink(`${outputPath}.inspect.ndjson`).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  await fs.copyFile(outputPath, deliverablePath);
  const bytes = await fs.readFile(outputPath);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) throw new Error('Expected an XLSX ZIP container.');
  console.log(JSON.stringify({ outputPath, deliverablePath, previewPath, size: bytes.length }));
} finally {
  await fs.unlink(runtimeLink);
  await fs.rmdir(runtimeDirectory);
}
