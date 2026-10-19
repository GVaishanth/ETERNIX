import { describe, expect, it } from 'vitest';
import { useDiagnosticsStore } from './diagnosticsStore';

describe('diagnostics panel visibility', () => {
  it('is hidden by default in every build', () => {
    expect(useDiagnosticsStore.getState().panelVisible).toBe(false);
  });

  it('toggles on each call', () => {
    const { togglePanel } = useDiagnosticsStore.getState();
    togglePanel();
    expect(useDiagnosticsStore.getState().panelVisible).toBe(true);
    useDiagnosticsStore.getState().togglePanel();
    expect(useDiagnosticsStore.getState().panelVisible).toBe(false);
  });
});
