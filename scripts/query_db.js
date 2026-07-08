const path = require('path');
const DB_PATH = 'C:/Users/Alexnitro777/.local/share/mimocode/mimocode.db';

const db = require('better-sqlite3')(DB_PATH, { readonly: true });

const query = process.argv[2];
if (!query) {
  console.error('Usage: node query_db.js "<SQL>"');
  process.exit(1);
}

const stmt = db.prepare(query);
const results = stmt.all();
console.log(JSON.stringify(results, null, 2));
db.close();
