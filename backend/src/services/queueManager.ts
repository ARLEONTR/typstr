import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../env.js';

const connection = new Redis(env.sessionRedisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

export const jobQueue = new Queue('typstr-jobs', { connection });
export const jobQueueEvents = new QueueEvents('typstr-jobs', { connection });

export const createWorker = (
  processor: (job: Job) => Promise<any>,
  concurrency: number
) => {
  return new Worker('typstr-jobs', processor, {
    connection,
    concurrency,
  });
};
