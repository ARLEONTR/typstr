import { compileTypstScenario, compileLatexScenario } from './compile.js';
import { exportScenario } from './export.js';
import { collaborateScenario } from './collaborate.js';
import type { ScenarioFn, ScenarioContext } from '../runner.js';

// Weighted round-robin: 60% compile, 25% export, 15% collaborate
const weights: Array<[weight: number, fn: ScenarioFn]> = [
  [35, compileTypstScenario],
  [25, compileLatexScenario],
  [25, exportScenario],
  [15, collaborateScenario],
];

const total = weights.reduce((s, [w]) => s + w, 0);
const cumulative: Array<[threshold: number, fn: ScenarioFn]> = [];
let sum = 0;
for (const [w, fn] of weights) {
  sum += w;
  cumulative.push([sum / total, fn]);
}

export const mixedScenario: ScenarioFn = async (ctx: ScenarioContext) => {
  const roll = Math.random();
  const [, fn] = cumulative.find(([threshold]) => roll <= threshold) ?? cumulative[cumulative.length - 1];
  await fn(ctx);
};
