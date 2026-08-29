import { AsyncLocalStorage } from 'node:async_hooks';

/** @public */
export interface OperationalExecutionContext {
  readonly runId: string;
  readonly traceId: string;
  readonly pluginId?: string;
  readonly contributionId?: string;
}

const storage = new AsyncLocalStorage<OperationalExecutionContext>();

function normalized(context: OperationalExecutionContext): OperationalExecutionContext {
  return Object.freeze({
    runId: context.runId,
    traceId: context.traceId,
    ...(context.pluginId === undefined ? {} : { pluginId: context.pluginId }),
    ...(context.contributionId === undefined ? {} : { contributionId: context.contributionId }),
  });
}

/** @public */
export function runWithExecutionContext<T>(
  context: OperationalExecutionContext,
  operation: () => T,
): T {
  return storage.run(normalized(context), operation);
}

/** @public */
export function currentExecutionContext(): OperationalExecutionContext | undefined {
  return storage.getStore();
}
