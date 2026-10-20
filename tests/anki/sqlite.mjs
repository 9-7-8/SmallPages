// A read-only SQLite reader: enough of the file format to walk one table and
// hand back its rows. Anki's .apkg is a zip with a SQLite collection in it, and
// all this needs from that collection is "every row of notes" and "every row of
// col" — no queries, no indexes, no writing.

export function openSqlite(bytes) {
  if (bytes.length < 100) throw new Error("that is too small to be a database");
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 15));
  if (text !== "SQLite format 3") throw new Error("that is not a SQLite database");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pageSize = view.getUint16(16);
  if (pageSize === 1) pageSize = 65536;          // the format's way of saying 64K
  const reserved = bytes[20];
  const usable = pageSize - reserved;

  return { bytes, view, pageSize, usable };
}

function pageAt(db, number) {
  const start = (number - 1) * db.pageSize;
  if (start < 0 || start + db.pageSize > db.bytes.length) {
    throw new Error(`page ${number} is past the end of the database`);
  }
  return start;
}

// Variable-length integers, up to nine bytes, big end first, seven bits a byte
// until the ninth which gives all eight.
function varint(bytes, at) {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    const byte = bytes[at + i];
    if (i === 8) break;
    if (byte < 0x80) return [Number(value * 128n + BigInt(byte)), i + 1];
    value = value * 128n + BigInt(byte & 0x7f);
  }
  return [Number(value * 256n + BigInt(bytes[at + 8])), 9];
}

// A row's payload can run past its page. The first chunk stays in the cell and
// the rest is a chain of pages, each starting with the number of the next.
function readPayload(db, start, inPage, total) {
  if (total <= inPage) return db.bytes.subarray(start, start + total);

  const out = new Uint8Array(total);
  out.set(db.bytes.subarray(start, start + inPage), 0);
  let filled = inPage;

  let next = db.view.getUint32(start + inPage);
  const seen = new Set();
  while (next !== 0 && filled < total) {
    if (seen.has(next)) throw new Error("the overflow pages loop back on themselves");
    seen.add(next);
    const at = pageAt(db, next);
    const take = Math.min(db.usable - 4, total - filled);
    out.set(db.bytes.subarray(at + 4, at + 4 + take), filled);
    filled += take;
    next = db.view.getUint32(at);
  }
  if (filled < total) throw new Error("the overflow chain ended early");
  return out;
}

function decodeRecord(payload) {
  const [headerSize, headerLen] = varint(payload, 0);
  const types = [];
  let at = headerLen;
  while (at < headerSize) {
    const [type, used] = varint(payload, at);
    types.push(type);
    at += used;
  }

  const values = [];
  let body = headerSize;
  for (const type of types) {
    if (type === 0) { values.push(null); continue; }
    if (type >= 1 && type <= 6) {
      const widths = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 8 };
      const width = widths[type];
      let n = 0n;
      for (let i = 0; i < width; i++) n = (n << 8n) | BigInt(payload[body + i]);
      // Signed, so the top bit means negative.
      const bits = BigInt(width * 8);
      if (n >> (bits - 1n)) n -= 1n << bits;
      values.push(Number(n));
      body += width;
      continue;
    }
    if (type === 7) {
      values.push(new DataView(payload.buffer, payload.byteOffset + body, 8).getFloat64(0));
      body += 8;
      continue;
    }
    if (type === 8) { values.push(0); continue; }
    if (type === 9) { values.push(1); continue; }
    if (type >= 12 && type % 2 === 0) {
      const size = (type - 12) / 2;
      values.push(payload.subarray(body, body + size));
      body += size;
      continue;
    }
    if (type >= 13) {
      const size = (type - 13) / 2;
      values.push(new TextDecoder("utf-8").decode(payload.subarray(body, body + size)));
      body += size;
      continue;
    }
    values.push(null);   // 10 and 11 are reserved and never appear in a file
  }
  return values;
}

// Every row under one b-tree root, in whatever order the tree holds them.
export function* tableRows(db, root) {
  const stack = [root];
  const seen = new Set();

  while (stack.length) {
    const number = stack.pop();
    if (seen.has(number)) continue;      // a damaged file could point in circles
    seen.add(number);

    const at = pageAt(db, number);
    const head = number === 1 ? at + 100 : at;
    const type = db.bytes[head];
    const cells = db.view.getUint16(head + 3);
    const pointers = head + (type === 5 || type === 2 ? 12 : 8);

    if (type === 5) {
      for (let i = 0; i < cells; i++) {
        const cell = at + db.view.getUint16(pointers + i * 2);
        stack.push(db.view.getUint32(cell));
      }
      stack.push(db.view.getUint32(head + 8));     // the rightmost child
      continue;
    }
    if (type !== 13) continue;                     // index pages hold no rows

    for (let i = 0; i < cells; i++) {
      const cell = at + db.view.getUint16(pointers + i * 2);
      const [size, sizeLen] = varint(db.bytes, cell);
      const [, rowidLen] = varint(db.bytes, cell + sizeLen);
      const start = cell + sizeLen + rowidLen;

      // How much of the payload stays on this page, per the format's rule.
      const max = db.usable - 35;
      let inPage = size;
      if (size > max) {
        const min = Math.floor(((db.usable - 12) * 32) / 255) - 23;
        const k = min + ((size - min) % (db.usable - 4));
        inPage = k <= max ? k : min;
      }
      const [rowid] = varint(db.bytes, cell + sizeLen);
      yield { rowid, values: decodeRecord(readPayload(db, start, inPage, size)) };
    }
  }
}

// sqlite_master is itself a table rooted at page 1: name, root page and SQL.
export function tableIndex(db) {
  const tables = new Map();
  for (const { values } of tableRows(db, 1)) {
    const [type, name, , root, sql] = values;
    if (type === "table" && typeof name === "string") {
      tables.set(name, { root, sql: sql || "" });
    }
  }
  return tables;
}

// The column names out of the CREATE TABLE statement, so a row can be read by
// name rather than by counting commas by hand. Anki's own schema carries a
// line comment in the middle of it, which would otherwise be read as two more
// columns and shift everything after it along.
export function columnsOf(rawSql) {
  const sql = rawSql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const open = sql.indexOf("(");
  if (open < 0) return [];
  let depth = 0;
  const parts = [];
  let current = "";
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "(") { depth++; if (depth === 1) continue; }
    if (c === ")") { depth--; if (depth === 0) break; }
    if (c === "," && depth === 1) { parts.push(current); current = ""; continue; }
    current += c;
  }
  parts.push(current);
  return parts
    .map((part) => {
      const name = part.trim().split(/\s+/)[0].replace(/^[`"[]|[`"\]]$/g, "");
      // A column declared INTEGER PRIMARY KEY is the rowid under another name.
      // SQLite stores NULL for it in the record itself and keeps the real
      // value in the cell header, so it has to be filled in from there.
      return { name, rowid: /\binteger\s+primary\s+key\b/i.test(part) };
    })
    .filter((c) => c.name && !/^(primary|unique|check|foreign|constraint|key)$/i.test(c.name));
}

export function readTable(db, name) {
  const tables = tableIndex(db);
  const entry = tables.get(name);
  if (!entry) return null;
  const columns = columnsOf(entry.sql);
  const rows = [];
  for (const { rowid, values } of tableRows(db, entry.root)) {
    const row = {};
    columns.forEach((column, i) => {
      row[column.name] = column.rowid && values[i] == null ? rowid : values[i];
    });
    rows.push(row);
  }
  return { columns: columns.map((c) => c.name), rows };
}
