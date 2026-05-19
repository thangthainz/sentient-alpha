export type MemoryCategory = "strategy" | "rule" | "observation" | "trade_result";

export interface TradingMemory {
  id: string;
  content: string;
  category: MemoryCategory;
  createdAt: number;
  pair?: string;
  tags?: string[];
  importance: number; // 1-5
}

export interface MemoryContext {
  strategies: TradingMemory[];
  rules: TradingMemory[];
  relevantObservations: TradingMemory[];
  recentResults: TradingMemory[];
}

export interface MemoryInsight {
  pattern: string;
  confidence: number;
  basedOn: string[];
  suggestion: string;
  createdAt: number;
}
