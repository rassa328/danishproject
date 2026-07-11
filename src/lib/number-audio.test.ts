import { describe, it, expect } from 'vitest';
import {
  planClips,
  levelAvailable,
  atomsForLevel,
  type NumberAudioManifest,
} from './number-audio.ts';
import { NUMBER_ATOMS, NUMBER_LEVELS } from './danish-numbers.ts';
import { lessonAudioId } from './audio-id.ts';

// TODO (plan §6, later phase): committed-manifest drift guard — once
// src/data/number-audio.json exists, add a test asserting every id =
// lessonAudioId(word), every key ∈ NUMBER_ATOMS, and every NUMBER_ATOMS
// atom appears in the file.

/** Fixture manifest with real lessonAudioId-derived ids; `absent` entries are
 *  listed but present:false (recording checklist row without a clip). */
const manifestFor = (words: readonly string[], absent: readonly string[] = []): NumberAudioManifest => {
  const atoms: NumberAudioManifest['atoms'] = {};
  for (const w of words) {
    const id = lessonAudioId(w);
    atoms[w] = { id, file: id + '.mp3', present: !absent.includes(w) };
  }
  return { atoms };
};

/** Rng that replays a fixed sequence (last value repeats) — same convention
 *  as danish-numbers.test.ts. */
const seqRng = (...vals: number[]) => {
  let i = 0;
  return () => {
    const v = vals[Math.min(i, vals.length - 1)] ?? 0;
    i++;
    return v;
  };
};

const TENS = [
  'tyve', 'tredive', 'fyrre', 'halvtreds', 'tres', 'halvfjerds', 'firs', 'halvfems',
] as const;

const ZERO_TO_TWENTY = [
  'nul', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'syv', 'otte', 'ni', 'ti',
  'elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten',
  'atten', 'nitten', 'tyve',
] as const;

describe('planClips', () => {
  it('resolves a token list to clip ids in play order', () => {
    const m = manifestFor(['tre', 'hundrede', 'og', 'toogfyrre']);
    expect(planClips(['tre', 'hundrede', 'og', 'toogfyrre'], m)).toEqual([
      lessonAudioId('tre'),
      lessonAudioId('hundrede'),
      lessonAudioId('og'),
      lessonAudioId('toogfyrre'),
    ]);
  });

  it('repeats the id when a token repeats (2002 = to tusind og to)', () => {
    const m = manifestFor(['to', 'tusind', 'og']);
    expect(planClips(['to', 'tusind', 'og', 'to'], m)).toEqual([
      lessonAudioId('to'),
      lessonAudioId('tusind'),
      lessonAudioId('og'),
      lessonAudioId('to'),
    ]);
  });

  it('returns [] for an empty token list', () => {
    expect(planClips([], manifestFor(['tyve']))).toEqual([]);
  });

  it('returns null when a token is absent from the manifest', () => {
    expect(planClips(['tres'], manifestFor(['tyve']))).toBeNull();
  });

  it('returns null when an atom is listed but not recorded (present: false)', () => {
    const m = manifestFor(['syv', 'og', 'tyve'], ['og']);
    expect(planClips(['syv', 'og', 'tyve'], m)).toBeNull();
  });
});

describe('atomsForLevel', () => {
  it('0-20 is exactly nul…tyve (en, never et)', () => {
    expect(atomsForLevel('0-20')).toEqual([...ZERO_TO_TWENTY]);
    expect(atomsForLevel('0-20')).not.toContain('et');
  });

  it('tiotal is exactly the eight tens words', () => {
    expect(atomsForLevel('tiotal')).toEqual([...TENS]);
  });

  it('0-99 is the 100 standalone atoms — no scale words', () => {
    const atoms = atomsForLevel('0-99');
    expect(atoms).toHaveLength(100); // 21 ones + 7 more tens + 72 compounds
    expect(atoms).toContain('nioghalvfems');
    for (const scale of ['et', 'hundrede', 'tusind', 'og', 'kroner']) {
      expect(atoms).not.toContain(scale);
    }
  });

  it('stora-tal needs every atom except nul', () => {
    const atoms = atomsForLevel('stora-tal');
    expect(new Set(atoms).size).toBe(NUMBER_ATOMS.length - 1);
    for (const w of ['et', 'hundrede', 'tusind', 'og', 'kroner', 'nitten']) {
      expect(atoms).toContain(w);
    }
    expect(atoms).not.toContain('nul');
  });

  it('every level set is a subset of NUMBER_ATOMS', () => {
    const all = new Set(NUMBER_ATOMS);
    for (const level of NUMBER_LEVELS) {
      for (const w of atomsForLevel(level.id)) expect(all.has(w)).toBe(true);
    }
  });

  it('covers everything the level generators emit (range-sync guard)', () => {
    // atomsForLevel hardcodes the gen ranges — this sampled sweep catches a
    // widened range in danish-numbers.ts that number-audio.ts missed.
    for (const level of NUMBER_LEVELS) {
      const atoms = new Set(atomsForLevel(level.id));
      for (let i = 0; i < 60; i++) {
        const r0 = i / 60;
        const r1 = ((i * 13) % 60) / 60;
        for (const t of level.gen(seqRng(r0, r1)).tokens) {
          expect(atoms.has(t)).toBe(true);
        }
      }
    }
  });
});

describe('levelAvailable', () => {
  it('tiotal is available from the eight tens clips alone (day-one tier)', () => {
    expect(levelAvailable('tiotal', manifestFor(TENS))).toBe(true);
  });

  it('tiotal is unavailable when one tens clip is unrecorded', () => {
    expect(levelAvailable('tiotal', manifestFor(TENS, ['halvfems']))).toBe(false);
  });

  it('0-20 needs its own atoms, not the tens', () => {
    expect(levelAvailable('0-20', manifestFor(TENS))).toBe(false);
    expect(levelAvailable('0-20', manifestFor(ZERO_TO_TWENTY))).toBe(true);
  });

  it('every level is available under a complete manifest', () => {
    const full = manifestFor(NUMBER_ATOMS);
    for (const level of NUMBER_LEVELS) expect(levelAvailable(level.id, full)).toBe(true);
  });

  it('a single missing atom disables only the levels that need it', () => {
    const noKroner = manifestFor(NUMBER_ATOMS, ['kroner']);
    expect(levelAvailable('stora-tal', noKroner)).toBe(false);
    expect(levelAvailable('0-99', noKroner)).toBe(true);
    expect(levelAvailable('tiotal', noKroner)).toBe(true);
  });
});
