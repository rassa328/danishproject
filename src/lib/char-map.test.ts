import { describe, it, expect } from 'vitest';
import { mapToDanishChars, remapWithCaret } from './char-map.ts';

describe('mapToDanishChars', () => {
  it('maps ä→æ and ö→ø', () => {
    expect(mapToDanishChars('läse')).toBe('læse');
    expect(mapToDanishChars('grön')).toBe('grøn');
    expect(mapToDanishChars('äö')).toBe('æø');
  });

  it('maps uppercase Ä→Æ and Ö→Ø', () => {
    expect(mapToDanishChars('Äble')).toBe('Æble');
    expect(mapToDanishChars('ÖRE')).toBe('ØRE');
  });

  it('leaves å and Å untouched', () => {
    expect(mapToDanishChars('gå på')).toBe('gå på');
    expect(mapToDanishChars('Århus')).toBe('Århus');
  });

  it('alters nothing else and keeps the length (1:1 codepoints)', () => {
    const s = 'abc ÆØÅ æøå 123 !? ü';
    expect(mapToDanishChars(s)).toBe(s);
    expect(mapToDanishChars('äÄöÖ')).toHaveLength(4);
    expect(mapToDanishChars('')).toBe('');
  });

  it('is idempotent', () => {
    const once = mapToDanishChars('sälör ÄÖ å');
    expect(mapToDanishChars(once)).toBe(once);
  });
});

describe('remapWithCaret', () => {
  it('keeps caret at start/middle/end when nothing is mapped', () => {
    expect(remapWithCaret('hund', 0)).toEqual({ value: 'hund', caret: 0 });
    expect(remapWithCaret('hund', 2)).toEqual({ value: 'hund', caret: 2 });
    expect(remapWithCaret('hund', 4)).toEqual({ value: 'hund', caret: 4 });
  });

  it('keeps caret at start/middle/end when chars are mapped', () => {
    expect(remapWithCaret('läsö', 0)).toEqual({ value: 'læsø', caret: 0 });
    // Caret just after the mapped ä — the typical mid-word typing position.
    expect(remapWithCaret('läsö', 2)).toEqual({ value: 'læsø', caret: 2 });
    expect(remapWithCaret('läsö', 4)).toEqual({ value: 'læsø', caret: 4 });
  });

  it('handles the empty input', () => {
    expect(remapWithCaret('', 0)).toEqual({ value: '', caret: 0 });
  });

  it('clamps an out-of-range caret to the string bounds', () => {
    expect(remapWithCaret('äö', 99)).toEqual({ value: 'æø', caret: 2 });
    expect(remapWithCaret('äö', -1)).toEqual({ value: 'æø', caret: 0 });
  });
});
