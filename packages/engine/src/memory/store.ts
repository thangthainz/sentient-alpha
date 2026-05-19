import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { TradingMemory, MemoryCategory, MemoryContext, MemoryInsight } from "./types.js";

const MAX_STRATEGIES = 12;
const MAX_RULES = 10;
const MAX_OBSERVATIONS = 20;
const MAX_RESULTS = 50;
const RECENCY_DAYS = 60;

export class TradingMemoryStore {
  private memories: TradingMemory[] = [];
  private insights: MemoryInsight[] = [];
  private filePath: string;

  constructor(filePath = "./data/trading-memory.json") {
    this.filePath = filePath;
    this.load();
  }

  add(
    content: string,
    category: MemoryCategory,
    options: { pair?: string; tags?: string[]; importance?: number } = {}
  ): TradingMemory {
    const limit = this.getLimitForCategory(category);
    const existing = this.memories.filter((m) => m.category === category);
    if (existing.length >= limit) {
      const oldest = existing.sort((a, b) => a.createdAt - b.createdAt)[0];
      this.memories = this.memories.filter((m) => m.id !== oldest.id);
    }

    const memory: TradingMemory = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: content.slice(0, 500),
      category,
      createdAt: Date.now(),
      pair: options.pair,
      tags: options.tags,
      importance: Math.min(5, Math.max(1, options.importance ?? 3)),
    };

    this.memories.push(memory);
    this.save();
    return memory;
  }

  remove(id: string): boolean {
    const before = this.memories.length;
    this.memories = this.memories.filter((m) => m.id !== id);
    if (this.memories.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  search(query: string, limit = 10): TradingMemory[] {
    const lower = query.toLowerCase();
    return this.memories
      .filter((m) =>
        m.content.toLowerCase().includes(lower) ||
        m.pair?.toLowerCase().includes(lower) ||
        m.tags?.some((t) => t.toLowerCase().includes(lower))
      )
      .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  getContext(query?: string, pair?: string): MemoryContext {
    const now = Date.now();
    const recencyCutoff = now - RECENCY_DAYS * 86_400_000;

    const strategies = this.memories
      .filter((m) => m.category === "strategy")
      .sort((a, b) => b.importance - a.importance)
      .slice(0, MAX_STRATEGIES);

    const rules = this.memories
      .filter((m) => m.category === "rule")
      .sort((a, b) => b.importance - a.importance)
      .slice(0, MAX_RULES);

    let observations = this.memories
      .filter((m) => m.category === "observation" && m.createdAt > recencyCutoff);

    if (query || pair) {
      const searchTerms = [query, pair].filter(Boolean).map((s) => s!.toLowerCase());
      const matched = observations.filter((m) =>
        searchTerms.some(
          (term) =>
            m.content.toLowerCase().includes(term) ||
            m.pair?.toLowerCase().includes(term)
        )
      );
      if (matched.length > 0) observations = matched;
    }
    observations = observations
      .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
      .slice(0, 8);

    const recentResults = this.memories
      .filter((m) => m.category === "trade_result")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);

    return { strategies, rules, relevantObservations: observations, recentResults };
  }

  formatForPrompt(context: MemoryContext): string {
    const sections: string[] = [];

    if (context.strategies.length > 0) {
      sections.push("<strategies>");
      for (const m of context.strategies) {
        sections.push(`  - [importance:${m.importance}] ${m.content}`);
      }
      sections.push("</strategies>");
    }

    if (context.rules.length > 0) {
      sections.push("<rules>");
      for (const m of context.rules) {
        sections.push(`  - ${m.content}`);
      }
      sections.push("</rules>");
    }

    if (context.relevantObservations.length > 0) {
      sections.push("<observations>");
      for (const m of context.relevantObservations) {
        const date = new Date(m.createdAt).toISOString().slice(0, 10);
        const pairTag = m.pair ? ` [${m.pair}]` : "";
        sections.push(`  - [${date}${pairTag}] ${m.content}`);
      }
      sections.push("</observations>");
    }

    if (context.recentResults.length > 0) {
      sections.push("<recent_results>");
      for (const m of context.recentResults) {
        const date = new Date(m.createdAt).toISOString().slice(0, 10);
        sections.push(`  - [${date}] ${m.content}`);
      }
      sections.push("</recent_results>");
    }

    return sections.length > 0 ? `<trading_memory>\n${sections.join("\n")}\n</trading_memory>` : "";
  }

  addInsight(insight: MemoryInsight): void {
    this.insights.push(insight);
    if (this.insights.length > 20) this.insights.shift();
    this.save();
  }

  getInsights(): MemoryInsight[] {
    return [...this.insights];
  }

  getAll(): TradingMemory[] {
    return [...this.memories];
  }

  getStats() {
    const byCategory = new Map<MemoryCategory, number>();
    for (const m of this.memories) {
      byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
    }
    return {
      total: this.memories.length,
      byCategory: Object.fromEntries(byCategory),
      insights: this.insights.length,
    };
  }

  private getLimitForCategory(category: MemoryCategory): number {
    switch (category) {
      case "strategy": return MAX_STRATEGIES;
      case "rule": return MAX_RULES;
      case "observation": return MAX_OBSERVATIONS;
      case "trade_result": return MAX_RESULTS;
    }
  }

  private save(): void {
    try {
      const dir = this.filePath.replace(/[/\\][^/\\]+$/, "");
      if (!existsSync(dir)) {
        const { mkdirSync } = require("node:fs");
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        this.filePath,
        JSON.stringify({ memories: this.memories, insights: this.insights }, null, 2),
        "utf-8"
      );
    } catch (err: any) {
      console.error(`[MEMORY] Save failed: ${err.message}`);
    }
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, "utf-8"));
        this.memories = raw.memories ?? [];
        this.insights = raw.insights ?? [];
        console.log(`[MEMORY] Loaded ${this.memories.length} memories, ${this.insights.length} insights`);
      }
    } catch (err: any) {
      console.error(`[MEMORY] Load failed: ${err.message}`);
    }
  }
}
