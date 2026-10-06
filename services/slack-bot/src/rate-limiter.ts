/**
 * Per-thread rate limiter: 1 concurrent request per thread, queue others.
 * Also handles Slack 429 retry-after.
 */

type QueuedTask = {
  execute: () => Promise<void>;
  resolve: () => void;
};

const threadQueues = new Map<string, QueuedTask[]>();
const activeThreads = new Set<string>();

/**
 * Execute a task for a thread. If another task is running for the same thread,
 * queue this one and run it when the current one finishes.
 */
export function withThreadLock(threadKey: string, task: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const queued: QueuedTask = { execute: task, resolve };

    if (activeThreads.has(threadKey)) {
      // Queue it
      const queue = threadQueues.get(threadKey) || [];
      queue.push(queued);
      threadQueues.set(threadKey, queue);
      return;
    }

    // Run immediately
    activeThreads.add(threadKey);
    runTask(threadKey, queued);
  });
}

async function runTask(threadKey: string, task: QueuedTask) {
  try {
    await task.execute();
  } catch (err) {
    console.error(`[rate-limiter] Error in thread ${threadKey}:`, err);
  } finally {
    task.resolve();

    // Check queue
    const queue = threadQueues.get(threadKey);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) threadQueues.delete(threadKey);
      runTask(threadKey, next);
    } else {
      activeThreads.delete(threadKey);
      threadQueues.delete(threadKey);
    }
  }
}

/**
 * Sleep for retry-after seconds (Slack 429 handling).
 */
export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a Slack API call with 429 handling.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.data?.error === 'ratelimited' || err?.code === 429) {
        const retryAfter = (err?.data?.response_metadata?.retry_after || 1) * 1000;
        console.warn(`[rate-limiter] Slack 429, retrying in ${retryAfter}ms`);
        await sleepMs(retryAfter);
        continue;
      }
      throw err;
    }
  }
  return fn(); // Last attempt without catch
}
