import { CookieJar, createHttpClient } from './http.js';

export type AuthMode = 'dev' | 'prod';

export interface AuthConfig {
  mode: AuthMode;
  email?: string;
  token?: string;
}

export interface Session {
  cookieJar: CookieJar;
  baseURL: string;
}

const PROD_SESSION_COOKIE_NAME = 'typstr-session';

export async function authenticate(baseURL: string, config: AuthConfig): Promise<Session> {
  const cookieJar = new CookieJar();
  const client = createHttpClient(baseURL, cookieJar);

  if (config.mode === 'dev') {
    const email = config.email ?? 'dev@typstr.local';
    await client.post('/api/auth/local-dev-login', { email });
    if (!cookieJar.has(baseURL)) {
      throw new Error(
        `Dev auth failed: no session cookie returned. ` +
        `Is LOCAL_AUTH_BYPASS_EMAIL set and does it match ${email}?`,
      );
    }
  } else {
    if (!config.token) {
      throw new Error('Prod mode requires --token <session-cookie>');
    }
    const token = normalizeProdSessionCookie(config.token);
    cookieJar.set(baseURL, [token]);
  }

  return { cookieJar, baseURL };
}

export async function whoami(session: Session): Promise<{ id: string; email: string }> {
  const client = createHttpClient(session.baseURL, session.cookieJar);
  const res = await client.get<{ id: string; email: string } | null>('/api/auth/me');
  if (!res.data) {
    throw new Error(
      'Production auth failed: /api/auth/me returned no user. ' +
      'Use a fresh logged-in typstr-session cookie from the same target domain.',
    );
  }
  return res.data;
}

function normalizeProdSessionCookie(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Prod mode requires a non-empty --token value.');
  }

  const sessionCookiePair = trimmed
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${PROD_SESSION_COOKIE_NAME}=`) || part.startsWith('connect.sid='));

  return sessionCookiePair ?? `${PROD_SESSION_COOKIE_NAME}=${trimmed}`;
}
