import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHttpClient, timedRequest } from '../lib/http.js';
import type { ScenarioFn } from '../runner.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dir, '../../fixtures');

const simpleTypst = readFileSync(join(fixturesDir, 'simple.typ'), 'utf8');
const simpleTex = readFileSync(join(fixturesDir, 'simple.tex'), 'utf8');

const formats = ['docx', 'html', 'pdf'] as const;

export const exportScenario: ScenarioFn = async (ctx) => {
  const client = createHttpClient(ctx.session.baseURL, ctx.session.cookieJar);
  const format = formats[ctx.iteration % formats.length];
  const isLatex = ctx.vuId % 2 !== 0;
  await timedRequest(client, {
    method: 'POST',
    url: '/api/export',
    data: {
      source: isLatex ? simpleTex : simpleTypst,
      documentFormat: isLatex ? 'latex' : 'typst',
      format,
    },
    responseType: 'arraybuffer',
  }, `export:${format}`, ctx.metrics);
};
