import type {
  Position,
  TradeOrder,
  SignalScore,
  SetupDetection,
  RiskParams,
  DecisionLog,
  SignalDirection,
} from "@sentient-alpha/shared";

export interface PaperTrade {
  id: string;
  pair: string;
  direction: SignalDirection;
  entryPrice: number;
  entryTime: number;
  exitPrice?: number;
  exitTime?: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  pnl?: number;
  pnlPct?: number;
  win?: boolean;
  exitReason?: string;
  score: SignalScore;
  risk: RiskParams;
}

export interface PaperPortfolio {
  initialCapital: number;
  currentCapital: number;
  openPositions: PaperTrade[];
  closedTrades: PaperTrade[];
  totalPnl: number;
  winCount: number;
  lossCount: number;
  maxDrawdown: number;
  peakCapital: number;
}

export class PaperTrader {
  private portfolio: PaperPortfolio;
  private maxConcurrent: number;

  constructor(initialCapital = 10000, maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.portfolio = {
      initialCapital,
      currentCapital: initialCapital,
      openPositions: [],
      closedTrades: [],
      totalPnl: 0,
      winCount: 0,
      lossCount: 0,
      maxDrawdown: 0,
      peakCapital: initialCapital,
    };
  }

  canOpenPosition(): boolean {
    return this.portfolio.openPositions.length < this.maxConcurrent;
  }

  openPosition(
    pair: string,
    direction: SignalDirection,
    entryPrice: number,
    score: SignalScore,
    risk: RiskParams
  ): PaperTrade | null {
    if (!this.canOpenPosition()) return null;

    const sizeUsd = this.portfolio.currentCapital * risk.positionSizePct;

    const trade: PaperTrade = {
      id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pair,
      direction,
      entryPrice,
      entryTime: Date.now(),
      stopLoss: risk.stopLossPrice,
      takeProfit: risk.takeProfitPrice,
      sizeUsd,
      score,
      risk,
    };

    this.portfolio.openPositions.push(trade);
    console.log(`[PAPER] OPEN ${direction} ${pair} @ ${entryPrice.toFixed(6)} | Size: $${sizeUsd.toFixed(2)} | SL: ${risk.stopLossPrice.toFixed(6)} TP: ${risk.takeProfitPrice.toFixed(6)}`);
    return trade;
  }

  updatePositions(prices: Map<string, number>): PaperTrade[] {
    const closed: PaperTrade[] = [];

    this.portfolio.openPositions = this.portfolio.openPositions.filter((trade) => {
      const currentPrice = prices.get(trade.pair);
      if (currentPrice === undefined) return true;

      let shouldClose = false;
      let exitReason = "";

      if (trade.direction === "LONG") {
        if (currentPrice <= trade.stopLoss) {
          shouldClose = true;
          exitReason = "STOP_LOSS";
        } else if (currentPrice >= trade.takeProfit) {
          shouldClose = true;
          exitReason = "TAKE_PROFIT";
        }
      } else {
        if (currentPrice >= trade.stopLoss) {
          shouldClose = true;
          exitReason = "STOP_LOSS";
        } else if (currentPrice <= trade.takeProfit) {
          shouldClose = true;
          exitReason = "TAKE_PROFIT";
        }
      }

      if (shouldClose) {
        this.closePosition(trade, currentPrice, exitReason);
        closed.push(trade);
        return false;
      }
      return true;
    });

    return closed;
  }

  closePosition(trade: PaperTrade, exitPrice: number, reason: string): void {
    trade.exitPrice = exitPrice;
    trade.exitTime = Date.now();
    trade.exitReason = reason;

    const priceDelta = trade.direction === "LONG"
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;
    trade.pnlPct = priceDelta / trade.entryPrice;
    trade.pnl = trade.sizeUsd * trade.pnlPct;
    trade.win = trade.pnl > 0;

    this.portfolio.currentCapital += trade.pnl;
    this.portfolio.totalPnl += trade.pnl;

    if (trade.win) this.portfolio.winCount++;
    else this.portfolio.lossCount++;

    if (this.portfolio.currentCapital > this.portfolio.peakCapital) {
      this.portfolio.peakCapital = this.portfolio.currentCapital;
    }
    const drawdown = (this.portfolio.peakCapital - this.portfolio.currentCapital) / this.portfolio.peakCapital;
    if (drawdown > this.portfolio.maxDrawdown) {
      this.portfolio.maxDrawdown = drawdown;
    }

    this.portfolio.closedTrades.push(trade);

    const emoji = trade.win ? "+" : "";
    console.log(`[PAPER] CLOSE ${trade.pair} @ ${exitPrice.toFixed(6)} | ${reason} | PnL: ${emoji}$${trade.pnl.toFixed(2)} (${(trade.pnlPct * 100).toFixed(2)}%)`);
  }

  forceCloseAll(prices: Map<string, number>): void {
    for (const trade of [...this.portfolio.openPositions]) {
      const price = prices.get(trade.pair) ?? trade.entryPrice;
      this.closePosition(trade, price, "FORCE_CLOSE");
    }
    this.portfolio.openPositions = [];
  }

  getPortfolio(): PaperPortfolio {
    return { ...this.portfolio };
  }

  getStats() {
    const total = this.portfolio.winCount + this.portfolio.lossCount;
    const winRate = total > 0 ? this.portfolio.winCount / total : 0;
    const avgWin = this.portfolio.closedTrades
      .filter((t) => t.win)
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0) / Math.max(this.portfolio.winCount, 1);
    const avgLoss = this.portfolio.closedTrades
      .filter((t) => !t.win)
      .reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0) / Math.max(this.portfolio.lossCount, 1);

    return {
      totalTrades: total,
      winRate,
      winCount: this.portfolio.winCount,
      lossCount: this.portfolio.lossCount,
      totalPnl: this.portfolio.totalPnl,
      totalPnlPct: (this.portfolio.totalPnl / this.portfolio.initialCapital) * 100,
      maxDrawdown: this.portfolio.maxDrawdown * 100,
      currentCapital: this.portfolio.currentCapital,
      avgWin,
      avgLoss,
      profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
      sharpeEstimate: total > 10
        ? (winRate * avgWin - (1 - winRate) * avgLoss) /
          Math.sqrt(this.portfolio.closedTrades.reduce((s, t) => s + ((t.pnl ?? 0) ** 2), 0) / total)
        : 0,
    };
  }

  toJSON() {
    return this.portfolio;
  }

  fromJSON(data: PaperPortfolio): void {
    this.portfolio = { ...data };
  }
}
