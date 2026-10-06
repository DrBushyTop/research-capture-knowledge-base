import { setTimeout as delay } from 'node:timers/promises';
import { DefaultAzureCredential } from '@azure/identity';
import { endpointForRegion, type SandboxGroupClient } from '@azure/containerapps-sandbox';
const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
const sandboxId = (id: unknown): string => { if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid sandbox ID'); return id; };
async function send(method: string, path: string, signal: AbortSignal, body?: string | Uint8Array, type = 'application/json', query: Record<string, string> = {}) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const token = await new DefaultAzureCredential().getToken('https://dynamicsessions.io/.default', { abortSignal: bounded });
  const scope = `/subscriptions/${encodeURIComponent(required('AZURE_SUBSCRIPTION_ID'))}/resourceGroups/${encodeURIComponent(required('AZURE_RESOURCE_GROUP'))}/sandboxGroups/${encodeURIComponent(required('SANDBOX_GROUP'))}/sandboxes`;
  const url = new URL(`${endpointForRegion(required('SANDBOX_REGION'))}${scope}${path}`);
  for (const [key, value] of Object.entries({ 'api-version': '2026-02-01-preview', ...query })) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method, signal: bounded, headers: { Authorization: `Bearer ${token?.token}`, 'Content-Type': type }, body: body as BodyInit | undefined
  });
  if (response.status === 404 && ['GET', 'DELETE'].includes(method)) return response;
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('Sandbox API request failed'), { statusCode: response.status }); }
  return response;
}
async function request(method: string, path: string, signal: AbortSignal, body?: unknown) {
  const response = await send(method, path, signal, body === undefined ? undefined : JSON.stringify(body));
  if (response.status === 404 || method === 'DELETE') { await response.body?.cancel(); return undefined; }
  return await response.json() as { id: string; state: string };
}
export async function writeWorkspaceFile(id: string, path: string, data: string | Uint8Array, signal: AbortSignal) {
  const response = await send('PUT', `/${sandboxId(id)}/files`, signal, data, 'application/octet-stream', { path, createDirs: 'true', mode: '0444' });
  await response.body?.cancel();
}
export async function readWorkspaceFile(id: string, path: string, maxBytes: number, signal: AbortSignal) {
  const response = await send('GET', `/${sandboxId(id)}/files`, signal, undefined, 'application/octet-stream', { path });
  if (response.status === 404 || !response.body || Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Sandbox evidence file unavailable or too large'); }
  const parts: Uint8Array[] = []; let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length; if (bytes > maxBytes) throw new Error('Sandbox evidence exceeds limit');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
export async function denyWorkspaceEgress(id: string, signal: AbortSignal) {
  await request('POST', `/${sandboxId(id)}/egresspolicy`, signal, { defaultAction: 'Deny', trafficInspection: 'Full', hostRules: [], rules: [] });
}
// Native beta SDK polling drops abort signals on GET and hides the initial ID.
// Record the initial response here, then poll each request with the caller's deadline.
export async function createWorkspace(client: SandboxGroupClient, signal: AbortSignal, record: (id: string) => Promise<void>, options?: { snapshot: string; hosts: string[] }) {
  const egressPolicy = { defaultAction: 'Deny', trafficInspection: 'Full', hostRules: [], rules: options?.hosts.map(host => ({ match: { host, methods: ['GET'] }, action: { type: 'Allow' } })) || [] };
  const initial = await request('PUT', '', signal, { sourcesRef: { snapshot: { id: options?.snapshot || required('SANDBOX_SNAPSHOT') } }, egressPolicy });
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
