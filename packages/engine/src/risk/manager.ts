import type { RiskParams, SignalScore, SetupDetection } from "@sentient-alpha/shared";
import { RISK } from "@sentient-alpha/shared";
import { BayesianTracker } from "./bayesian.js";

export class RiskManager {
  private bayes: BayesianTracker;
  private consecLosses = 0;
  private emergencyTs = 0;
  private portfolioValueUsd = 0;

  constructor(initialPortfolioUsd = 10000) {
    this.bayes = new BayesianTracker(3, 3);
    this.portfolioValueUsd = initialPortfolioUsd;
  }

  setPortfolioValue(usd: number): void {
    this.portfolioValueUsd = usd;
  }

  shouldTrade(setupType: string): { allowed: boolean; reason: string } {
    const cooldownHours = 4;

    if (this.consecLosses >= 7) {
      const now = Date.now();
      if (this.emergencyTs === 0) {
        this.emergencyTs = now;
        return { allowed: false, reason: `EMERGENCY: ${this.consecLosses} consecutive losses → ${cooldownHours}h cooldown` };
      }
      const elapsedH = (now - this.emergencyTs) / 3_600_000;
      if (elapsedH < cooldownHours) {
        return { allowed: false, reason: `EMERGENCY COOLDOWN: ${(cooldownHours - elapsedH).toFixed(1)}h remaining` };
      }
      this.consecLosses = 0;
      this.emergencyTs = 0;
    }

    const n = this.bayes.count(setupType);
    if (n < 10) return { allowed: true, reason: `Learning phase (${n}/10 trades)` };

    const wr = this.bayes.winrate(setupType);
    if (wr < 0.42) return { allowed: false, reason: `Low WR ${(wr * 100).toFixed(0)}% < 42%` };

    if (!this.bayes.edgeIntact(setupType)) {
      const recent = this.bayes.recentWinrate(setupType);
      return { allowed: false, reason: `Edge decay: recent ${((recent ?? 0) * 100).toFixed(0)}% << ${(wr * 100).toFixed(0)}%` };
    }

    if (this.consecLosses >= 4) {
      return { allowed: true, reason: `OK but reduce size (consec_losses=${this.consecLosses})` };
    }

    const [lo, hi] = this.bayes.confidenceInterval(setupType);
    return { allowed: true, reason: `OK: WR=${(wr * 100).toFixed(0)}% CI=[${(lo * 100).toFixed(0)}%,${(hi * 100).toFixed(0)}%] n=${n}` };
  }

  calcRiskParams(score: SignalScore, setup: SetupDetection): RiskParams {
    const rr = setup.entry > 0 && setup.stopLoss > 0 && setup.takeProfit > 0
      ? (setup.takeProfit - setup.entry) / (setup.entry - setup.stopLoss)
      : 2.0;

    const kellyPct = this.calcKelly(setup.type, rr, score.total);

    let positionSizePct = kellyPct / 100;
    if (this.consecLosses >= 4) positionSizePct *= 0.5;
    positionSizePct = Math.min(positionSizePct, RISK.MAX_POSITION_SIZE_PCT);

    const maxLossUsd = this.portfolioValueUsd * positionSizePct;

    return {
      positionSizePct,
      kellyFraction: kellyPct / 100,
      stopLossPrice: setup.stopLoss,
      takeProfitPrice: setup.takeProfit,
      riskRewardRatio: rr,
      maxLossUsd,
    };
  }

  private calcKelly(setupType: string, rr: number, signalScore: number): number {
    const wr = this.bayes.winrate(setupType);
    const n = this.bayes.count(setupType);

    if (n < 10) {
      return 0.5 + (signalScore / 33) * 0.25;
    }

    const fStar = wr - (1 - wr) / Math.max(rr, 0.1);
    if (fStar <= 0) return 0.5;

    let kelly = fStar * RISK.MIN_KELLY_FRACTION * 100;
    const multiplier = 0.7 + (signalScore / 33) * 0.6;
    kelly *= multiplier;

    if (this.consecLosses >= 4) kelly *= 0.5;

    return Math.max(0.25, Math.min(kelly, RISK.MAX_KELLY_FRACTION * 100));
  }

  recordResult(setupType: string, win: boolean): void {
    this.bayes.update(setupType, win);
    this.bayes.update("ALL", win);
    if (win) {
      this.consecLosses = 0;
    } else {
      this.consecLosses++;
    }
  }

  getStats() {
    return {
      consecLosses: this.consecLosses,
      portfolioValueUsd: this.portfolioValueUsd,
      allWinrate: this.bayes.winrate("ALL"),
      allCount: this.bayes.count("ALL"),
    };
  }

  toJSON() {
    return {
      bayes: this.bayes.toJSON(),
      consecLosses: this.consecLosses,
      emergencyTs: this.emergencyTs,
    };
  }

  fromJSON(data: { bayes: Record<string, any>; consecLosses: number; emergencyTs: number }): void {
    this.bayes.fromJSON(data.bayes);
    this.consecLosses = data.consecLosses;
    this.emergencyTs = data.emergencyTs;
  }
}
