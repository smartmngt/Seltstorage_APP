const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) { return path.join(DATA_DIR, name); }

function readJSON(name, fallback) {
  try {
    const p = file(name);
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf-8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`readJSON(${name}) 오류:`, e.message);
    return fallback;
  }
}

function writeJSON(name, data) {
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { readJSON, writeJSON };
