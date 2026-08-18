import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const source = await fs.readFile(path.join(projectRoot, 'portfolio-enhancements.js'), 'utf8');
const start = source.indexOf('  function excelTemplateXmlEscape');
const end = source.indexOf('  function xlsxUint16', start);

if (start < 0 || end < 0) throw new Error('Excel 양식 생성 함수 범위를 찾지 못했습니다.');

const generatorSource = source.slice(start, end);
const { buildExcelUploadTemplate } = new Function(`${generatorSource}\nreturn { buildExcelUploadTemplate };`)();

function uint16(view, offset) {
  return view.getUint16(offset, true);
}

function uint32(view, offset) {
  return view.getUint32(offset, true);
}

function readStoredZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (uint32(view, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('ZIP 종료 레코드가 없습니다.');
  const count = uint16(view, endOffset + 10);
  let centralOffset = uint32(view, endOffset + 16);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (uint32(view, centralOffset) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리가 손상되었습니다.');
    const compressedSize = uint32(view, centralOffset + 20);
    const nameLength = uint16(view, centralOffset + 28);
    const extraLength = uint16(view, centralOffset + 30);
    const commentLength = uint16(view, centralOffset + 32);
    const localOffset = uint32(view, centralOffset + 42);
    const name = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
    if (uint16(view, centralOffset + 10) !== 0) throw new Error(`${name}: 테스트 양식은 무압축 ZIP이어야 합니다.`);
    const localNameLength = uint16(view, localOffset + 26);
    const localExtraLength = uint16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, decoder.decode(bytes.slice(dataStart, dataStart + compressedSize)));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function expect(value, message) {
  if (!value) throw new Error(message);
}

const outputDir = path.join(projectRoot, 'outputs', 'excel-upload-template-verification');
await fs.mkdir(outputDir, { recursive: true });

const cases = [
  {
    kind: 'transactions',
    filename: 'a-money-거래내역-업로드-양식.xlsx',
    sheetName: '거래내역',
    headers: ['일자', '계좌', '종목', '구분', '수량', '단가', '거래통화', '환율', '금액(원)', '수수료(원)', '세금(원)', '배당기준일', '배당락일', '실제지급일', '비고'],
    validation: '매수,매도',
    formula: 'ROUND(ABS(E2*F2*IF(H2=&quot;&quot;,1,H2)),0)'
  },
  {
    kind: 'dividend',
    filename: 'a-money-배당금내역-업로드-양식.xlsx',
    sheetName: '배당금내역',
    headers: ['지급월', '종목', '거래통화', '적용환율', '전체 계좌 기준수량', '세후 주당 배당금', '세후 배당금(원)', '배당기준일', '배당락일', '실제지급일', '비고'],
    validation: 'KRW,USD,JPY,EUR,CNY,HKD',
    formula: 'ROUND(E2*F2*IF(D2=&quot;&quot;,1,D2),0)'
  }
];

for (const item of cases) {
  const blob = buildExcelUploadTemplate(item.kind);
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  expect(bytes[0] === 0x50 && bytes[1] === 0x4b, `${item.filename}: ZIP 시그니처 오류`);
  await fs.writeFile(path.join(outputDir, item.filename), bytes);
  const entries = readStoredZip(arrayBuffer);
  const required = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'];
  required.forEach(name => expect(entries.has(name), `${item.filename}: ${name} 누락`));
  expect(entries.get('xl/workbook.xml').includes(`name="${item.sheetName}"`), `${item.filename}: 입력 시트명 오류`);
  expect(entries.get('xl/workbook.xml').includes('name="작성안내"'), `${item.filename}: 작성안내 시트 누락`);
  const dataSheet = entries.get('xl/worksheets/sheet1.xml');
  item.headers.forEach(header => expect(dataSheet.includes(`>${header}</t>`), `${item.filename}: '${header}' 헤더 누락`));
  expect(dataSheet.includes(item.validation), `${item.filename}: 목록 입력 규칙 누락`);
  expect(dataSheet.includes(item.formula), `${item.filename}: 자동 계산식 오류`);
  expect(dataSheet.includes('state="frozen"'), `${item.filename}: 고정 헤더 누락`);
  expect(dataSheet.includes('<autoFilter '), `${item.filename}: 자동 필터 누락`);
  expect(entries.get('xl/worksheets/sheet2.xml').includes('입력 시트의 헤더명은 변경하지 마세요.'), `${item.filename}: 안내문 누락`);
  console.log(`OK ${item.filename} (${bytes.length.toLocaleString()} bytes)`);
}

