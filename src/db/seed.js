/**
 * Seed script: reads data/queries.csv and bulk-inserts into SQLite.
 * Run with: npm run seed
 */

const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('./init');
const { bulkInsert, getTotalCount } = require('./queries');

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const entries = [];

  for (let i = 1; i < lines.length; i++) { // skip header
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted fields: "some, query",count
    let query, count;
    if (line.startsWith('"')) {
      const closeQuote = line.lastIndexOf('",');
      query = line.slice(1, closeQuote).replace(/""/g, '"');
      count = parseInt(line.slice(closeQuote + 2));
    } else {
      const commaIdx = line.lastIndexOf(',');
      query = line.slice(0, commaIdx);
      count = parseInt(line.slice(commaIdx + 1));
    }

    if (query && !isNaN(count)) {
      entries.push([query, count]);
    }
  }

  return entries;
}

function main() {
  const csvPath = path.join(__dirname, '../../data/queries.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('❌ queries.csv not found. Run: npm run generate-data');
    process.exit(1);
  }

  console.log('🔄 Reading dataset...');
  const entries = parseCSV(csvPath);
  console.log(`   Found ${entries.length.toLocaleString()} entries`);

  console.log('🔄 Seeding database...');
  const startTime = Date.now();

  // Initialize DB (creates tables)
  getDb();

  // Chunk into batches of 5000 for progress reporting
  const chunkSize = 5000;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    bulkInsert(chunk);
    const pct = Math.round(((i + chunk.length) / entries.length) * 100);
    process.stdout.write(`\r   Progress: ${pct}% (${(i + chunk.length).toLocaleString()} / ${entries.length.toLocaleString()})`);
  }

  const elapsed = Date.now() - startTime;
  const total = getTotalCount();
  console.log(`\n✅ Seeded ${total.toLocaleString()} queries in ${elapsed}ms`);

  closeDb();
}

main();
