import { sqlPool, closeSql } from '../apps/worker/src/sql-connection.js';
const [name, principalId] = process.argv.slice(2);
if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name || '') || !/^[a-f0-9-]{36}$/i.test(principalId || '')) throw new Error('Usage: tsx scripts/sql-grant.ts <database-user-name> <user-object-id-or-application-client-id>');
try {
  await (await sqlPool()).request().batch(`
    IF DATABASE_PRINCIPAL_ID('${name}') IS NULL BEGIN
      DECLARE @sid varbinary(16)=CONVERT(binary(16),CONVERT(uniqueidentifier,'${principalId}'));
      DECLARE @command nvarchar(max)=N'CREATE USER [${name}] WITH SID='+CONVERT(varchar(max),@sid,1)+N', TYPE=E';
      EXEC(@command);
    END;
    GRANT SELECT,INSERT,UPDATE,DELETE ON dbo.Records TO [${name}];
    GRANT SELECT,INSERT,UPDATE,DELETE ON dbo.Sources TO [${name}];
    GRANT SELECT,INSERT,UPDATE,DELETE ON dbo.Leases TO [${name}];
  `);
  console.log(JSON.stringify({ granted: name }));
} finally { await closeSql(); }
