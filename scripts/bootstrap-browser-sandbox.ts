/** Provision a clean browser image before any source/customer content is uploaded. Prints only the snapshot ID. */
import { sandboxClient } from '../apps/worker/src/chat-sandbox.js';
import { deleteWorkspace, denyWorkspaceEgress } from '../apps/worker/src/sandbox-lifecycle.js';
const client = sandboxClient();
const signal = AbortSignal.timeout(600_000);
let id: string | undefined;
try {
  const sandbox = await client.sandboxes.beginCreate({
    sourcesRef: { snapshot: { id: process.env.SANDBOX_SNAPSHOT! } },
    egressPolicy: { defaultAction: 'Allow', trafficInspection: 'None', hostRules: [], rules: [] },
    lifecycle: { autoDelete: { enabled: true, deleteIntervalSeconds: 600 } }
  }, { abortSignal: signal }).pollUntilDone();
  id = sandbox.id;
  const installed = await client.sandboxes.exec(id, { command: 'apt-get update && apt-get install -y python3-pip && python3 -m pip install --break-system-packages playwright==1.55.0 && apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 python3 -m playwright install chromium' }, { abortSignal: signal });
  if (installed.exitCode !== 0) { console.error(JSON.stringify({ stdout: installed.stdout?.slice(-4000), stderr: installed.stderr?.slice(-1500) })); throw new Error('Browser image installation failed'); }
  const verified = await client.sandboxes.exec(id, { command: `python3 -c "import os; os.environ['PLAYWRIGHT_HOST_PLATFORM_OVERRIDE']='ubuntu24.04-x64'; from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(); print(b.version); b.close(); p.stop()"` }, { abortSignal: signal });
  if (verified.exitCode !== 0) throw new Error('Browser image verification failed');
  await denyWorkspaceEgress(id, signal);
  const snapshot = await client.sandboxes.beginCreateSnapshot(id, { abortSignal: signal }).pollUntilDone();
  console.log(JSON.stringify({ browserSnapshot: snapshot.id }));
} catch (error) { console.error(JSON.stringify({ status: (error as { statusCode?: number }).statusCode })); throw error; } finally { if (id) await deleteWorkspace(id); }
