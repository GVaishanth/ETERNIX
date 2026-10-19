/*
 * Part 10 audio manager. One WebAudio graph, built once, on the first user gesture (browsers block audio before that).
 * Every sound is synthesized, so there are no audio files and nothing can fail to load. If WebAudio is missing, every
 * method is a silent no-op. Loops are created once and only their parameters change, so nothing duplicates.
 */
import { AUDIO_CONFIG } from '../config/audioConfig';
import { CUE_GAIN, CUE_NOTES, engineTone, skidLevel, sirenOn, type CueId } from './audioModel';

export type ContextFactory = () => AudioContext | null;

/** What the render loop reports each tick. Plain numbers and booleans, so the tick allocates nothing. */
export interface AudioFrame {
  readonly speedMetersPerSecond: number;
  readonly throttle: number;
  readonly lateralSpeedMetersPerSecond: number;
  readonly handbrake: boolean;
  readonly pursuitState: string;
  readonly rainWetness: number;
}

/** Counts of graph objects created. Tests use it to prove loops are not duplicated. */
export interface AudioStats {
  loopsCreated: number;
  cuesPlayed: number;
  graphBuilt: boolean;
}

const PARAM_SMOOTHING_SECONDS = 0.08;

function browserContextFactory(): ContextFactory {
  return () => {
    const w = typeof window !== 'undefined' ? (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }) : null;
    const Ctor = w ? (w.AudioContext ?? w.webkitAudioContext) : undefined;
    if (!Ctor) return null;
    try {
      return new Ctor();
    } catch {
      return null;
    }
  };
}

export class AudioManager {
  readonly stats: AudioStats = { loopsCreated: 0, cuesPlayed: 0, graphBuilt: false };
  /** The levels last sent to the loops. Updated in place each tick, for the DEV read-out and tests. */
  readonly live = { engineHz: 0, engineGain: 0, skidLevel: 0, rainGain: 0, sirenOn: false };
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenOscillator: OscillatorNode | null = null;
  private sirenLfo: OscillatorNode | null = null;
  private sirenIsOn = false;
  private paused = false;
  private hidden = false;
  private volume: number = AUDIO_CONFIG.defaultVolume;
  private disposed = false;
  /** True once an unlock was attempted. The attempt happens once, so a missing WebAudio is not retried every frame. */
  private unlocked = false;
  private readonly factory: ContextFactory;

  /**
   * The manager adds no global listeners of its own. The project keeps one set of window and document listeners (the
   * input controller). The render loop asks for the unlock (`tryUnlock`), and the input controller reports tab
   * visibility (`setHidden`).
   */
  constructor(factory: ContextFactory = browserContextFactory()) {
    this.factory = factory;
  }

  /** The WebAudio context state, or null before the first gesture. For the DEV read-out and tests. */
  get contextState(): string | null {
    return this.ctx ? this.ctx.state : null;
  }

  /** True once a context exists and is not disposed. False when WebAudio is missing, so the game stays silent. */
  get enabled(): boolean {
    return this.ctx !== null && !this.disposed;
  }

  /**
   * Unlocks once the page has had a user gesture. The render loop calls this every frame, and it does nothing until
   * `hasUserActivation` is true. After that the first call builds the graph, and later calls return at once.
   */
  tryUnlock(hasUserActivation: boolean): void {
    if (!hasUserActivation) return;
    this.unlock();
  }

  /** Creates the context and the graph. Idempotent. Browsers allow the context to run only after a user gesture. */
  unlock(): void {
    if (this.disposed || this.unlocked) return;
    this.unlocked = true;
    const ctx = this.factory();
    if (!ctx) return;
    this.ctx = ctx;
    this.buildGraph(ctx);
    this.applySuspension();
  }

  /** Tab visibility, reported by the input controller's single visibility listener. A hidden tab suspends the audio. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.applySuspension();
  }

  /** Per-tick update from real vehicle and pursuit state. Parameter changes only. */
  update(frame: AudioFrame): void {
    if (!this.ctx || this.disposed) return;
    const t = this.ctx.currentTime;
    const tone = engineTone(frame.speedMetersPerSecond, frame.throttle);
    this.setParam(this.engineOsc?.frequency, tone.frequencyHz, t);
    this.setParam(this.engineFilter?.frequency, tone.filterHz, t);
    this.setParam(this.engineGain?.gain, tone.gain, t);
    const skid = skidLevel(frame.lateralSpeedMetersPerSecond, frame.handbrake, frame.speedMetersPerSecond);
    this.setParam(this.skidGain?.gain, skid * AUDIO_CONFIG.skid.maxGain, t);
    const rainGain = Math.min(1, Math.max(0, frame.rainWetness)) * AUDIO_CONFIG.rain.maxGain;
    this.setParam(this.rainGain?.gain, rainGain, t);
    this.setSiren(sirenOn(frame.pursuitState));
    this.live.engineHz = tone.frequencyHz;
    this.live.engineGain = tone.gain;
    this.live.skidLevel = skid;
    this.live.rainGain = rainGain;
    this.live.sirenOn = this.sirenIsOn;
  }

  /** Plays a short cue, a sequence of notes. Each note is a one-shot node that disconnects itself when it ends. */
  cue(id: CueId): void {
    if (!this.ctx || this.disposed || this.paused) return;
    const ctx = this.ctx;
    const notes = CUE_NOTES[id];
    const start = ctx.currentTime;
    const noteLength = 0.09;
    notes.forEach((hz, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const at = start + index * noteLength;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(CUE_GAIN * this.volume, at + 0.01);
      gain.gain.linearRampToValueAtTime(0, at + noteLength);
      osc.connect(gain);
      if (this.master) gain.connect(this.master);
      osc.start(at);
      osc.stop(at + noteLength + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
    this.stats.cuesPlayed += 1;
  }

  /** Pause and resume follow the game's pause. Suspends the context, so nothing keeps playing behind the menu. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.applySuspension();
  }

  /** The user's volume, 0..1. Applied to the master gain, so every sound follows it. */
  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : AUDIO_CONFIG.defaultVolume;
    if (this.master && this.ctx) this.setParam(this.master.gain, this.volume * AUDIO_CONFIG.masterGain, this.ctx.currentTime);
  }

  /** Stops every node, closes the context, and removes every listener. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const stopSafe = (node: { stop?: (when?: number) => void; disconnect: () => void } | null) => {
      if (!node) return;
      try {
        node.stop?.();
      } catch {
        // Already stopped.
      }
      node.disconnect();
    };
    stopSafe(this.engineOsc);
    stopSafe(this.sirenOscillator);
    stopSafe(this.sirenLfo);
    this.engineOsc = null;
    this.sirenOscillator = null;
    this.sirenLfo = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.master = null;
  }


  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = this.volume * AUDIO_CONFIG.masterGain;
    master.connect(ctx.destination);
    this.master = master;

    // Engine: one sawtooth through a low-pass. Pitch and filter follow real speed each tick.
    const engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = AUDIO_CONFIG.engine.idleHz;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = AUDIO_CONFIG.engine.filterMinHz;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter).connect(engineGain).connect(master);
    engineOsc.start();
    this.engineOsc = engineOsc;
    this.engineFilter = engineFilter;
    this.engineGain = engineGain;
    this.stats.loopsCreated += 1;

    // Tyre noise: a looping noise buffer through a band-pass. Gain follows real lateral slip and the handbrake.
    const skidSource = ctx.createBufferSource();
    skidSource.buffer = noiseBuffer(ctx);
    skidSource.loop = true;
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1200;
    const skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    skidSource.connect(skidFilter).connect(skidGain).connect(master);
    skidSource.start();
    this.skidGain = skidGain;
    this.stats.loopsCreated += 1;

    // Rain: a second looping noise, low-passed and quiet. Its gain follows the weather's wetness.
    const rainSource = ctx.createBufferSource();
    rainSource.buffer = noiseBuffer(ctx);
    rainSource.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'lowpass';
    rainFilter.frequency.value = 900;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSource.connect(rainFilter).connect(rainGain).connect(master);
    rainSource.start();
    this.rainGain = rainGain;
    this.stats.loopsCreated += 1;

    // Siren: one oscillator, always running, whose gain is gated by the pursuit state. A slow LFO sweeps its pitch.
    const sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    const sirenCenter = (AUDIO_CONFIG.siren.lowHz + AUDIO_CONFIG.siren.highHz) / 2;
    sirenOsc.frequency.value = sirenCenter;
    const sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'sine';
    sirenLfo.frequency.value = 1 / AUDIO_CONFIG.siren.sweepSeconds;
    const sirenDepth = ctx.createGain();
    sirenDepth.gain.value = (AUDIO_CONFIG.siren.highHz - AUDIO_CONFIG.siren.lowHz) / 2;
    sirenLfo.connect(sirenDepth).connect(sirenOsc.frequency);
    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain).connect(master);
    sirenOsc.start();
    sirenLfo.start();
    this.sirenOscillator = sirenOsc;
    this.sirenLfo = sirenLfo;
    this.sirenGain = sirenGain;
    this.stats.loopsCreated += 2;
    this.stats.graphBuilt = true;
  }

  private setSiren(on: boolean): void {
    if (!this.ctx || !this.sirenGain || on === this.sirenIsOn) return;
    this.sirenIsOn = on;
    const level = on ? AUDIO_CONFIG.siren.maxGain : 0;
    this.setParam(this.sirenGain.gain, level, this.ctx.currentTime);
  }

  private applySuspension(): void {
    if (!this.ctx || this.disposed) return;
    const shouldRun = !this.paused && !this.hidden;
    if (shouldRun && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    if (!shouldRun && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  private setParam(param: AudioParam | undefined, value: number, time: number): void {
    if (!param) return;
    param.setTargetAtTime(value, time, PARAM_SMOOTHING_SECONDS);
  }
}

/** A short white-noise buffer, shared by the loops that need noise. Created once per context. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 1.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}
