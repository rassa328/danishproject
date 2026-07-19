import { describe, it, expect } from 'vitest';
import { UI } from './strings.ts';

// The flashcards empty state's {nextDue} phrase (Anki-style spaced repetition).
const label = UI.flashcards.nextDueLabel;

describe('nextDueLabel (days-until-due → Swedish)', () => {
  it('overdue / today', () => {
    expect(label(-3)).toBe('senare idag');
    expect(label(0)).toBe('senare idag');
  });

  it('tomorrow', () => {
    expect(label(1)).toBe('i morgon');
  });

  it('within the week (2–6 days)', () => {
    expect(label(2)).toBe('om 2 dagar');
    expect(label(6)).toBe('om 6 dagar');
  });

  it('about a week (7–13 days)', () => {
    expect(label(7)).toBe('om en vecka');
    expect(label(13)).toBe('om en vecka');
  });

  it('weeks out (14+), rounded to the nearest week', () => {
    expect(label(14)).toBe('om 2 veckor');
    expect(label(17)).toBe('om 2 veckor'); // round(17/7) = 2
    expect(label(18)).toBe('om 3 veckor'); // round(18/7) = 3
    expect(label(70)).toBe('om 10 veckor');
  });
});
