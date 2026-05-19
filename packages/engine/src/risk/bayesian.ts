export class BayesianTracker {
  private data: Map<string, { a: number; b: number; n: number; wins: number; recent: number[] }> = new Map();
  private a0: number;
  private b0: number;
  private maxRecent: number;

  constructor(alpha = 3, beta = 3, maxRecent = 50) {
    this.a0 = alpha;
    this.b0 = beta;
    this.maxRecent = maxRecent;
  }

  private init(key: string) {
    if (!this.data.has(key)) {
      this.data.set(key, { a: this.a0, b: this.b0, n: 0, wins: 0, recent: [] });
    }
  }

  update(key: string, win: boolean): void {
    this.init(key);
    const d = this.data.get(key)!;
    if (win) { d.a++; d.wins++; } else { d.b++; }
    d.n++;
    d.recent.push(win ? 1 : 0);
    if (d.recent.length > this.maxRecent) d.recent.shift();
  }

  winrate(key: string): number {
    this.init(key);
    const d = this.data.get(key)!;
    return d.a / (d.a + d.b);
  }

  confidenceInterval(key: string): [number, number] {
    this.init(key);
    const d = this.data.get(key)!;
    const mean = d.a / (d.a + d.b);
    const variance = (d.a * d.b) / ((d.a + d.b) ** 2 * (d.a + d.b + 1));
    const std = Math.sqrt(variance);
    return [Math.max(0, mean - 1.645 * std), Math.min(1, mean + 1.645 * std)];
  }

  recentWinrate(key: string): number | null {
    this.init(key);
    const r = this.data.get(key)!.recent;
    if (r.length < 10) return null;
    return r.reduce((a, b) => a + b, 0) / r.length;
  }

  edgeIntact(key: string): boolean {
    const recent = this.recentWinrate(key);
    if (recent === null) return true;
    return recent >= this.winrate(key) - 0.15;
  }

  count(key: string): number {
    this.init(key);
    return this.data.get(key)!.n;
  }

  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.data) out[k] = { ...v };
    return out;
  }

  fromJSON(data: Record<string, { a: number; b: number; n: number; wins: number; recent: number[] }>): void {
    for (const [k, v] of Object.entries(data)) {
      this.data.set(k, { ...v, recent: v.recent?.slice(-this.maxRecent) ?? [] });
    }
  }
}
