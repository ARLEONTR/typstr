import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHttpClient, timedRequest } from '../lib/http.js';
import type { ScenarioFn } from '../runner.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dir, '../../fixtures');

const simpleTypst = readFileSync(join(fixturesDir, 'simple.typ'), 'utf8');
const simpleTex = readFileSync(join(fixturesDir, 'simple.tex'), 'utf8');
const complexTex = readFileSync(join(fixturesDir, 'complex.tex'), 'utf8');

export const compileTypstScenario: ScenarioFn = async (ctx) => {
  const client = createHttpClient(ctx.session.baseURL, ctx.session.cookieJar);
  await timedRequest(client, {
    method: 'POST',
    url: '/api/compile',
    data: { source: simpleTypst, documentFormat: 'typst', format: 'svg' },
  }, 'compile:typst', ctx.metrics);
};

export const compileLatexScenario: ScenarioFn = async (ctx) => {
  const client = createHttpClient(ctx.session.baseURL, ctx.session.cookieJar);
  const source = ctx.iteration % 5 === 0 ? complexTex : simpleTex;
  await timedRequest(client, {
    method: 'POST',
    url: '/api/compile',
    data: { source, documentFormat: 'latex', latexEngine: 'pdflatex', format: 'pdf' },
  }, 'compile:latex', ctx.metrics);
};

export const compileMixedScenario: ScenarioFn = async (ctx) => {
  const client = createHttpClient(ctx.session.baseURL, ctx.session.cookieJar);
  if (ctx.vuId % 2 === 0) {
    await timedRequest(client, {
      method: 'POST',
      url: '/api/compile',
      data: { source: simpleTypst, documentFormat: 'typst', format: 'svg' },
    }, 'compile:typst', ctx.metrics);
  } else {
    await timedRequest(client, {
      method: 'POST',
      url: '/api/compile',
      data: { source: simpleTex, documentFormat: 'latex', latexEngine: 'pdflatex', format: 'pdf' },
    }, 'compile:latex', ctx.metrics);
  }
};
