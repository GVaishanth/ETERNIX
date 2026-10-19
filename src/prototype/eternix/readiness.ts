/*
 * The readiness runner for the ETERNIX loading prototype. Pure: no React, no DOM, no game imports, so it can be tested
 * in node. Each step is a real operation that either completes or fails. Progress is the count of completed steps.
 * There are no timers, percentages, or artificial delays here.
 */

export type StepStatus = 'waiting' | 'working' | 'done' | 'failed';

export interface ReadinessStep {
  readonly id: string;
  readonly label: string;
  /** Performs the real work. Resolves with a short detail for the player, or rejects with the reason. */
  readonly run: (signal: AbortSignal) => Promise<string>;
}

export interface StepSnapshot {
  readonly id: string;
  readonly label: string;
  readonly status: StepStatus;
  readonly detail: string | null;
  readonly error: string | null;
}

export type ReadinessOutcome = 'ready' | 'failed' | 'cancelled';

/** Turns any thrown value into a readable message. Never returns an empty string. */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  if (typeof error === 'string' && error.trim() !== '') return error;
  return 'An unknown error stopped this step.';
}

/** Steps that have completed. A failed or cancelled run stops short of the total. */
export function completedCount(steps: readonly StepSnapshot[]): number {
  return steps.filter((step) => step.status === 'done').length;
}

/**
 * Runs the steps in order. Each step starts only after the one before it has completed. A failure stops the run and
 * leaves the later steps waiting. Cancelling stops the run at the next boundary and never starts another step.
 */
export async function runReadiness(
  steps: readonly ReadinessStep[],
  onChange: (snapshot: readonly StepSnapshot[]) => void,
  signal: AbortSignal,
): Promise<ReadinessOutcome> {
  const state: StepSnapshot[] = steps.map((step) => ({ id: step.id, label: step.label, status: 'waiting', detail: null, error: null }));
  const emit = (): void => onChange(state.map((step) => ({ ...step })));
  const patch = (index: number, change: Partial<Omit<StepSnapshot, 'id' | 'label'>>): void => {
    const current = state[index];
    if (!current) throw new Error(`readiness: no step at index ${index}`);
    state[index] = { ...current, ...change };
    emit();
  };

  emit();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step) throw new Error(`readiness: no step at index ${index}`);
    if (signal.aborted) return 'cancelled';
    patch(index, { status: 'working' });
    try {
      const detail = await step.run(signal);
      if (signal.aborted) return 'cancelled';
      patch(index, { status: 'done', detail });
    } catch (error) {
      if (signal.aborted) return 'cancelled';
      patch(index, { status: 'failed', error: messageOf(error) });
      return 'failed';
    }
  }
  return 'ready';
}

