import { describe, expect, it } from 'vitest';

/*
 * Guards the prototype's copy. The interface must not use generic racing-game slogans. Any source file in this folder
 * is checked, except tests. If a phrase is banned by the art direction, add it here.
 */

const SOURCES: Record<string, string> = import.meta.glob(['./*.ts', './*.tsx', './*.css', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BANNED_PHRASES = [
  'build your machine',
  'own the streets',
  'define your legacy',
  'the city never sleeps',
  'city never sleeps',
  'your journey begins',
  'unleash your potential',
  'explore the garage',
];

describe('prototype copy', () => {
  it('reads at least one prototype source file', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(5);
  });

  it('contains none of the banned slogans', () => {
    for (const [file, text] of Object.entries(SOURCES)) {
      const lower = text.toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        expect(lower.includes(phrase), `${file} contains "${phrase}"`).toBe(false);
      }
    }
  });

  it('uses the functional labels', () => {
    const page = SOURCES['./EternixPrototype.tsx'] ?? '';
    expect(page).toContain('ENTER GAME');
    expect(page).toContain('GARAGE');
    expect(page).toContain('DRIVE WITHOUT END');
  });

  it('has one garage entry point, the button below ENTER GAME', () => {
    const page = SOURCES['./EternixPrototype.tsx'] ?? '';
    expect(page).not.toContain('ex-navlink');
    expect(page.split('ex-btn-outline').length - 1).toBe(1);
  });
});
