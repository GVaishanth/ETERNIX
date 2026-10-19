/*
 * The ETERNIX wordmark: monoline letters drawn as strokes on a 24-unit cap height. Original letterforms for this
 * prototype, not a typeface, so there is no font file and no external resource. The stroke is the current text colour.
 */

interface WordmarkProps {
  readonly className?: string;
}

/** Each letter: its x offset and its stroke path, on a 24-unit grid with a 1.3-unit inset for the stroke. */
const LETTERS: ReadonlyArray<{ readonly x: number; readonly d: string }> = [
  { x: 0, d: 'M15 1.3H1.3V22.7H15M1.3 12H11.5' },
  { x: 23.5, d: 'M0 1.3H17M8.5 1.3V22.7' },
  { x: 49, d: 'M15 1.3H1.3V22.7H15M1.3 12H11.5' },
  { x: 72.5, d: 'M1.3 22.7V1.3H9.6A5.7 5.7 0 0 1 9.6 12.7H1.3M8.6 12.7L14.7 22.7' },
  { x: 97, d: 'M1.3 22.7V1.3L15.7 22.7V1.3' },
  { x: 122.5, d: 'M1.3 1.3V22.7' },
  { x: 133.6, d: 'M1.3 1.3L15.7 22.7M15.7 1.3L1.3 22.7' },
];

const WIDTH = 151.6;

export function Wordmark({ className }: WordmarkProps) {
  return (
    <svg className={className} viewBox={`-1.5 -1.5 ${WIDTH + 3} 27`} role="img" aria-label="ETERNIX" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="square" strokeLinejoin="miter">
        {LETTERS.map((letter) => (
          <path key={letter.x} transform={`translate(${letter.x} 0)`} d={letter.d} />
        ))}
      </g>
    </svg>
  );
}
