/**
 * Part 8 paint palette. A fixed list: no free colour picker, so every colour is a known value.
 *
 * Paint is cosmetic only. It recolors the body panels of the live car and the garage preview. It never changes
 * physics, and it does not touch glass, lights, indicators, cabin trim, or tires.
 */
export const PAINT_IDS = ['cherry', 'midnight', 'silver', 'pearl', 'lime', 'amber', 'slate', 'teal'] as const;
export type PaintId = (typeof PAINT_IDS)[number];

export interface PaintDefinition {
  readonly id: PaintId;
  readonly label: string;
  /** Hex colour applied to body-panel materials. */
  readonly color: string;
}

export const PAINT_PALETTE: readonly PaintDefinition[] = [
  { id: 'cherry', label: 'Cherry red', color: '#b3261e' },
  { id: 'midnight', label: 'Midnight blue', color: '#1d2a44' },
  { id: 'silver', label: 'Silver', color: '#b8bec6' },
  { id: 'pearl', label: 'Pearl white', color: '#e9e4d8' },
  { id: 'lime', label: 'Lime', color: '#6fae2c' },
  { id: 'amber', label: 'Amber', color: '#e0a100' },
  { id: 'slate', label: 'Slate grey', color: '#4f5b66' },
  { id: 'teal', label: 'Teal', color: '#127a7a' },
];

export function paintDefinition(id: string): PaintDefinition | null {
  return PAINT_PALETTE.find((paint) => paint.id === id) ?? null;
}
