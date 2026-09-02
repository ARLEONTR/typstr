import axios from 'axios';
import { createHttpClient, timedRequest } from '../lib/http.js';
import { CollabClient, httpToWs } from '../lib/ws.js';
import type { ScenarioFn } from '../runner.js';

interface CollabSetup {
  projectId: string;
  fileId: string;
}

// The caller must provide this before running the scenario.
let _setup: CollabSetup | null = null;

export function setCollabSetup(setup: CollabSetup): void {
  _setup = setup;
}

export const collaborateScenario: ScenarioFn = async (ctx) => {
  if (!_setup) throw new Error('collaborateScenario: call setCollabSetup() first');
  const { projectId, fileId } = _setup;

  const httpClient = createHttpClient(ctx.session.baseURL, ctx.session.cookieJar);

  // Fetch a fresh collaboration token (timed)
  let token: string;
  try {
    const tokenRes = await timedRequest<{ token: string }>(httpClient, {
      method: 'GET',
      url: `/api/projects/${projectId}/collaboration-token`,
      params: { fileId },
    }, 'collab:token', ctx.metrics);
    token = tokenRes.data.token;
  } catch {
    return;
  }

  // Open WebSocket and wait for server to send at least one sync message
  const wsBase = httpToWs(ctx.session.baseURL);
  const client = new CollabClient({
    wsURL: `${wsBase}/ws`,
    documentId: fileId,
    token,
  });

  const t0 = Date.now();
  try {
    await client.connect();
    await client.waitForMessages(1, 6000);
    const durationMs = Date.now() - t0;
    ctx.metrics.record({ durationMs, status: 101, ok: true, label: 'collab:connect' });
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    ctx.metrics.record({ durationMs, status: 0, ok: false, label: 'collab:connect' });
  } finally {
    client.close();
  }
};

export async function createCollabProject(
  baseURL: string,
  cookieJar: import('../lib/http.js').CookieJar,
): Promise<CollabSetup> {
  const client = createHttpClient(baseURL, cookieJar);

  const projectRes = await client.post<{ id: string; files?: Array<{ id: string; isMainFile?: boolean }> }>(
    '/api/projects',
    { title: 'stress-test-scratch', projectFormat: 'typst' },
  );
  const projectId: string = projectRes.data.id;

  // GET the project detail to retrieve file list
  const detailRes = await client.get<{
    id: string;
    files: Array<{ id: string; isMainFile: boolean }>;
  }>(`/api/projects/${projectId}`);

  const mainFile = detailRes.data.files.find(f => f.isMainFile) ?? detailRes.data.files[0];
  if (!mainFile) throw new Error('No file found in scratch project');

  return { projectId, fileId: mainFile.id };
}

export async function deleteCollabProject(
  baseURL: string,
  cookieJar: import('../lib/http.js').CookieJar,
  projectId: string,
): Promise<void> {
  const client = createHttpClient(baseURL, cookieJar);
  try {
    await client.post(`/api/projects/${projectId}/trash`);
  } catch {
    // best-effort cleanup
  }
}
