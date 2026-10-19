import { AudioManager } from './audioManager';

/**
 * The one audio manager for the page, created on first use. It adds no listeners of its own: the render loop asks it to
 * unlock once the page has had a user gesture (see pageHasUserActivation), and the input controller reports tab
 * visibility. disposeAudioSession stops the loops and closes the context. The app calls it on unmount.
 */
let session: AudioManager | null = null;

export function getAudioSession(): AudioManager {
  if (!session) {
    session = new AudioManager();
  }
  return session;
}

/**
 * True once the page has had a user gesture (the browser's sticky activation). Browsers without the API are treated as
 * activated, so the audio starts on the first frame there. Plain read, no allocation.
 */
export function pageHasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return false;
  const activation = (navigator as { userActivation?: { readonly hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : true;
}

export function disposeAudioSession(): void {
  session?.dispose();
  session = null;
}
