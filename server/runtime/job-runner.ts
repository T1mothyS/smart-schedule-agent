import cron from 'node-cron';

export interface JobDefinition {
  name: string;
  expression: string;
  timezone?: string;
  run: () => void | Promise<void>;
}
type Task = { stop(): void | Promise<void>; destroy(): void | Promise<void> };
export type ScheduleJob = (job: JobDefinition, run: () => Promise<void>) => Task;

export function createJobRunner(
  definitions: JobDefinition[],
  onError: (name: string, error: unknown) => void,
  schedule: ScheduleJob = (job, run) => cron.schedule(job.expression, run, { timezone: job.timezone }),
) {
  let tasks: Task[] = [];
  let running = false;
  let stopping: Promise<void> | undefined;
  const active = new Set<Promise<void>>();
  async function stop(): Promise<void> {
    if (stopping) return stopping;
    running = false;
    const owned = tasks;
    tasks = [];
    stopping = (async () => {
      try {
        // Stop scheduling first; already accepted work drains before shutdown completes.
        const results = await Promise.allSettled(owned.map(async task => {
          try { await task.stop(); } finally { await task.destroy(); }
        }));
        await Promise.allSettled([...active]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      } finally { stopping = undefined; }
    })();
    return stopping;
  }
  return {
    get running() { return running; },
    start() {
      if (stopping) throw new Error('Background jobs are still stopping');
      if (running) return;
      running = true;
      try {
        for (const job of definitions) tasks.push(schedule(job, () => {
          if (!running) return Promise.resolve();
          const work = Promise.resolve().then(job.run).catch(error => onError(job.name, error));
          active.add(work);
          void work.then(() => active.delete(work), () => active.delete(work));
          return work;
        }));
      } catch (error) {
        void stop().catch(failure => onError('stop-after-start-failure', failure));
        throw error;
      }
    },
    stop,
  };
}
