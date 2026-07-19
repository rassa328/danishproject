<script lang="ts">
  import { tick } from 'svelte';
  import { DEFAULT_SETTINGS, type Store, type Direction } from '../lib/storage.ts';
  import { UI } from '../lib/strings.ts';
  import {
    UNLIMITED,
    NEW_PER_DAY,
    MAX_REVIEWS,
    stepUp,
    stepDown,
    stepperDisplay,
    clampRetention,
    retentionToPct,
    pctToRetention,
    type StepperSpec,
  } from '../lib/fc-settings.ts';

  // Embedded in FlashcardReviewer so it shares the SAME Store instance the drill
  // reads — a separate island would hold a stale cached SRS root and the reviewer
  // wouldn't see a changed limit until reload. `onChange` lets the reviewer
  // re-apply (restart a finished round) the moment a setting changes.
  let { store, onChange }: { store: Store; onChange?: () => void } = $props();
  const T = UI.fcSettings;
  const F = UI.flashcards;

  // Mode chips in the design's order — Känn igen first (the default STANDARDLÄGE).
  const MODES: { dir: Direction; label: string }[] = [
    { dir: 'recognize', label: F.recognize },
    { dir: 'produce', label: F.write },
    { dir: 'listen', label: F.listen },
    { dir: 'listen-sentence', label: F.listenSentence },
    { dir: 'speak', label: F.speak },
    { dir: 'cloze', label: F.cloze },
  ];
  const RET_CHIPS: { pct: number; label: string }[] = [
    { pct: 85, label: T.retentionRelaxed },
    { pct: 90, label: T.retentionBalanced },
    { pct: 95, label: T.retentionIntense },
  ];

  let open = $state(false);
  let showRetManual = $state(false);

  // Local reactive mirror of the persisted settings. Every control writes THROUGH
  // to the shared Store, then updates this mirror so the UI reflects it instantly.
  function read() {
    const g = store.getSettings();
    return {
      autoSpeech: g.autoSpeech,
      speakSentence: g.speakSentence,
      newPerDay: g.newPerDay,
      reviewPerDay: g.reviewPerDay,
      retentionPct: retentionToPct(g.requestRetention),
      mode: (g.directions?.[0] ?? 'recognize') as Direction,
    };
  }
  let s = $state(read());
  let pausedCount = $state(store.suspendedCount());

  let gearEl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLElement>();
  let closeEl = $state<HTMLButtonElement>();

  function changed() {
    onChange?.();
  }

  // ---- persistence (auto-save: no Save button, every change is immediate) ----
  function setAutoSpeech(v: boolean) {
    store.setSettings({ autoSpeech: v });
    s.autoSpeech = v;
    changed();
  }
  function setSpeakSentence(v: boolean) {
    store.setSettings({ speakSentence: v });
    s.speakSentence = v;
    changed();
  }
  function setStepper(key: 'newPerDay' | 'reviewPerDay', v: number) {
    store.setSettings({ [key]: v });
    s[key] = v;
    changed();
  }
  function setRetentionPct(pct: number) {
    store.setSettings({ requestRetention: pctToRetention(pct) });
    s.retentionPct = pct;
    changed();
  }
  function setMode(d: Direction) {
    store.setSettings({ directions: [d] });
    s.mode = d;
    changed();
  }

  const bump =
    (key: 'newPerDay' | 'reviewPerDay', spec: StepperSpec, dir: 1 | -1) => () =>
      setStepper(key, (dir === 1 ? stepUp : stepDown)(s[key], spec));

  function resumeAll() {
    store.resumeAllSuspended();
    pausedCount = store.suspendedCount();
    changed();
  }

  function resetDefaults() {
    // Reset only the fields this panel owns — never the picked deck, theme, or
    // leech threshold, which live elsewhere.
    store.setSettings({
      autoSpeech: DEFAULT_SETTINGS.autoSpeech,
      speakSentence: DEFAULT_SETTINGS.speakSentence,
      newPerDay: DEFAULT_SETTINGS.newPerDay,
      reviewPerDay: DEFAULT_SETTINGS.reviewPerDay,
      requestRetention: DEFAULT_SETTINGS.requestRetention,
      directions: [...DEFAULT_SETTINGS.directions],
    });
    s = read();
    showRetManual = false;
    changed();
  }

  // Reveal the manual retention stepper and move focus onto it, so a keyboard
  // user isn't dropped to the top of the tab order when the link unmounts.
  function showManual() {
    showRetManual = true;
    tick().then(() =>
      panelEl?.querySelector<HTMLButtonElement>('.retention .stepper.small .step')?.focus(),
    );
  }

  const retLabel = (pct: number) => `${T.retention}: ${pct} %`;
  const stepLabel = (label: string, v: number) =>
    `${label}: ${v === UNLIMITED ? T.unlimited : v}`;

  // ---- open / close ----
  function openPanel() {
    // Refresh from the store: the reviewer may have changed a setting, and a
    // mid-session leech suspension must show without a reload.
    s = read();
    pausedCount = store.suspendedCount();
    open = true;
    tick().then(() => closeEl?.focus());
  }
  function closePanel(returnFocus = true) {
    open = false;
    showRetManual = false;
    if (returnFocus) tick().then(() => gearEl?.focus());
  }
  function toggleOpen() {
    if (open) closePanel();
    else openPanel();
  }

  // Outside pointer-down or Escape closes it (scoped to document because the
  // panel overlaps the card, outside the reviewer's own key handler).
  function onDocPointer(e: PointerEvent) {
    if (!open) return;
    const t = e.target as HTMLElement | null;
    if (!t?.closest('[data-fc-settings]')) closePanel(false);
  }
  function onDocKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  }
</script>

<svelte:document onpointerdown={onDocPointer} onkeydown={onDocKey} />

<span class="fc-settings" data-fc-settings>
  <button
    bind:this={gearEl}
    type="button"
    class="gear"
    class:open
    onclick={toggleOpen}
    aria-label={T.open}
    aria-haspopup="dialog"
    aria-expanded={open}
  >
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <line x1="1" y1="3.2" x2="14" y2="3.2" stroke="currentColor" stroke-width="1.2" />
      <line x1="1" y1="7.5" x2="14" y2="7.5" stroke="currentColor" stroke-width="1.2" />
      <line x1="1" y1="11.8" x2="14" y2="11.8" stroke="currentColor" stroke-width="1.2" />
      <circle cx="5" cy="3.2" r="2.1" fill="currentColor" />
      <circle cx="10.2" cy="7.5" r="2.1" fill="currentColor" />
      <circle cx="6.5" cy="11.8" r="2.1" fill="currentColor" />
    </svg>
  </button>

  {#if open}
    <div bind:this={panelEl} class="panel" role="dialog" aria-label={T.title} tabindex="-1">
      <div class="panel-head">
        <h2 class="panel-title">{T.title}</h2>
        <button bind:this={closeEl} type="button" class="x" onclick={() => closePanel()} aria-label={T.close}>×</button>
      </div>

      <!-- UTTAL -->
      <p class="eyebrow">{T.speechEyebrow}</p>

      <div class="row">
        <div class="rowlabel">
          <div class="label">
            {T.autoSpeech}
            <span class="wave" class:on={s.autoSpeech} aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
          </div>
          <div class="hint">{T.autoSpeechHint}</div>
        </div>
        <button
          type="button"
          class="toggle"
          class:on={s.autoSpeech}
          role="switch"
          aria-checked={s.autoSpeech}
          aria-label={T.autoSpeech}
          onclick={() => setAutoSpeech(!s.autoSpeech)}
        >
          <span class="knob"></span>
        </button>
      </div>

      <div class="row sentence" class:dim={!s.autoSpeech}>
        <div class="rowlabel">
          <div class="label">{T.speakSentence}</div>
          <div class="hint">{T.speakSentenceHint}</div>
        </div>
        <button
          type="button"
          class="toggle"
          class:on={s.speakSentence}
          role="switch"
          aria-checked={s.speakSentence}
          aria-label={T.speakSentence}
          disabled={!s.autoSpeech}
          onclick={() => setSpeakSentence(!s.speakSentence)}
        >
          <span class="knob"></span>
        </button>
      </div>

      <div class="divider"></div>

      <!-- REPETITION · ANKI -->
      <p class="eyebrow">{T.repetitionEyebrow}</p>

      {#snippet stepperRow(label: string, key: 'newPerDay' | 'reviewPerDay', spec: StepperSpec)}
        <div class="row stepped">
          <div class="rowlabel"><div class="label">{label}</div></div>
          <div class="stepper" role="group" aria-label={label}>
            <button type="button" class="step" aria-label={`${T.decrease}: ${label}`} onclick={bump(key, spec, -1)}>−</button>
            <div class="stepval" aria-live="polite" aria-label={stepLabel(label, s[key])}>{stepperDisplay(s[key])}</div>
            <button type="button" class="step" aria-label={`${T.increase}: ${label}`} onclick={bump(key, spec, 1)}>+</button>
          </div>
        </div>
      {/snippet}

      {@render stepperRow(T.newPerDay, 'newPerDay', NEW_PER_DAY)}
      {@render stepperRow(T.maxReviews, 'reviewPerDay', MAX_REVIEWS)}

      <!-- Målretention -->
      <div class="retention">
        <div class="label">{T.retention}</div>
        <div class="hint">{T.retentionHint}</div>
        <div class="chips" role="radiogroup" aria-label={T.retention}>
          {#each RET_CHIPS as c}
            <label class="chip">
              <input
                type="radio"
                name="fc-retention"
                value={c.pct}
                checked={s.retentionPct === c.pct}
                onchange={() => setRetentionPct(c.pct)}
              />
              {c.label}
            </label>
          {/each}
        </div>
        <div class="manual">
          {#if showRetManual}
            <div class="stepper small" role="group" aria-label={T.retention}>
              <button type="button" class="step" aria-label={`${T.decrease}: ${T.retention}`} onclick={() => setRetentionPct(clampRetention(s.retentionPct - 1))}>−</button>
              <div class="stepval" aria-live="polite" aria-label={retLabel(s.retentionPct)}>{s.retentionPct} %</div>
              <button type="button" class="step" aria-label={`${T.increase}: ${T.retention}`} onclick={() => setRetentionPct(clampRetention(s.retentionPct + 1))}>+</button>
            </div>
          {:else}
            <button type="button" class="manual-link" onclick={showManual}>{T.adjustManual(s.retentionPct)}</button>
          {/if}
        </div>
      </div>

      <div class="divider"></div>

      <!-- STANDARDLÄGE -->
      <p class="eyebrow">{T.modeEyebrow}</p>
      <div class="chips wrap modes" role="radiogroup" aria-label={T.modeEyebrow}>
        {#each MODES as m}
          <label class="chip">
            <input
              type="radio"
              name="fc-mode"
              value={m.dir}
              checked={s.mode === m.dir}
              onchange={() => setMode(m.dir)}
            />
            {m.label}
          </label>
        {/each}
      </div>

      <div class="divider tight"></div>

      <!-- Pausade kort -->
      <div class="row paused">
        <div class="rowlabel">
          <div class="label">{T.pausedTitle}</div>
          <div class="hint">{pausedCount > 0 ? T.pausedSome(pausedCount) : T.pausedNone}</div>
        </div>
        <button type="button" class="resume" disabled={pausedCount === 0} onclick={resumeAll}>{T.resumeAll}</button>
      </div>

      <div class="divider foot"></div>

      <!-- footer -->
      <div class="foot">
        <button type="button" class="reset" onclick={resetDefaults}>{T.resetDefaults}</button>
        <span class="autosaved">{T.autoSaved}</span>
      </div>
    </div>
  {/if}
</span>

<style>
  .fc-settings {
    position: relative;
    display: inline-flex;
  }

  /* ---- gear trigger ---- */
  .gear {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: transparent;
    border: 1px solid var(--bd5);
    color: var(--mut2);
    transition: color 150ms ease, background-color 200ms ease, border-color 200ms ease;
  }
  .gear:hover {
    color: var(--ink);
    border-color: var(--mut4);
  }
  .gear.open {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
  .gear svg { display: block; }

  /* ---- panel ---- */
  .panel {
    position: absolute;
    top: calc(100% + 14px);
    right: 0;
    z-index: 60;
    width: min(372px, calc(100vw - 24px));
    max-height: min(76vh, 660px);
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--bd1);
    border-radius: 16px;
    padding: 22px 24px 18px;
    box-shadow: 0 1px 2px var(--sh1), 0 16px 40px var(--sh3);
    transform-origin: top right;
    text-align: left;
  }
  .panel:focus { outline: none; }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 18px;
  }
  .panel-title {
    margin: 0;
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: 20px;
    line-height: 1.1;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    min-height: 24px;
    border: none;
    background: transparent;
    color: var(--mut3);
    font-size: 16px;
    line-height: 1;
    padding: 2px;
    border-radius: 6px;
    transition: color 150ms ease;
    /* Invisible expanded hit area (~40px) — visuals and layout unchanged. */
    position: relative;
  }
  .x::before {
    content: '';
    position: absolute;
    inset: -9px;
  }
  .x:hover { color: var(--ink); }

  .eyebrow {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--mut3);
  }

  /* ---- rows ---- */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
  }
  .row.stepped { padding: 10px 0; }
  .row.sentence { padding: 12px 0 4px; }
  .row.paused { padding: 2px 0 10px; }
  .rowlabel { min-width: 0; }
  .label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--ink);
  }
  .hint {
    margin-top: 3px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--mut2);
  }

  .row.sentence.dim {
    opacity: 0.35;
    transition: opacity 250ms ease;
  }

  .divider {
    height: 1px;
    background: var(--bd2);
    margin: 14px 0 16px;
  }
  .divider.tight { margin: 16px 0 12px; }
  .divider.foot { margin: 6px 0 12px; }

  /* ---- iOS-style toggle ---- */
  .toggle {
    width: 42px;
    height: 24px;
    border-radius: 999px;
    padding: 3px;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    background: var(--ghost);
    border: 1px solid var(--bd4);
    transition: background-color 250ms ease, border-color 250ms ease;
    /* Invisible expanded hit area (~40px tall); absolute so the pseudo never
       joins the flex flow and shifts the knob. */
    position: relative;
  }
  .toggle::before {
    content: '';
    position: absolute;
    inset: -9px;
  }
  .toggle .knob {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--mut2);
    transform: translateX(0);
  }
  .toggle.on {
    background: var(--ink);
    border-color: var(--ink);
  }
  .toggle.on .knob { background: var(--bg); }
  .toggle:disabled { opacity: 1; } /* the whole .sentence row already dims */
  .toggle:hover:not(:disabled):not(.on) { border-color: var(--mut4); }
  @media (prefers-reduced-motion: no-preference) {
    .toggle .knob { transition: transform 300ms cubic-bezier(0.3, 1.5, 0.4, 1), background-color 250ms ease; }
  }
  .toggle.on .knob { transform: translateX(18px); }

  /* ---- stepper ---- */
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .step {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    background: transparent;
    border: 1px solid var(--bd4);
    color: var(--mut2);
    transition: color 150ms ease, border-color 150ms ease;
    /* Invisible expanded hit area (~42px); − and + sit 60px apart across the
       value readout, so the expansions never overlap each other. */
    position: relative;
  }
  .step::before {
    content: '';
    position: absolute;
    inset: -9px;
  }
  .step:hover {
    border-color: var(--mut4);
    color: var(--ink);
  }
  .stepval {
    min-width: 58px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink);
  }
  .stepper.small .step { width: 24px; height: 24px; font-size: 13px; }
  .stepper.small .stepval { min-width: 52px; font-size: 12.5px; }

  /* ---- chips (retention + mode): native radios styled as pills (matches the
     reviewer's mode-pill pattern) so the group is a real single-select radiogroup
     — one Tab stop, arrow-key nav, correct SR announcements. ---- */
  .chips {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  /* Touch: the chips' expanded radio hit areas (±5px vertical) must not shadow
     the next wrapped row — widen the row gap so expansions can't overlap. */
  @media (pointer: coarse) {
    .chips {
      row-gap: 12px;
    }
  }
  .chips.wrap { flex-wrap: wrap; }
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: 6px 11px;
    border-radius: 999px;
    background: transparent;
    border: 1px solid var(--bd4);
    color: var(--mut2);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    cursor: pointer;
    transition: color 200ms ease, background-color 200ms ease, border-color 200ms ease;
  }
  .chip input {
    position: absolute;
    /* The invisible radio IS the hit area — extend it a bit past the ~31px
       pill (vertical only: chips sit 6px apart horizontally). */
    inset: -5px 0;
    width: 100%;
    height: calc(100% + 10px);
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .chip:hover:not(:has(:checked)) {
    color: var(--ink);
    border-color: var(--mut4);
  }
  .chip:has(:checked) {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--bg);
  }
  .chip:has(:focus-visible) {
    outline: 2px solid var(--red);
    outline-offset: 2px;
  }

  .retention { padding: 10px 0 4px; }
  .retention .label { margin-bottom: 0; }
  .manual {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
    min-height: 24px;
  }
  .manual-link {
    border: none;
    background: transparent;
    color: var(--mut2);
    font-size: 11.5px;
    padding: 2px 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: var(--mut4);
    transition: color 200ms ease, text-decoration-color 200ms ease;
  }
  .manual-link:hover { color: var(--ink); text-decoration-color: var(--ink); }

  /* ---- paused / resume ---- */
  .resume {
    padding: 7px 14px;
    border-radius: 999px;
    background: transparent;
    border: 1px solid var(--bd4);
    color: var(--mut2);
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 200ms ease, border-color 200ms ease;
  }
  .resume:hover:not(:disabled) { color: var(--ink); border-color: var(--mut4); }
  .resume:disabled { opacity: 0.35; }

  /* ---- footer ---- */
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .reset {
    border: none;
    background: transparent;
    color: var(--mut2);
    font-size: 12px;
    padding: 4px 0;
    transition: color 200ms ease;
  }
  .reset:hover { color: var(--ink); }
  .autosaved {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--mut3);
  }

  /* ---- animated waveform beside "Automatiskt uttal" ---- */
  .wave {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 11px;
  }
  .wave span {
    display: inline-block;
    width: 2px;
    height: 11px;
    border-radius: 1px;
    background: var(--mut4);
    transform: scaleY(0.4);
    transform-origin: bottom;
    transition: background-color 250ms ease;
  }
  .wave.on span { background: var(--bars); }
  @media (prefers-reduced-motion: no-preference) {
    .wave.on span { animation: fcWave 1.1s ease-in-out infinite; }
    .wave.on span:nth-child(2) { animation-delay: 0.18s; }
    .wave.on span:nth-child(3) { animation-delay: 0.36s; }
  }
  @keyframes fcWave {
    0%, 100% { transform: scaleY(0.4); }
    50% { transform: scaleY(1); }
  }

  /* ---- press states + panel entrance (motion-gated) ---- */
  @media (prefers-reduced-motion: no-preference) {
    .panel { animation: fcPanelIn 0.28s cubic-bezier(0.2, 0.9, 0.3, 1); }
    .gear:active { transform: scale(0.92); }
    .step:active, .toggle:active:not(:disabled) { transform: scale(0.88); }
    .chip:active, .resume:active:not(:disabled) { transform: scale(0.95); }
  }
  /* Touch: the press scale shrinks the button AND its expanded hit pseudo
     between pointerdown and the click hit-test, so edge taps silently
     retarget to the row. Keep geometry stable; press-cue via opacity.
     (After the motion block: equal specificity, later order wins.) */
  @media (pointer: coarse) {
    .step:active,
    .toggle:active:not(:disabled),
    .chip:active {
      transform: none;
      opacity: 0.6;
    }
  }
  @keyframes fcPanelIn {
    from { opacity: 0; transform: translateY(-8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
</style>
