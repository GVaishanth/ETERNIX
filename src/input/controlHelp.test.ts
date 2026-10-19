import { describe, expect, it } from 'vitest';
import { CONTROL_HELP } from './controlHelp';

describe('control help', () => {
  it('has the driving and game groups, with every row filled in', () => {
    expect(CONTROL_HELP.map((group) => group.title)).toEqual(['Drive', 'Game']);
    for (const group of CONTROL_HELP) {
      expect(group.rows.length).toBeGreaterThan(0);
      for (const row of group.rows) {
        expect(row.keys.trim()).not.toBe('');
        expect(row.label.trim()).not.toBe('');
      }
    }
  });

  it('does not list the diagnostics shortcut, which stays hidden', () => {
    const text = JSON.stringify(CONTROL_HELP);
    expect(text).not.toContain('diagnostic');
    expect(text).not.toContain('Shift');
  });
});
