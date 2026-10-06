import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
for (const line of (await readFile('.local/dev.env', 'utf8')).split('\n')) {
 const match=line.match(/^([A-Z_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=JSON.parse(match[2]);
}
if(process.env.SQL_DATABASE==='research')throw new Error('Local worker cannot use production SQL');
execFileSync('npm',['run','build:worker'],{stdio:'inherit'});
await copyFile('apps/worker/sql/001-initial.sql','.function-package/001-initial.sql');
const values: Record<string,string>={AzureWebJobsStorage:process.env.AZURITE_CONNECTION_STRING!,FUNCTIONS_WORKER_RUNTIME:'node',
 STORAGE_ACCOUNT:'researchdev',AZURITE_CONNECTION_STRING:process.env.AZURITE_CONNECTION_STRING!,SQL_SERVER:process.env.SQL_SERVER||'',SQL_DATABASE:process.env.SQL_DATABASE||'',SQL_CONNECTION_STRING:process.env.SQL_CONNECTION_STRING||'',
 READER_GITHUB_USERS:'pinaatti,DrBushyTop','AzureWebJobs.discoverCaptures.Disabled':'true','AzureWebJobs.recoverChats.Disabled':'true'};
for(const name of ['KEY_VAULT_URI','FOUNDRY_ENDPOINT','FOUNDRY_DEPLOYMENT','AZURE_SUBSCRIPTION_ID','AZURE_RESOURCE_GROUP','SANDBOX_REGION','SANDBOX_GROUP','SANDBOX_SNAPSHOT','BROWSER_SANDBOX_SNAPSHOT','BROWSER_ASSET_HOSTS'])if(process.env[name])values[name]=process.env[name]!;
if(!values.FOUNDRY_ENDPOINT||!values.FOUNDRY_DEPLOYMENT)throw new Error('Set FOUNDRY_ENDPOINT and FOUNDRY_DEPLOYMENT for real model work');
await writeFile('.function-package/local.settings.json',JSON.stringify({IsEncrypted:false,Values:values}),{mode:0o600});
const child=spawn('func',['start','--port','7071'],{cwd:'.function-package',stdio:'inherit',env:process.env});
child.on('exit',code=>process.exit(code||0));
