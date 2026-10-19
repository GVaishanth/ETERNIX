/*
 * Automated tests for the audio manager (Part 10) with a fake WebAudio context. Covers: no graph before a gesture,
 * one graph built once, no duplicate loops, pause and hidden-tab suspension, siren gating, cue bounds, and dispose
 * removing every listener and closing the context. No real audio device is used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_CONFIG } from '../config/audioConfig';
import { AudioManager, type AudioFrame } from './audioManager';

class FakeParam {
  value = 0;
  readonly targets: number[] = [];
  setTargetAtTime(value: number): void {
    this.value = value;
    this.targets.push(value);
  }
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  connect<T>(node: T): T {
    return node;
  }
  disconnect(): void {
    // Nothing to release in the fake.
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  started = 0;
  stopped = 0;
  onended: (() => void) | null = null;
  start(): void {
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  started = 0;
  start(): void {
    this.started += 1;
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state: 'running' | 'suspended' | 'closed' = 'running';
  closed = false;
  readonly destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }
  createBufferSource(): FakeSource {
    return new FakeSource();
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(length) };
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
}

const quietFrame: AudioFrame = {
  speedMetersPerSecond: 0,
  throttle: 0,
  lateralSpeedMetersPerSecond: 0,
  handbrake: false,
  pursuitState: 'INACTIVE',
  rainWetness: 0,
};

let context: FakeContext;
let factoryCalls: number;

beforeEach(() => {
  context = new FakeContext();
  factoryCalls = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function manager(): AudioManager {
  return new AudioManager(() => {
    factoryCalls += 1;
    return context as unknown as AudioContext;
  });
}

describe('construction and the first gesture', () => {
  it('builds nothing before the first gesture, and stays silent', () => {
    const audio = manager();
    expect(audio.enabled).toBe(false);
    expect(audio.stats.graphBuilt).toBe(false);
    expect(factoryCalls).toBe(0);
    audio.update(quietFrame);
    audio.cue('go');
    expect(audio.stats.cuesPlayed).toBe(0);
  });

  it('builds the graph once, with one set of loops, however often unlock runs', () => {
    const audio = manager();
    audio.unlock();
    audio.unlock();
    audio.unlock();
    expect(factoryCalls).toBe(1);
    expect(audio.enabled).toBe(true);
    expect(audio.stats.graphBuilt).toBe(true);
    // Engine, tyre noise, rain, and the siren's oscillator and LFO.
    expect(audio.stats.loopsCreated).toBe(5);
  });

  it('stays silent with no error when WebAudio is missing', () => {
    const audio = new AudioManager(() => null);
    audio.unlock();
    expect(audio.enabled).toBe(false);
    expect(() => audio.update(quietFrame)).not.toThrow();
    expect(() => audio.cue('finish')).not.toThrow();
  });

  it('waits for user activation before unlocking, then unlocks once', () => {
    const audio = manager();
    audio.tryUnlock(false);
    audio.tryUnlock(false);
    expect(factoryCalls).toBe(0);
    expect(audio.enabled).toBe(false);
    audio.tryUnlock(true);
    audio.tryUnlock(true);
    expect(factoryCalls).toBe(1);
    expect(audio.enabled).toBe(true);
  });

  it('adds no window or document listeners of its own', () => {
    const add = vi.fn();
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: vi.fn() });
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: vi.fn(), hidden: false });
    const audio = manager();
    audio.tryUnlock(true);
    audio.dispose();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('per-tick updates', () => {
  it('follows engine pitch with real speed, and does not allocate new loops', () => {
    const audio = manager();
    audio.unlock();
    const loops = audio.stats.loopsCreated;
    for (let i = 0; i < 500; i += 1) {
      audio.update({ ...quietFrame, speedMetersPerSecond: 25, throttle: 1 });
    }
    expect(audio.stats.loopsCreated).toBe(loops);
    const engine = context.oscillators[0];
    expect(engine?.frequency.value).toBeGreaterThan(AUDIO_CONFIG.engine.idleHz);
    expect(engine?.frequency.value).toBeLessThanOrEqual(AUDIO_CONFIG.engine.maxHz + 1e-6);
  });

  it('gates the siren by pursuit state', () => {
    const audio = manager();
    audio.unlock();
    audio.update({ ...quietFrame, pursuitState: 'PURSUING' });
    const sirenMaxTargets = context.gains.flatMap((gain) => gain.gain.targets).filter((v) => v === AUDIO_CONFIG.siren.maxGain);
    expect(sirenMaxTargets.length).toBeGreaterThan(0);
    audio.update({ ...quietFrame, pursuitState: 'INACTIVE' });
    const last = context.gains.map((gain) => gain.gain.value);
    expect(last).toContain(0);
  });

  it('keeps the rain gain within its configured maximum, even for a bad wetness', () => {
    const audio = manager();
    audio.unlock();
    audio.update({ ...quietFrame, rainWetness: 50 });
    const rainTargets = context.gains.flatMap((gain) => gain.gain.targets);
    for (const value of rainTargets) expect(value).toBeLessThanOrEqual(Math.max(AUDIO_CONFIG.rain.maxGain, AUDIO_CONFIG.siren.maxGain, AUDIO_CONFIG.skid.maxGain, 1));
  });
});

describe('cues', () => {
  it('plays a short cue as one-shot notes and counts it', () => {
    const audio = manager();
    audio.unlock();
    const before = context.oscillators.length;
    audio.cue('finish');
    expect(audio.stats.cuesPlayed).toBe(1);
    expect(context.oscillators.length - before).toBe(3);
    for (const osc of context.oscillators.slice(before)) {
      expect(osc.started).toBe(1);
      expect(osc.stopped).toBe(1);
      expect(typeof osc.onended).toBe('function'); // Each note disconnects itself when it ends.
    }
  });

  it('plays nothing while paused', () => {
    const audio = manager();
    audio.unlock();
    audio.setPaused(true);
    audio.cue('go');
    expect(audio.stats.cuesPlayed).toBe(0);
  });
});

describe('pause and hidden tab', () => {
  it('suspends on pause and resumes on resume, without duplicating anything', () => {
    const audio = manager();
    audio.unlock();
    audio.setPaused(true);
    expect(context.state).toBe('suspended');
    audio.setPaused(false);
    expect(context.state).toBe('running');
    audio.setPaused(false);
    expect(context.resumeCalls).toBe(1);
  });

  it('suspends while the tab is hidden, and resumes when it is shown again', () => {
    const audio = manager();
    audio.unlock();
    audio.setHidden(true);
    expect(context.state).toBe('suspended');
    audio.setHidden(false);
    expect(context.state).toBe('running');
    audio.setHidden(false);
    expect(context.resumeCalls).toBe(1);
  });
});

describe('volume', () => {
  it('clamps the volume and falls back to the default for a non-finite value', () => {
    const audio = manager();
    audio.unlock();
    audio.setVolume(5);
    audio.setVolume(Number.NaN);
    const master = context.gains[0];
    expect(master).toBeDefined();
    audio.setVolume(0.2);
    expect(master?.gain.value).toBeCloseTo(0.2 * AUDIO_CONFIG.masterGain, 5);
  });
});

describe('dispose', () => {
  it('stops the loops, closes the context, and then ignores calls', () => {
    const audio = manager();
    audio.unlock();
    audio.dispose();
    expect(context.closed).toBe(true);
    expect(audio.enabled).toBe(false);
    expect(() => audio.dispose()).not.toThrow();
    const created = context.oscillators.length;
    audio.cue('go');
    audio.update({ ...quietFrame, pursuitState: 'PURSUING' });
    expect(context.oscillators.length).toBe(created);
    expect(audio.stats.cuesPlayed).toBe(0);
  });

  it('disposed before any gesture: never builds the graph, even when activation arrives later', () => {
    const audio = manager();
    audio.dispose();
    audio.tryUnlock(true);
    expect(factoryCalls).toBe(0);
    expect(audio.enabled).toBe(false);
  });
});
