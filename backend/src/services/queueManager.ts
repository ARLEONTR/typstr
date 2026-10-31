import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../env.js';
import { logger } from '../logger.js';

const connection = new Redis(env.sessionRedisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Jobs carry whole projects and their results (compiled documents), and the
// queue shares Redis with the sessions. Kept forever they filled Redis, and a
// full Redis evicting keys with a TTL drops the sessions, logging users out.
// Waiters get their result through the events stream, so finished jobs are
// only kept briefly, and the stream itself is capped.
const COMPLETED_JOB_RETENTION = { age: 10 * 60, count: 50 };
const FAILED_JOB_RETENTION = { age: 24 * 60 * 60, count: 100 };
const EVENTS_MAX_LENGTH = 200;

export const jobQueue = new Queue('typstr-jobs', {
  connection,
  defaultJobOptions: {
    removeOnComplete: COMPLETED_JOB_RETENTION,
    removeOnFail: FAILED_JOB_RETENTION,
  },
  streams: { events: { maxLen: EVENTS_MAX_LENGTH } },
});
export const jobQueueEvents = new QueueEvents('typstr-jobs', { connection });

/** Drops finished jobs left over from before the retention limits. */
export async function cleanFinishedJobs(): Promise<void> {
  try {
    const completed = await jobQueue.clean(COMPLETED_JOB_RETENTION.age * 1000, 10_000, 'completed');
    const failed = await jobQueue.clean(FAILED_JOB_RETENTION.age * 1000, 10_000, 'failed');
    await jobQueue.trimEvents(EVENTS_MAX_LENGTH);
    if (completed.length + failed.length > 0) {
      logger.info(`[Queue] removed ${completed.length} completed and ${failed.length} failed old jobs`);
    }
  } catch (error) {
    logger.warning('[Queue] could not clean finished jobs', error);
  }
}

export const createWorker = (
  processor: (job: Job) => Promise<any>,
  concurrency: number
) => {
  return new Worker('typstr-jobs', processor, {
    connection,
    concurrency,
  });
};
