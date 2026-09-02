export interface Sample {
  durationMs: number;
  status: number;
  ok: boolean;
  label: string;
}

export class Metrics {
  private samples: Sample[] = [];
  private errors = 0;
  private startTime = Date.now();

  record(sample: Sample): void {
    this.samples.push(sample);
    if (!sample.ok) this.errors++;
  }

  get total(): number {
    return this.samples.length;
  }

  get errorCount(): number {
    return this.errors;
  }

  get errorRate(): number {
    return this.total === 0 ? 0 : (this.errors / this.total) * 100;
  }

  get elapsedSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  get reqPerSecond(): number {
    const elapsed = this.elapsedSeconds;
    return elapsed === 0 ? 0 : this.total / elapsed;
  }

  percentile(p: number): number {
    const ok = this.samples.filter(s => s.ok).map(s => s.durationMs).sort((a, b) => a - b);
    if (ok.length === 0) return 0;
    const idx = Math.ceil((p / 100) * ok.length) - 1;
    return ok[Math.max(0, idx)];
  }

  byLabel(): Map<string, Sample[]> {
    const map = new Map<string, Sample[]>();
    for (const s of this.samples) {
      const arr = map.get(s.label) ?? [];
      arr.push(s);
      map.set(s.label, arr);
    }
    return map;
  }

  printSummary(): void {
    const elapsed = this.elapsedSeconds.toFixed(1);
    const rps = this.reqPerSecond.toFixed(2);
    const p50 = this.percentile(50).toFixed(0);
    const p95 = this.percentile(95).toFixed(0);
    const p99 = this.percentile(99).toFixed(0);
    const errRate = this.errorRate.toFixed(1);

    const width = 52;
    const line = '─'.repeat(width);
    console.log(`\n┌${line}┐`);
    console.log(`│${'  STRESS TEST SUMMARY'.padEnd(width)}│`);
    console.log(`├${line}┤`);
    row('Duration', `${elapsed}s`);
    row('Requests', String(this.total));
    row('Req/s', rps);
    row('Errors', `${this.errors} (${errRate}%)`);
    const statusCounts = this.statusCounts();
    if (statusCounts.size > 0) {
      row(
        'Statuses',
        Array.from(statusCounts.entries())
          .map(([status, count]) => `${status}:${count}`)
          .join(' '),
      );
    }
    console.log(`├${line}┤`);
    console.log(`│${'  Latency (successful requests only)'.padEnd(width)}│`);
    row('p50', `${p50} ms`);
    row('p95', `${p95} ms`);
    row('p99', `${p99} ms`);

    const byLabel = this.byLabel();
    if (byLabel.size > 1) {
      console.log(`├${line}┤`);
      console.log(`│${'  Per-scenario breakdown'.padEnd(width)}│`);
      for (const [label, samples] of byLabel) {
        const okSamples = samples.filter(s => s.ok).map(s => s.durationMs).sort((a, b) => a - b);
        const labelErrors = samples.filter(s => !s.ok).length;
        const lp50 = okSamples.length > 0 ? okSamples[Math.ceil(0.5 * okSamples.length) - 1] : 0;
        const lp95 = okSamples.length > 0 ? okSamples[Math.ceil(0.95 * okSamples.length) - 1] : 0;
        const statusStr = this.formatStatusCounts(samples);
        const errStr = labelErrors > 0 ? ` | err: ${labelErrors}` : '';
        row(label, `${samples.length} reqs | p50: ${lp50}ms | p95: ${lp95}ms | ${statusStr}${errStr}`);
      }
    }

    console.log(`└${line}┘\n`);

    function row(key: string, val: string) {
      const k = `  ${key}`.padEnd(20);
      const v = val.padStart(width - 20 - 2);
      console.log(`│${k}  ${v}│`);
    }
  }

  private statusCounts(): Map<number, number> {
    return this.countStatuses(this.samples);
  }

  private formatStatusCounts(samples: Sample[]): string {
    return Array.from(this.countStatuses(samples).entries())
      .map(([status, count]) => `${status}:${count}`)
      .join(' ');
  }

  private countStatuses(samples: Sample[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const sample of samples) {
      counts.set(sample.status, (counts.get(sample.status) ?? 0) + 1);
    }
    return new Map(Array.from(counts.entries()).sort(([a], [b]) => a - b));
  }
}
