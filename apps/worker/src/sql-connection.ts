import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

let connection: { key: string; expires: number; promise: Promise<sql.ConnectionPool> } | undefined;
const credential = new DefaultAzureCredential();

export async function sqlPool() {
  const key = process.env.SQL_CONNECTION_STRING || `${process.env.SQL_SERVER}/${process.env.SQL_DATABASE}`;
  if (connection?.key === key && connection.expires > Date.now()) return connection.promise;
  const previous = connection;
  const promise = (async () => {
    if (process.env.SQL_CONNECTION_STRING) return new sql.ConnectionPool(process.env.SQL_CONNECTION_STRING).connect();
    if (!process.env.SQL_SERVER || !process.env.SQL_DATABASE) throw new Error('SQL_SERVER and SQL_DATABASE are required');
    const token = await credential.getToken('https://database.windows.net/.default');
    return new sql.ConnectionPool({
      server: process.env.SQL_SERVER, database: process.env.SQL_DATABASE,
      authentication: { type: 'azure-active-directory-access-token', options: { token: token.token } },
      options: { encrypt: true, trustServerCertificate: false },
      pool: { min: 0, max: 4, idleTimeoutMillis: 30000 },
      connectionTimeout: 30000, requestTimeout: 30000
    }).connect();
  })();
  connection = { key, expires: Date.now() + 40 * 60_000, promise };
  promise.catch(() => { if (connection?.promise === promise) connection = undefined; });
  if (previous) void previous.promise.then(pool => pool.close()).catch(() => {});
  return promise;
}

export async function closeSql() {
  const current = connection;
  connection = undefined;
  if (current) await (await current.promise).close();
}
