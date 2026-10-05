import { setTimeout as delay } from 'node:timers/promises';
import { DefaultAzureCredential } from '@azure/identity';
import { endpointForRegion, type SandboxGroupClient } from '@azure/containerapps-sandbox';
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
const sandboxId = (id: unknown): string => { if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid sandbox ID'); return id; };
async function request(method: string, path: string, signal: AbortSignal, body?: unknown) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const token = await new DefaultAzureCredential().getToken('https://dynamicsessions.io/.default', { abortSignal: bounded });
  const scope = `/subscriptions/${encodeURIComponent(required('AZURE_SUBSCRIPTION_ID'))}/resourceGroups/${encodeURIComponent(required('AZURE_RESOURCE_GROUP'))}/sandboxGroups/${encodeURIComponent(required('SANDBOX_GROUP'))}/sandboxes`;
  const response = await fetch(`${endpointForRegion(required('SANDBOX_REGION'))}${scope}${path}?api-version=2026-02-01-preview`, {
    method, signal: bounded, headers: { Authorization: `Bearer ${token?.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 404 && method !== 'PUT') { await response.body?.cancel(); return undefined; }
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('Sandbox API request failed'), { statusCode: response.status }); }
  if (method === 'DELETE') { await response.body?.cancel(); return undefined; }
  return await response.json() as { id: string; state: string };
}
// Native beta SDK polling drops abort signals on GET and hides the initial ID.
// Record the initial response here, then poll each request with the caller's deadline.
export async function createWorkspace(client: SandboxGroupClient, signal: AbortSignal, record: (id: string) => Promise<void>) {
  const initial = await request('PUT', '', signal, { sourcesRef: { snapshot: { id: required('SANDBOX_SNAPSHOT') } } });
  const id = sandboxId(initial?.id);
  await record(id);
  await client.sandboxes.setLifecyclePolicy(id, { autoSuspend: { enabled: true, interval: 120, mode: 'Disk' }, autoDelete: { enabled: true, deleteIntervalSeconds: 600 } }, { abortSignal: signal });
  let state = initial?.state;
  while (state?.toLowerCase() !== 'running') {
    signal.throwIfAborted();
    if (['failed', 'deleting'].includes(state?.toLowerCase() || '')) throw new Error('Sandbox failed to start');
    await delay(1000, undefined, { signal });
    state = (await request('GET', `/${id}`, signal))?.state;
  }
  return id;
}
export async function deleteWorkspace(id: string) {
  const signal = AbortSignal.timeout(30_000);
  const path = `/${sandboxId(id)}`;
  await request('DELETE', path, signal);
  while (await request('GET', path, signal)) await delay(1000, undefined, { signal });
}
export async function deleteExpiredWorkspaces(client: SandboxGroupClient) {
  const signal = AbortSignal.timeout(30_000);
  for await (const sandbox of client.sandboxes.list({ abortSignal: signal })) {
    // This application owns the entire group. Also catches a lost create response.
    if (sandbox.createdAt && Date.now() - Date.parse(sandbox.createdAt) > 10 * 60_000) await deleteWorkspace(sandbox.id);
  }
}
