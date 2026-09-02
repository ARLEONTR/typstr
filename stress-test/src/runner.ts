import { Metrics } from './lib/metrics.js';
import type { Session } from './lib/auth.js';

export interface ScenarioContext {
  session: Session;
  metrics: Metrics;
  vuId: number;
  iteration: number;
  signal: AbortSignal;
}

export type ScenarioFn = (ctx: ScenarioContext) => Promise<void>;

export interface RunnerOptions {
  vus: number;
  durationMs: number;
  scenario: ScenarioFn;
  sessions: Session[];
  metrics: Metrics;
  thinkTimeMs?: number;
}

function parseDuration(raw: string): number {
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!match) throw new Error(`Invalid duration: ${raw}. Use formats like 30s, 2m, 500ms`);
  const val = parseFloat(match[1]);
  switch (match[2]) {
    case 'ms': return val;
    case 's': return val * 1000;
    case 'm': return val * 60_000;
  }
  throw new Error('unreachable');
}

export { parseDuration };

export async function runScenario(opts: RunnerOptions): Promise<void> {
  const deadline = Date.now() + opts.durationMs;
  const thinkTime = opts.thinkTimeMs ?? 0;
  const controller = new AbortController();

  const shutdownHandler = () => {
    controller.abort();
  };
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);

  let shutdownRequested = false;
  process.on('SIGINT', () => { shutdownRequested = true; });

  const progressInterval = setInterval(() => {
    const remaining = Math.max(0, deadline - Date.now());
    const elapsed = opts.durationMs - remaining;
    const pct = ((elapsed / opts.durationMs) * 100).toFixed(0);
    process.stdout.write(
      `\r  [${pct.padStart(3)}%] ${opts.metrics.total} requests | ` +
      `${opts.metrics.reqPerSecond.toFixed(1)} req/s | ` +
      `${opts.metrics.errorRate.toFixed(1)}% errors   `,
    );
  }, 500);

  async function vuLoop(vuId: number): Promise<void> {
    let iteration = 0;
    while (Date.now() < deadline && !controller.signal.aborted && !shutdownRequested) {
      const ctx: ScenarioContext = {
        session: opts.sessions[vuId % opts.sessions.length],
        metrics: opts.metrics,
        vuId,
        iteration: iteration++,
        signal: controller.signal,
      };
      try {
        await opts.scenario(ctx);
      } catch {
        // errors are already recorded in metrics; don't crash the VU
      }
      if (thinkTime > 0) {
        await sleep(thinkTime);
      }
    }
  }

  const vus = Array.from({ length: opts.vus }, (_, i) => vuLoop(i));
  await Promise.all(vus);

  clearInterval(progressInterval);
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  process.removeListener('SIGINT', shutdownHandler);
  process.removeListener('SIGTERM', shutdownHandler);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
