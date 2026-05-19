/**
 * Local-time scheduler for periodic generation tasks (daily brief, weekly insights).
 *
 * The engine runs on the user's machine, so `new Date()` uses their system
 * timezone. We compute the next fire time in local time, then setTimeout to it,
 * then re-schedule after each fire.
 */

export interface ScheduledTask {
  id: string;
  schedule: "daily" | "weekly_sunday";
  localHour: number;       // 0-23 in user's local timezone
  localMinute: number;     // 0-59
  callback: () => Promise<void> | void;
  lastRun?: number;
  nextRun?: number;
}

export class LocalScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  /** Register a task that runs every day at the given local time. */
  registerDaily(id: string, hour: number, minute: number, callback: () => Promise<void> | void): void {
    this.register({ id, schedule: "daily", localHour: hour, localMinute: minute, callback });
  }

  /** Register a task that runs every Sunday at the given local time. */
  registerWeeklySunday(id: string, hour: number, minute: number, callback: () => Promise<void> | void): void {
    this.register({ id, schedule: "weekly_sunday", localHour: hour, localMinute: minute, callback });
  }

  private register(task: ScheduledTask): void {
    this.tasks.set(task.id, task);
    this.scheduleNext(task.id);
  }

  /**
   * Compute the next occurrence of the schedule in local time and arm setTimeout.
   * Returns the next-run epoch ms (also stored on the task).
   */
  private scheduleNext(taskId: string): number | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const now = new Date();
    const next = new Date(now);
    next.setHours(task.localHour, task.localMinute, 0, 0);

    if (task.schedule === "daily") {
      // If today's slot already passed, push to tomorrow
      if (next.getTime() <= now.getTime()) {
        next.setDate(next.getDate() + 1);
      }
    } else if (task.schedule === "weekly_sunday") {
      // Sunday = 0
      const dayOfWeek = next.getDay();
      const daysUntilSunday = dayOfWeek === 0
        ? (next.getTime() > now.getTime() ? 0 : 7)
        : (7 - dayOfWeek);
      next.setDate(next.getDate() + daysUntilSunday);
    }

    const delayMs = next.getTime() - now.getTime();
    task.nextRun = next.getTime();

    // Clear any existing timer
    const existing = this.timers.get(taskId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      try {
        await task.callback();
        task.lastRun = Date.now();
      } catch (err: any) {
        console.error(`[SCHEDULER] Task ${taskId} failed:`, err.message);
      }
      // Re-schedule for the next occurrence
      this.scheduleNext(taskId);
    }, delayMs);

    this.timers.set(taskId, timer);

    console.log(`[SCHEDULER] ${taskId} next run: ${next.toLocaleString()} (in ${(delayMs / 1000 / 60).toFixed(0)} min)`);
    return next.getTime();
  }

  /** Manually trigger a task immediately (useful for first-boot generation). */
  async runNow(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    try {
      await task.callback();
      task.lastRun = Date.now();
    } catch (err: any) {
      console.error(`[SCHEDULER] Manual run of ${taskId} failed:`, err.message);
    }
  }

  getTaskInfo(taskId: string): { lastRun?: number; nextRun?: number } | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return { lastRun: task.lastRun, nextRun: task.nextRun };
  }

  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
