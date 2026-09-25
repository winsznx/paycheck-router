import { createDb } from "../db/client.ts";
import type { InflowMessage } from "../do/inflow-watcher.ts";
import type { ExecutionMessage, VerifyMessage } from "../do/router-actor.ts";
import { inflowWatcher, routerActorFor } from "../do/stubs.ts";
import { createEngine } from "../engine/factory.ts";
import type { Env } from "../env.ts";
import { log } from "../log.ts";
import { deliver, type NotifyMessage } from "../notify/notifier.ts";

/** Queue names carry an environment prefix outside production (`staging-inflows`). */
function baseName(queue: string): string {
  return queue.replace(/^staging-/, "");
}

export async function handleInflow(env: Env, message: InflowMessage): Promise<void> {
  const actor = routerActorFor(env, message.routerId);
  const { handled } = await actor.candidate(message.hit);
  if (!handled) await inflowWatcher(env).release(message.hit.routerPda);
}

/** Executor: runs one paycheck's due legs through the SDK pipeline, one transaction at a time. */
export async function handleExecution(env: Env, message: ExecutionMessage): Promise<void> {
  const actor = routerActorFor(env, message.routerId);
  const jobs = await actor.jobs(message.seq, message.legIds);
  try {
    if (jobs.length > 0) {
      await createEngine(env).executeLegs(jobs, {
        executing: (job) => actor.legExecuting(job.legId),
        outcome: (job, outcome) => actor.legOutcome(job.legId, outcome),
      });
    }
  } finally {
    await actor.batchDone(message.seq);
  }
}

/** Verifier: independent readback and recomputation for one executed leg. */
export async function handleVerify(env: Env, message: VerifyMessage): Promise<void> {
  const actor = routerActorFor(env, message.routerId);
  const job = await actor.verifyJob(message.legId, message.signature, message.evidence);
  if (!job) return;
  const outcome = await createEngine(env).verifyLeg(job);
  await actor.legVerified(message.legId, outcome);
}

export async function handleQueue(batch: MessageBatch, env: Env): Promise<void> {
  const queue = baseName(batch.queue);
  for (const message of batch.messages) {
    try {
      switch (queue) {
        case "inflows":
          await handleInflow(env, message.body as InflowMessage);
          break;
        case "executions":
          await handleExecution(env, message.body as ExecutionMessage);
          break;
        case "verify":
          await handleVerify(env, message.body as VerifyMessage);
          break;
        case "notify":
          if (await deliver(env, createDb(env.HYPERDRIVE), message.body as NotifyMessage)) {
            message.retry({ delaySeconds: Math.min(300, 30 * 2 ** message.attempts) });
            continue;
          }
          break;
        default:
          if (queue.endsWith("-dlq")) {
            log.error("dead-letter message", { queue: batch.queue, body: message.body });
          } else {
            log.error("message on an unknown queue", { queue: batch.queue });
          }
      }
      message.ack();
    } catch (error) {
      log.error("queue message failed", { queue: batch.queue, attempts: message.attempts, error });
      message.retry({ delaySeconds: Math.min(60, 2 ** message.attempts) });
    }
  }
}
