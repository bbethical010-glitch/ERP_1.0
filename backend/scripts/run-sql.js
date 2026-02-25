import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;

async function main() {
  const sqlPathArg = process.argv[2];
  if (!sqlPathArg) {
    throw new Error('Usage: node scripts/run-sql.js <sql-file-path>');
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const envCandidates = [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../.env')];
  const envPath = envCandidates.find((candidate) => fsSync.existsSync(candidate));
  if (envPath) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL in environment');
  }

  const sqlPath = path.resolve(__dirname, sqlPathArg);
  const sql = await fs.readFile(sqlPath, 'utf8');

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query(sql);
    console.log(`Executed SQL file: ${sqlPath}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('SQL runner failed.');
  if (error?.message) {
    console.error(`message: ${error.message}`);
  }
  if (error?.code) {
    console.error(`code: ${error.code}`);
  }
  if (error?.stack) {
    console.error(error.stack);
  } else {
    console.error(error);
  }
  if (Array.isArray(error?.errors)) {
    for (const nested of error.errors) {
      console.error('nested:', nested?.message || nested);
    }
  }
  process.exit(1);
});
