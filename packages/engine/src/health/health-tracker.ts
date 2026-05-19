export interface HealthSnapshot {
  timestamp: number;
  sleepHours?: number;
  sleepQuality?: number; // 1-5
  stressLevel?: number; // 1-10 (10 = very stressed)
  mood?: number; // 1-5
  caffeine?: boolean;
  exercise?: boolean;
  note?: string;
}

export interface HealthScore {
  overall: number; // 0-100
  components: {
    sleep: number;
    stress: number;
    mood: number;
    lifestyle: number;
  };
  tradingAdjustment: number; // multiplier: 0.5 - 1.0
  warning?: string;
}

export class HealthTracker {
  private snapshots: HealthSnapshot[] = [];
  private maxHistory = 30;

  recordSnapshot(snapshot: Omit<HealthSnapshot, "timestamp">): HealthSnapshot {
    const entry: HealthSnapshot = { ...snapshot, timestamp: Date.now() };
    this.snapshots.push(entry);
    if (this.snapshots.length > this.maxHistory) this.snapshots.shift();
    return entry;
  }

  getLatestScore(): HealthScore {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return this.defaultScore();
    return this.calculateScore(latest);
  }

  calculateScore(snapshot: HealthSnapshot): HealthScore {
    let sleepScore = 50;
    let stressScore = 50;
    let moodScore = 50;
    let lifestyleScore = 50;

    // Sleep (0-30 points)
    if (snapshot.sleepHours !== undefined) {
      if (snapshot.sleepHours >= 7.5) sleepScore = 100;
      else if (snapshot.sleepHours >= 7) sleepScore = 85;
      else if (snapshot.sleepHours >= 6) sleepScore = 60;
      else if (snapshot.sleepHours >= 5) sleepScore = 35;
      else sleepScore = 15;
    }
    if (snapshot.sleepQuality !== undefined) {
      sleepScore = sleepScore * 0.6 + (snapshot.sleepQuality / 5) * 100 * 0.4;
    }

    // Stress (0-30 points, inverted)
    if (snapshot.stressLevel !== undefined) {
      stressScore = Math.max(0, 100 - snapshot.stressLevel * 10);
    }

    // Mood (0-20 points)
    if (snapshot.mood !== undefined) {
      moodScore = (snapshot.mood / 5) * 100;
    }

    // Lifestyle (0-20 points)
    if (snapshot.exercise) lifestyleScore += 20;
    if (snapshot.caffeine && snapshot.stressLevel && snapshot.stressLevel > 6) {
      lifestyleScore -= 15; // caffeine + high stress = bad combo
    }

    lifestyleScore = Math.max(0, Math.min(100, lifestyleScore));

    const overall = Math.round(
      sleepScore * 0.35 +
      stressScore * 0.30 +
      moodScore * 0.20 +
      lifestyleScore * 0.15
    );

    // Trading adjustment factor
    let tradingAdjustment: number;
    let warning: string | undefined;

    if (overall >= 80) {
      tradingAdjustment = 1.0;
    } else if (overall >= 60) {
      tradingAdjustment = 0.85;
      warning = "Slightly suboptimal conditions — consider smaller positions";
    } else if (overall >= 40) {
      tradingAdjustment = 0.5;
      warning = "Below-average readiness — position sizes halved, avoid new entries if possible";
    } else {
      tradingAdjustment = 0.25;
      warning = "Poor trading readiness — strongly consider skipping today. Rest > profit.";
    }

    return {
      overall,
      components: {
        sleep: Math.round(sleepScore),
        stress: Math.round(stressScore),
        mood: Math.round(moodScore),
        lifestyle: Math.round(lifestyleScore),
      },
      tradingAdjustment,
      warning,
    };
  }

  getCorrelation(): { pattern: string; confidence: number } | null {
    if (this.snapshots.length < 7) return null;

    const recent = this.snapshots.slice(-14);
    const lowSleepDays = recent.filter((s) => (s.sleepHours ?? 7) < 6);
    const highStressDays = recent.filter((s) => (s.stressLevel ?? 5) >= 7);

    if (lowSleepDays.length >= 3) {
      return {
        pattern: `${lowSleepDays.length} days with <6h sleep in last 2 weeks`,
        confidence: 0.7,
      };
    }

    if (highStressDays.length >= 4) {
      return {
        pattern: `${highStressDays.length} high-stress days in last 2 weeks`,
        confidence: 0.65,
      };
    }

    return null;
  }

  getHistory(): HealthSnapshot[] {
    return [...this.snapshots];
  }

  private defaultScore(): HealthScore {
    return {
      overall: 70,
      components: { sleep: 70, stress: 70, mood: 70, lifestyle: 70 },
      tradingAdjustment: 1.0,
    };
  }

  toJSON() {
    return { snapshots: this.snapshots };
  }

  fromJSON(data: { snapshots: HealthSnapshot[] }): void {
    this.snapshots = data.snapshots ?? [];
  }
}
