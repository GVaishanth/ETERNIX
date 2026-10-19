import { describe, expect, it } from 'vitest';
import { createGarageService } from '../garage/garageService';
import { createDefaultGarage, type TxResult } from '../garage/garageModel';
import type { StorageLike } from '../save/saveFile';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { bustFineNotice, bustNoticeText, type BustFineSink } from './bustNotice';

/*
 * The busted notice text and the busted fine, through the garage service. The notice says where the car is and what the
 * fine took. A failed save is said plainly, with the garage's reason.
 */

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.items.set(key, value);
  }
}

function okResult(charged: number): TxResult {
  return { ok: true, state: createDefaultGarage(), chargedCredits: charged, message: `Busted: lost ${charged} credits.` };
}

describe('bust notice text', () => {
  it('says the car is back at the spawn and what the fine took', () => {
    const text = bustNoticeText(okResult(600), 40);
    expect(text).toBe('Busted. Back at the spawn. You lost 600 credits (40%).');
  });

  it('says there was nothing to lose when the fine is zero', () => {
    expect(bustNoticeText(okResult(0), 40)).toBe('Busted. Back at the spawn. You had no credits to lose.');
  });

  it('says a failed save plainly, with the garage reason', () => {
    const failed: TxResult = { ok: false, code: 'save-failed', message: 'Could not save; nothing was charged.' };
    expect(bustNoticeText(failed, 40)).toBe('Busted. Back at the spawn. Could not save; nothing was charged.');
  });
});

describe('bust fine notice', () => {
  it('charges through the sink with the percent, and returns the text of that charge', () => {
    const asked: number[] = [];
    const sink: BustFineSink = {
      chargeBustFine: (percent) => {
        asked.push(percent);
        return okResult(360);
      },
    };
    expect(bustFineNotice(sink, 40)).toBe('Busted. Back at the spawn. You lost 360 credits (40%).');
    expect(asked).toEqual([40]);
  });

  it('the configured fine is 40 percent, the value the App charges', () => {
    expect(PURSUIT_CONFIG.capture.bustFinePercent).toBe(40);
  });

  it('through the real garage service: the balance drops by the fine and the text names it', () => {
    const service = createGarageService(new MemoryStorage(), { now: () => 1 });
    const before = service.getState().credits;
    const text = bustFineNotice(service, 40);
    const fine = Math.round((before * 40) / 100);
    expect(service.getState().credits).toBe(before - fine);
    expect(text).toBe(`Busted. Back at the spawn. You lost ${fine} credits (40%).`);
  });

  it('a failed save leaves the balance alone and says so in the text', () => {
    const storage = new MemoryStorage();
    const service = createGarageService(storage, { now: () => 1 });
    const before = service.getState().credits;
    storage.failWrites = true;
    const text = bustFineNotice(service, 40);
    expect(service.getState().credits).toBe(before);
    expect(text.startsWith('Busted. Back at the spawn. ')).toBe(true);
    expect(text).not.toContain('You lost');
  });
});
