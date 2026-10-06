import { readFile } from 'node:fs/promises';
import { sqlPool, closeSql } from '../apps/worker/src/sql-connection.js';
const pool = await sqlPool();
try {
  await pool.request().batch(await readFile('apps/worker/sql/001-initial.sql', 'utf8'));
  console.log(JSON.stringify({ migrated: true, version: 1 }));
} finally { await closeSql(); }
