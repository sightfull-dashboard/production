import { hostname } from 'node:os';
import { assertRuntimeConfiguration, env } from './src/server/config/env';
import { ensureBackgroundJobTables, claimNextBackgroundJob, markBackgroundJobCompleted, markBackgroundJobFailed, pruneCompletedBackgroundJobs } from './src/server/utils/backgroundJobs';
import { processBackgroundJob } from './src/server/workers/jobHandlers';

assertRuntimeConfiguration();

const workerId = process.env.BACKGROUND_WORKER_ID || `${hostname()}-${process.pid}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let shuttingDown = false;
process.on('SIGINT', () => { shuttingDown = true; });
process.on('SIGTERM', () => { shuttingDown = true; });

async function main() {
  await ensureBackgroundJobTables();
  console.log(`[WORKER] Started ${workerId} with provider=${env.databaseProvider}`);
  let pruneCounter = 0;

  while (!shuttingDown) {
    try {
      const job = await claimNextBackgroundJob(workerId);
      if (!job) {
        pruneCounter += 1;
        if (pruneCounter % 20 === 0) {
          await pruneCompletedBackgroundJobs().catch((error) => {
            console.warn('[WORKER] Failed to prune completed jobs:', error instanceof Error ? error.message : error);
          });
        }
        await sleep(env.workerPollIntervalMs);
        continue;
      }

      console.log(`[WORKER] Processing ${job.job_type} job ${job.id}`);
      try {
        const result = await processBackgroundJob(job);
        await markBackgroundJobCompleted(job.id, result);
        console.log(`[WORKER] Completed ${job.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WORKER] Failed ${job.id}:`, message);
        await markBackgroundJobFailed(job, message);
      }
    } catch (error) {
      console.error('[WORKER] Loop error:', error instanceof Error ? error.message : error);
      await sleep(Math.max(1000, env.workerPollIntervalMs));
    }
  }

  console.log('[WORKER] Shutting down');
}

main().catch((error) => {
  console.error('[WORKER] Fatal error:', error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
