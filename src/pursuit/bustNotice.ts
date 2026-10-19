import type { TxResult } from '../garage/garageModel';

/*
 * The text of the busted notice (pure). It says where the car is and what the fine did. A failed save is said plainly,
 * with the reason the garage gives, which already says that nothing was charged.
 */

export function bustNoticeText(result: TxResult, percent: number): string {
  if (!result.ok) return `Busted. Back at the spawn. ${result.message}`;
  if (result.chargedCredits > 0) return `Busted. Back at the spawn. You lost ${result.chargedCredits} credits (${percent}%).`;
  return 'Busted. Back at the spawn. You had no credits to lose.';
}

/** The part of the garage service a busted fine needs. The garage service satisfies it. */
export interface BustFineSink {
  chargeBustFine(percent: number): TxResult;
}

/**
 * Charges the busted fine through the garage, and returns the notice text. App calls this once per busted session. It
 * is pure apart from the garage save, which the sink owns.
 */
export function bustFineNotice(sink: BustFineSink, percent: number): string {
  return bustNoticeText(sink.chargeBustFine(percent), percent);
}
