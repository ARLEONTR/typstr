import axios, { type AxiosInstance, type AxiosRequestConfig, type RawAxiosRequestHeaders } from 'axios';
import type { Metrics, Sample } from './metrics.js';

export function createHttpClient(baseURL: string, cookieJar?: CookieJar): AxiosInstance {
  const origin = new URL(baseURL).origin;
  const client = axios.create({
    baseURL,
    withCredentials: true,
    headers: {
      Origin: origin,
      Referer: `${origin}/`,
    },
  });

  client.interceptors.request.use(config => {
    if (cookieJar) {
      const cookie = cookieJar.get(baseURL);
      if (cookie) {
        (config.headers as RawAxiosRequestHeaders)['Cookie'] = cookie;
      }
    }
    return config;
  });

  client.interceptors.response.use(response => {
    if (cookieJar) {
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        cookieJar.set(baseURL, setCookie);
      }
    }
    return response;
  });

  return client;
}

export interface TimedResponse<T = unknown> {
  data: T;
  status: number;
  durationMs: number;
}

export async function timedRequest<T = unknown>(
  client: AxiosInstance,
  config: AxiosRequestConfig,
  label: string,
  metrics: Metrics,
): Promise<TimedResponse<T>> {
  const t0 = Date.now();
  try {
    const res = await client.request<T>(config);
    const durationMs = Date.now() - t0;
    const sample: Sample = { durationMs, status: res.status, ok: true, label };
    metrics.record(sample);
    return { data: res.data, status: res.status, durationMs };
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    const status = axios.isAxiosError(err) ? (err.response?.status ?? 0) : 0;
    metrics.record({ durationMs, status, ok: false, label });
    throw err;
  }
}

export class CookieJar {
  private cookies = new Map<string, string>();

  set(baseURL: string, setCookieHeaders: string[]): void {
    const origin = new URL(baseURL).origin;
    const parts: string[] = [];
    for (const header of setCookieHeaders) {
      const nameVal = header.split(';')[0].trim();
      if (nameVal) parts.push(nameVal);
    }
    if (parts.length > 0) {
      this.cookies.set(origin, parts.join('; '));
    }
  }

  get(baseURL: string): string | undefined {
    return this.cookies.get(new URL(baseURL).origin);
  }

  has(baseURL: string): boolean {
    return this.cookies.has(new URL(baseURL).origin);
  }

  raw(baseURL: string): string {
    return this.cookies.get(new URL(baseURL).origin) ?? '';
  }
}
