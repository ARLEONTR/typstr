#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { authenticate, whoami } from './lib/auth.js';
import { Metrics } from './lib/metrics.js';
import { runScenario, parseDuration } from './runner.js';
import {
  compileTypstScenario,
  compileLatexScenario,
  compileMixedScenario,
} from './scenarios/compile.js';
import { exportScenario } from './scenarios/export.js';
import {
  collaborateScenario,
  setCollabSetup,
  createCollabProject,
  deleteCollabProject,
} from './scenarios/collaborate.js';
import { mixedScenario } from './scenarios/mixed.js';
import type { ScenarioFn } from './runner.js';

const SCENARIOS: Record<string, ScenarioFn> = {
  'compile:typst': compileTypstScenario,
  'compile:latex': compileLatexScenario,
  'compile:mixed': compileMixedScenario,
  'export': exportScenario,
  'collaborate': collaborateScenario,
  'mixed': mixedScenario,
};

const program = new Command();

program
  .name('typstr-stress')
  .description('External stress-testing tool for typstr (dev + production)')
  .version('1.0.0')
  .requiredOption('--target <url>', 'Base HTTP URL of the target (e.g. http://localhost:3000)')
  .requiredOption(
    '--scenario <name>',
    `Scenario to run: ${Object.keys(SCENARIOS).join(', ')}`,
  )
  .option('--users <n>', 'Number of virtual users (VUs)', '10')
  .option('--duration <d>', 'Test duration (e.g. 30s, 2m, 500ms)', '30s')
  .option('--think-time <ms>', 'Pause between iterations per VU in ms', '0')
  .option('--auth-mode <mode>', 'Auth mode: dev | prod', 'dev')
  .option('--email <email>', 'Email for dev auth (matches LOCAL_AUTH_BYPASS_EMAIL)', 'dev@typstr.local')
  .option('--token <cookie>', 'connect.sid cookie value for prod auth')
  .option('--token-file <path>', 'File with one production session cookie value per line')
  .option('--no-collab-cleanup', 'Keep the scratch project created for collaborate scenario')
  .parse(process.argv);

const opts = program.opts<{
  target: string;
  scenario: string;
  users: string;
  duration: string;
  thinkTime: string;
  authMode: string;
  email: string;
  token?: string;
  tokenFile?: string;
  collabCleanup: boolean;
}>();

async function main() {
  const scenarioFn = SCENARIOS[opts.scenario];
  if (!scenarioFn) {
    console.error(`Unknown scenario "${opts.scenario}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  const vus = parseInt(opts.users, 10);
  if (!Number.isFinite(vus) || vus < 1) {
    console.error('--users must be a positive integer');
    process.exit(1);
  }

  let durationMs: number;
  try {
    durationMs = parseDuration(opts.duration);
  } catch (err: unknown) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const thinkTimeMs = parseInt(opts.thinkTime, 10) || 0;
  const baseURL = opts.target.replace(/\/$/, '');

  // Authenticate
  console.log(`\nAuthenticating against ${baseURL} (mode: ${opts.authMode}) ...`);
  let sessions: Array<Awaited<ReturnType<typeof authenticate>>>;
  try {
    const tokens = loadProdTokens(opts.token, opts.tokenFile);
    const authInputs = opts.authMode === 'prod' && tokens.length > 0
      ? tokens.map((token) => ({ mode: 'prod' as const, token }))
      : [{ mode: opts.authMode as 'dev' | 'prod', email: opts.email, token: opts.token }];

    sessions = [];
    const users = new Map<string, string>();
    for (const authInput of authInputs) {
      const session = await authenticate(baseURL, authInput);
      const me = await whoami(session);
      sessions.push(session);
      users.set(me.id, me.email);
    }
    console.log(`  Loaded ${sessions.length} session${sessions.length === 1 ? '' : 's'} for ${users.size} user${users.size === 1 ? '' : 's'}`);
    for (const [id, email] of users) {
      console.log(`  - ${email} (id: ${id})`);
    }
  } catch (err: unknown) {
    console.error(`  Auth failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // Create scratch project if needed
  let collabProjectId: string | null = null;
  if (opts.scenario === 'collaborate' || opts.scenario === 'mixed') {
    console.log('  Creating scratch collaboration project ...');
    try {
      const setup = await createCollabProject(baseURL, sessions[0].cookieJar);
      setCollabSetup(setup);
      collabProjectId = setup.projectId;
      console.log(`  Project: ${setup.projectId}  File: ${setup.fileId}`);
    } catch (err: unknown) {
      console.error(`  Failed to create collab project: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // Run
  const metrics = new Metrics();
  console.log(
    `\nRunning scenario "${opts.scenario}" — ${vus} VUs × ${opts.duration}` +
    (thinkTimeMs ? ` (think: ${thinkTimeMs}ms)` : '') +
    '\n',
  );

  await runScenario({ vus, durationMs, scenario: scenarioFn, sessions, metrics, thinkTimeMs });

  // Cleanup
  if (collabProjectId && opts.collabCleanup) {
    try {
      await deleteCollabProject(baseURL, sessions[0].cookieJar, collabProjectId);
    } catch {
      // ignore cleanup errors
    }
  }

  metrics.printSummary();
}

function loadProdTokens(token?: string, tokenFile?: string): string[] {
  const tokens: string[] = [];
  if (token?.trim()) {
    tokens.push(token.trim());
  }
  if (tokenFile?.trim()) {
    const fromFile = readFileSync(tokenFile.trim(), 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    tokens.push(...fromFile);
  }
  return Array.from(new Set(tokens));
}

main().catch(err => {
  console.error('\nFatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
