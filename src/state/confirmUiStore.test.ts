import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirmUiStore, type ConfirmRequest } from './confirmUiStore';

function request(onConfirm: () => void): ConfirmRequest {
  return { title: 'Buy?', message: 'This costs 150 cr.', confirmLabel: 'Buy', cancelLabel: 'Cancel', onConfirm };
}

describe('confirm popup store', () => {
  beforeEach(() => {
    useConfirmUiStore.setState({ request: null });
  });

  it('opens a request and clears it on answer', () => {
    const onConfirm = vi.fn();
    useConfirmUiStore.getState().ask(request(onConfirm));
    expect(useConfirmUiStore.getState().request).not.toBeNull();
    useConfirmUiStore.getState().answer(true);
    expect(useConfirmUiStore.getState().request).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('runs nothing when the player cancels', () => {
    const onConfirm = vi.fn();
    useConfirmUiStore.getState().ask(request(onConfirm));
    useConfirmUiStore.getState().answer(false);
    expect(useConfirmUiStore.getState().request).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignores an answer when no request is open', () => {
    expect(() => useConfirmUiStore.getState().answer(true)).not.toThrow();
    expect(useConfirmUiStore.getState().request).toBeNull();
  });

  it('replaces an open request without running the old one', () => {
    const first = vi.fn();
    const second = vi.fn();
    useConfirmUiStore.getState().ask(request(first));
    useConfirmUiStore.getState().ask(request(second));
    useConfirmUiStore.getState().answer(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
