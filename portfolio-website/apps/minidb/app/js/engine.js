/*
 * MiniDB engine — JavaScript port of the Python Bitcask-style engine
 * (minidb/engine.py) from the original MiniDB-Storage project.
 *
 * This is a faithful port of the algorithm, not a rewrite: same record
 * format, same index semantics, same compaction logic. The one honest
 * adaptation is storage — a browser tab has no real filesystem to
 * append to, so the "log file" is simulated as a growable in-memory
 * byte array (`this.log`) instead of bytes on disk. Everything that
 * happens *around* that byte array — the record framing, the
 * offset/length index, rebuild-on-open, and compaction — is the same
 * logic the real engine runs against an actual file.
 *
 * Record format (matches the Python struct ">BII"):
 *   [ 1 byte opcode ][ 4 bytes key length, BE ][ 4 bytes value length, BE ]
 *   [ key bytes ][ value bytes ]
 * Opcodes: SET = 1, DEL = 2 (value bytes empty for deletes).
 */

const OP_SET = 1;
const OP_DEL = 2;
const HEADER_SIZE = 9; // 1 (op) + 4 (key len) + 4 (value len)

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

class MiniDBError extends Error {
  constructor(message) {
    super(message);
    this.name = "MiniDBError";
  }
}

class KeyNotFoundError extends MiniDBError {
  constructor(key) {
    super(`key not found: '${key}'`);
    this.name = "KeyNotFoundError";
    this.key = key;
  }
}

class MiniDB {
  constructor() {
    /** @type {number[]} simulated append-only log, as raw byte values (0-255) */
    this.log = [];
    /** @type {Map<string, [number, number]>} key -> [valueOffset, valueLength] */
    this.index = new Map();
    /** @type {{op:number,key:string,valueLen:number,offset:number}[]} record metadata, in log order, for the UI's raw-log view */
    this.records = [];
  }

  get sizeBytes() {
    return this.log.length;
  }

  get count() {
    return this.index.size;
  }

  // --------------------------------------------------------------
  // core key-value operations (mirrors MiniDB.set/get/delete)
  // --------------------------------------------------------------

  set(key, value) {
    this._append(OP_SET, key, value);
  }

  get(key) {
    const entry = this.index.get(key);
    if (!entry) throw new KeyNotFoundError(key);
    const [offset, length] = entry;
    const bytes = this.log.slice(offset, offset + length);
    return decoder.decode(new Uint8Array(bytes));
  }

  delete(key) {
    if (!this.index.has(key)) throw new KeyNotFoundError(key);
    this._append(OP_DEL, key, "");
    this.index.delete(key);
  }

  has(key) {
    return this.index.has(key);
  }

  keys() {
    return Array.from(this.index.keys()).sort();
  }

  // --------------------------------------------------------------
  // compaction (mirrors MiniDB.compact)
  // --------------------------------------------------------------

  compact() {
    const newLog = [];
    const newIndex = new Map();
    const newRecords = [];
    for (const key of this.keys()) {
      const value = this.get(key);
      const recordOffset = newLog.length;
      MiniDB._writeRecord(newLog, OP_SET, key, value);
      const keyBytesLen = encoder.encode(key).length;
      const valueBytesLen = encoder.encode(value).length;
      const valueOffset = recordOffset + HEADER_SIZE + keyBytesLen;
      newIndex.set(key, [valueOffset, valueBytesLen]);
      newRecords.push({ op: OP_SET, key, valueLen: valueBytesLen, offset: recordOffset });
    }
    this.log = newLog;
    this.index = newIndex;
    this.records = newRecords;
  }

  // --------------------------------------------------------------
  // rebuild-on-open (mirrors MiniDB._rebuild_index, exposed here as
  // an explicit "reload" so the UI can demonstrate it on demand)
  // --------------------------------------------------------------

  reload() {
    this._rebuildIndex();
  }

  // --------------------------------------------------------------
  // internals
  // --------------------------------------------------------------

  _append(op, key, value) {
    const offset = MiniDB._writeRecord(this.log, op, key, value);
    const valueBytesLen = encoder.encode(value).length;
    this.records.push({ op, key, valueLen: valueBytesLen, offset });
    if (op === OP_SET) {
      const keyBytesLen = encoder.encode(key).length;
      const valueOffset = offset + HEADER_SIZE + keyBytesLen;
      this.index.set(key, [valueOffset, valueBytesLen]);
    }
  }

  static _writeRecord(buf, op, key, value) {
    const keyBytes = encoder.encode(key);
    const valueBytes = encoder.encode(value);
    const offset = buf.length;
    buf.push(op & 0xff);
    MiniDB._pushUint32BE(buf, keyBytes.length);
    MiniDB._pushUint32BE(buf, valueBytes.length);
    for (let i = 0; i < keyBytes.length; i++) buf.push(keyBytes[i]);
    for (let i = 0; i < valueBytes.length; i++) buf.push(valueBytes[i]);
    return offset;
  }

  static _pushUint32BE(buf, n) {
    buf.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  }

  static _readUint32BE(buf, offset) {
    return (
      ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>>
      0
    );
  }

  /**
   * Replay the log from byte zero to reconstruct the index — exactly
   * what the real engine does on process start (`_rebuild_index`),
   * here triggerable on demand via the "reload" control so visitors
   * can see that the index is *derived* from the log, not primary
   * state. A truncated trailing record is treated as end-of-log
   * rather than an error, same as the Python version.
   */
  _rebuildIndex() {
    const index = new Map();
    const records = [];
    const buf = this.log;
    let pos = 0;
    while (true) {
      if (pos + HEADER_SIZE > buf.length) break; // clean EOF or truncated header
      const op = buf[pos];
      const keyLen = MiniDB._readUint32BE(buf, pos + 1);
      const valueLen = MiniDB._readUint32BE(buf, pos + 5);
      const recordStart = pos;
      pos += HEADER_SIZE;

      if (pos + keyLen > buf.length) break; // truncated record
      const keyBytes = buf.slice(pos, pos + keyLen);
      const key = decoder.decode(new Uint8Array(keyBytes));
      pos += keyLen;

      if (op === OP_SET) {
        if (pos + valueLen > buf.length) break; // truncated record
        const valueOffset = pos;
        index.set(key, [valueOffset, valueLen]);
        records.push({ op, key, valueLen, offset: recordStart });
        pos += valueLen;
      } else if (op === OP_DEL) {
        index.delete(key);
        records.push({ op, key, valueLen: 0, offset: recordStart });
      } else {
        break; // unrecognized opcode: stop rather than misparse
      }
    }
    this.index = index;
    this.records = records;
  }
}

// Exposed for app.js (no bundler / module step, plain <script> includes)
window.MiniDB = MiniDB;
window.MiniDBError = MiniDBError;
window.KeyNotFoundError = KeyNotFoundError;
window.MINIDB_OP_SET = OP_SET;
window.MINIDB_OP_DEL = OP_DEL;
