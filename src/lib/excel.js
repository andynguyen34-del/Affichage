import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

/** Ramene une cellule ExcelJS a une valeur JavaScript simple. */
export function normalizeCell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'object') {
    // Cellule calculee : on prend le resultat, pas la formule.
    if ('result' in value) return normalizeCell(value.result);
    if ('error' in value) return null;
    if (Array.isArray(value.richText)) {
      const text = value.richText.map((part) => part.text).join('').trim();
      return text === '' ? null : text;
    }
    if ('text' in value) return normalizeCell(value.text);
    if ('hyperlink' in value) return normalizeCell(value.hyperlink);
  }
  return String(value);
}

function decode(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8').slice(1);
  }
  const asUtf8 = buffer.toString('utf8');
  // U+FFFD signale un decodage UTF-8 rate : le fichier vient d'Excel Windows.
  return asUtf8.includes('�') ? buffer.toString('latin1') : asUtf8;
}

function detectSeparator(line) {
  const counts = [
    [';', (line.match(/;/g) || []).length],
    ['\t', (line.match(/\t/g) || []).length],
    [',', (line.match(/,/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

function parseCsv(text) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const sep = detectSeparator(firstLine);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((cells) => cells.map((c) => normalizeCell(c)));
}

/** Retourne la liste des feuilles d'un classeur (vide pour un CSV). */
export async function listSheets(filePath) {
  if (/\.(csv|txt)$/i.test(filePath)) return [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.worksheets.map((ws) => ws.name);
}

/**
 * Lit une feuille et renvoie { headers, rows } ou `rows` est un tableau de
 * tableaux aligne sur `headers`.
 *
 * @param {object} options
 * @param {string} options.filePath  chemin absolu du fichier
 * @param {string} [options.sheet]   nom (ou index 1-based) de la feuille ; vide = premiere
 * @param {number} [options.headerRow] ligne contenant les en-tetes (1-based)
 * @param {number} [options.skipRows]  lignes a ignorer juste apres l'en-tete
 * @param {number} [options.maxRows]   limite de lignes lues (apercu)
 */
export async function readTable({
  filePath,
  sheet = '',
  headerRow = 1,
  skipRows = 0,
  maxRows = Infinity,
}) {
  const ext = path.extname(filePath).toLowerCase();
  let matrix;

  if (ext === '.csv' || ext === '.txt') {
    matrix = parseCsv(decode(await fs.readFile(filePath)));
  } else if (ext === '.xlsx' || ext === '.xlsm') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    if (!workbook.worksheets.length) throw new Error('Le classeur ne contient aucune feuille.');

    let worksheet = null;
    const wanted = String(sheet || '').trim();
    if (!wanted) {
      worksheet = workbook.worksheets[0];
    } else if (/^\d+$/.test(wanted)) {
      worksheet = workbook.worksheets[Number(wanted) - 1];
    } else {
      worksheet =
        workbook.worksheets.find((ws) => ws.name.toLowerCase() === wanted.toLowerCase()) || null;
    }
    if (!worksheet) {
      const names = workbook.worksheets.map((ws) => ws.name).join(', ');
      throw new Error(`Feuille « ${sheet} » introuvable. Feuilles disponibles : ${names}`);
    }

    matrix = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values || [];
      const cells = [];
      for (let c = 1; c < values.length; c += 1) cells.push(normalizeCell(values[c]));
      matrix.push(cells);
    });
  } else {
    throw new Error(
      `Format non pris en charge (${ext}). Formats acceptes : .xlsx, .xlsm, .csv, .txt. ` +
        'Un fichier .xls doit etre reenregistre au format .xlsx.',
    );
  }

  const headerIndex = Math.max(1, Number(headerRow) || 1) - 1;
  const rawHeaders = matrix[headerIndex] || [];
  const width = Math.max(rawHeaders.length, ...matrix.map((r) => r.length), 0);

  const headers = [];
  const seen = new Map();
  for (let c = 0; c < width; c += 1) {
    let label = rawHeaders[c] == null ? '' : String(rawHeaders[c]).trim();
    if (!label) label = `Colonne ${columnLetter(c)}`;
    if (seen.has(label)) {
      const n = seen.get(label) + 1;
      seen.set(label, n);
      label = `${label} (${n})`;
    } else {
      seen.set(label, 1);
    }
    headers.push(label);
  }

  const rows = [];
  const start = headerIndex + 1 + Math.max(0, Number(skipRows) || 0);
  for (let r = start; r < matrix.length && rows.length < maxRows; r += 1) {
    const cells = matrix[r] || [];
    if (cells.every((c) => c === null || c === '')) continue; // ligne vide
    const line = [];
    for (let c = 0; c < width; c += 1) line.push(cells[c] === undefined ? null : cells[c]);
    rows.push(line);
  }

  return { headers, rows };
}

export function columnLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
