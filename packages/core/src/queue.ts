import { Queue, Worker, type Processor, type WorkerOptions, type QueueOptions } from "bullmq";
import { Redis } from "ioredis";

import { QUEUE_NAMES } from "./constants.js";
import type { QueuePayloadMap } from "./jobs.js";

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export function createQueue(
  name: keyof QueuePayloadMap,
  redisUrl: string,
  opts?: Omit<QueueOptions, "connection">,
): Queue {
  return new Queue(name, {
    ...opts,
    connection: createRedisConnection(redisUrl),
  });
}

export function createWorker(
  name: keyof QueuePayloadMap,
  redisUrl: string,
  processor: Processor<any, any, string>,
  opts?: Omit<WorkerOptions, "connection">,
): Worker {
  return new Worker(name, processor, {
    ...opts,
    connection: createRedisConnection(redisUrl),
  });
}

export const queueNameValues = Object.values(QUEUE_NAMES);
