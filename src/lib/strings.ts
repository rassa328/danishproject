// Single source of truth for user-facing Swedish UI copy. The interface language
// is Swedish (the learner's native tongue); the target language being taught is
// Danish. Keep lesson PROSE in the markdown files and vocab in the CSV — this is
// only the app chrome (nav, buttons, prompts, messages). Centralized so wording
// stays consistent and is easy to tune. Plain typed object (no i18n lib).

const BRAND = 'Dansk för svenskar';
/** Consistent one-liner about where progress lives (was phrased 3 different ways). */
const PROGRESS_NOTE = 'Framsteg sparas i din webbläsare';

export const UI = {
  brand: BRAND,
  brandDa: 'Dansk', // rendered in <span lang="da"> within the wordmark
  brandRest: ' för svenskar',
  skipLink: 'Hoppa till innehåll',
  footer: `Lär dig danska som svensk · ${PROGRESS_NOTE.toLowerCase()} ·`,

  nav: {
    menuLabel: 'Huvudmeny',
    home: 'Hem',
    lessons: 'Lektioner',
    flashcards: 'Flashcards',
    wordlist: 'Ordlista',
    numbers: 'Tal',
    // The Zen entry renders as a dot-in-circle icon; these carry its name for
    // tooltips and assistive tech. (Was 'skrivövning'; zen now spans ord+tal.)
    zen: 'Zen',
    zenLabel: 'Zen — övning',
  },

  home: {
    heroTitle: 'Förstå danskar när de faktiskt pratar',
    heroLead: 'Du läser redan danska — här tränar du örat och uttalet: stød, blødt d och talad danska.',
    heroCta: 'Börja med lektionerna',
    samplePlay: 'Hör skillnaden',
    // Labels under each word's real waveform in the hero.
    sampleWordA: 'hun',
    sampleWordB: 'hund',
    sampleCaption: 'stødet är hela skillnaden.',
    sampleAria: 'Lyssna på danska: hun och hund',
  },

  flashcards: {
    title: 'Flashcards',
    // No "FSRS" acronym — describe the benefit in plain Swedish instead.
    description: 'Skriv det danska ordet utifrån svenskan. Du repeterar varje ord precis innan du hinner glömma det.',
    lead: `Skriv det danska ordet utifrån svenskan. Repetitionen schemaläggs åt dig — du ser varje ord precis innan du hinner glömma det. ${PROGRESS_NOTE}.`,
    loading: 'Laddar…',
    // The praksis deck lives in a lazily hämtad JSON — shown while a session
    // that needs it (praksis-grupp, tagg, allt förfallet) awaits the fetch.
    loadingDeck: 'Hämtar hela ordförrådet…',
    praksisFailed:
      'Kunde inte hämta praksis-orden — övar bara med grundorden just nu. Ladda om sidan för att försöka igen.',
    deckLabel: 'Kortlek:',
    directionLegend: 'Riktning',
    write: 'Skriv',
    listen: 'Lyssna',
    recognize: 'Känn igen',
    speak: 'Säg',
    cloze: 'Lucka',
    listenSentence: 'Lyssna (mening)',
    choosePrompt: 'Välj rätt danska ord',
    listenSentencePrompt: '🎧 Lyssna på hela meningen på danska — tryck sedan för att se den.',
    listenSentenceReveal: 'Visa meningen',
    comprehendHint: 'Bedöm dig själv: hur mycket förstod du? (1–4)',
    speakPrompt: '🗣 Säg ordet högt på danska — tryck sedan för att höra det rätta uttalet.',
    speakReveal: 'Hör uttalet',
    selfGradeHint: 'Bedöm dig själv: hur nära var ditt uttal? (1–4)',
    noAudio: 'Ingen dansk röst i den här webbläsaren — uttalet kan inte spelas.',
    clozePrompt: 'Fyll i ordet som saknas (på danska):',
    noClozeCards: 'Den här kortleken saknar exempelmeningar, så Lucka-läget har inga kort här. Välj en annan kortlek eller ett annat läge.',
    noListenCards: 'Den här kortleken saknar inspelade meningar, så Lyssna (mening)-läget har inga kort här. Välj en annan kortlek eller ett annat läge.',
    charHelper: 'Saknar æ ø å på tangentbordet? Klicka för att infoga:',
    trainingTagPrefix: 'Tränar taggen',
    showAllDecks: 'Visa alla kortlekar',
    listenPrompt: '🎧 Lyssna och skriv ordet du hör:',
    replay: 'Spela igen',
    // Autoplay was blocked (no user gesture yet) — an explicit play button
    // starts the clip and the session continues normally.
    play: 'Spela',
    noPromptAudio: 'Ingen dansk röst i den här webbläsaren — ljudet kan inte spelas.',
    skipCard: 'Hoppa över (utan att gradera)',
    slowReplay: 'Långsammare (0,75×)',
    // Same wording as SpeakButton's fallback marker, for the plain replay control.
    ttsHint: 'talsyntes',
    ttsHintTitle:
      'Spelades med webbläsarens talsyntes — inspelat klipp saknas eller kunde inte spelas',
    hear: 'Lyssna',
    placeholder: 'Skriv på danska…',
    inputLabel: 'Skriv ordet på danska',
    reveal: 'Visa svar (Enter)',
    correct: '✓ Rätt!',
    incorrect: '✗ Inte riktigt',
    grades: { again: 'Igen', hard: 'Svårt', good: 'Bra', easy: 'Lätt' },
    gradeKeysHint: 'Tangenterna 1–4 graderar (eller klicka på knapparna).',
    wrongHint: 'Fel svar räknas som ”Igen”.',
    saveError: 'Kunde inte spara framsteg — din lagring kan vara full.',
    doneTitle: 'Klart för nu!',
    doneEmpty: 'Inga kort att repetera just nu',
    dueAllEmpty: 'Inget förfallet just nu — allt är repeterat.',
    stillDue: (n: number, mode: string) => `${n} kvar i ${mode} →`,
    toLessons: 'Läs en lektion →',
    repeatDue: 'Repetera förfallna',
    practiceFree: 'Öva fritt (påverkar inte schemat)',
    noTagMatch: 'Inga kort matchar den här taggen.',
    // Mode-radio gating: why a direction is disabled for the selected deck.
    clozeUnavailable: 'Inga kort med exempelmeningar i den här kortleken.',
    listenSentenceUnavailable: 'Inga kort med inspelade meningar i den här kortleken.',
    // Subtle keyboard hints (title attributes on the controls).
    chooseKeyTitle: (n: number) => `Tangent ${n}`,
    revealKeyTitle: 'Enter eller mellanslag',
    replayKeyTitle: 'Tangent R',
    confirmRestart: 'Du är mitt i en omgång. Vill du börja om?',
    progress: (i: number, total: number, remaining: number) => `Kort ${i} av ${total} · ${remaining} kvar`,
    reviewedCount: (n: number) => `Du repeterade ${n} kort.`,
    backup: {
      summary: 'Säkerhetskopiera',
      note: `${PROGRESS_NOTE}. Exportera då och då, eller flytta till en annan enhet.`,
      export: 'Exportera backup (JSON)',
      import: 'Importera backup',
      imported: 'Backup importerad.',
      importError: 'Kunde inte läsa backup-filen.',
    },
  },

  // Zen (/zen, the typing practice flow) + number dictation (/tal) — one shared
  // engine island. Reuse flashcards.* verbatim where the wording already fits:
  // replay, play, slowReplay, charHelper, saveError, correct/incorrect,
  // listenPrompt, replayKeyTitle. Only drill-specific copy lives here.
  drill: {
    title: 'Zen',
    description:
      'Lugn skrivövning på danska: översätt eller lyssna, ord eller meningar, i ditt eget flöde.',
    lead: 'Ett kort i taget, inget brus. Skriv, tryck Enter, andas.',
    // .vh label behind the skeleton placeholders while the island hydrates.
    loading: 'Laddar övningen…',

    // Session setup (before "Starta").
    modeLegend: 'Läge',
    modes: {
      translate: 'Översätt',
      listen: 'Lyssna',
    },
    contentLegend: 'Innehåll',
    content: {
      words: 'Ord',
      sentences: 'Meningar',
    },
    sourceLegend: 'Vad vill du öva?',
    sourceDue: 'Att repetera (förfallna)',
    sourceFree: 'Fritt — hela ordförrådet',
    sourceSets: 'Valda set',
    setsLegend: 'Välj set',
    setsSelected: (n: number) => (n === 1 ? '1 set valt' : `${n} set valda`),
    setsLessons: 'Lektioner',
    cardCount: 'Längd',
    sizeFlow: 'Flöde — tills du avslutar',
    sizeAll: (n: number) => `Alla (${n})`,
    start: 'Starta',
    noDue: 'Inget förfallet just nu — allt är repeterat. Välj set eller öva fritt i stället.',
    noCards: 'Inga kort att öva med det här valet. Prova andra set eller ett annat läge.',
    noDictationCards:
      'Lyssna behöver inspelat ljud, och det saknas för de här orden. Prova ett annat läge.',
    noSentenceCards:
      'De här orden saknar exempelmeningar. Prova andra set eller öva ord i stället.',

    // In-run. Word dictation reuses flashcards.listenPrompt as its prompt line.
    listenSentencePrompt: '🎧 Lyssna på meningen — skriv vad den betyder på svenska:',
    progress: (i: number, total: number) => `Kort ${i} av ${total}`,
    progressFlow: (n: number) => `${n} besvarade`,
    inARow: (n: number) => `${n} i rad`,
    // Per-sub-mode answer-input copy, consumed by the SUB_CONFIGS registry
    // (drill-modes.ts spreads these into each sub-mode's input config).
    input: {
      'sv-da': { label: 'Skriv på danska', placeholder: 'Skriv på danska…' },
      'da-dictation': { label: 'Skriv ordet du hör', placeholder: 'Skriv på danska…' },
      'da-sv': { label: 'Skriv betydelsen på svenska', placeholder: 'Skriv på svenska…' },
      'sent-sv-da': { label: 'Skriv meningen på danska', placeholder: 'Skriv på danska…' },
      'sent-da-sv': { label: 'Skriv betydelsen på svenska', placeholder: 'Skriv på svenska…' },
      'sent-listen': {
        label: 'Skriv vad meningen betyder på svenska',
        placeholder: 'Skriv på svenska…',
      },
      'number-dictation': { label: 'Skriv talet med siffror', placeholder: 't.ex. 42' },
    },
    submit: 'Svara',
    hint: 'Visa svaret (räknas som miss)',
    answerLabel: 'Rätt svar:',
    youWrote: 'Du skrev:',
    continue: 'Enter — nästa',
    next: 'Vidare',
    nearMiss: 'Nästan rätt — så skrivs det:',
    requeued: 'Kortet kommer tillbaka i slutet av omgången.',
    back: '‹ Tillbaka',
    finishFlow: 'Avsluta',
    confirmBack: 'Du är mitt i en omgång. Vill du avbryta?',

    // End screen.
    doneTitle: 'Omgång klar!',
    doneLine: (accuracy: number, time: string, best: number) =>
      `${accuracy} % · ${time} · bästa svit ${best}`,
    missedHeading: 'Det här krånglade',
    noMisses: 'Allt rätt på första försöket — snyggt!',
    runAgain: 'Kör igen',

    // The /tal page. Number clips are real recordings only — levels whose
    // clips aren't on disk yet are disabled with an explanation, never TTS.
    numbers: {
      title: 'Sifferdiktat',
      description:
        'Hör ett danskt tal och skriv det med siffror — träna in halvtreds, halvfjerds och de andra lömska tiotalen.',
      lead: 'Lyssna och skriv talet med siffror. Danskan säger entalet först — syvogtyve är 27 — och här nöter du tills det sitter.',
      levelLegend: 'Nivå',
      levels: {
        '0-20': '0–20',
        'tiotal': 'Tiotal',
        '0-99': '0–99',
        'stora-tal': 'Stora tal',
      },
      levelHints: {
        '0-20': 'Grunderna: nul till tyve.',
        'tiotal': 'Tiotalen 20–90: halvtreds, tres, halvfjerds, firs, halvfems.',
        '0-99': 'Hela spannet — med entalet först.',
        'stora-tal': 'Hundratal, årtal och priser.',
      },
      listenPrompt: '🎧 Lyssna och skriv talet med siffror:',
      digitsHint: 'Skriv bara siffror, t.ex. 97 eller 1994.',
      missingAudio: 'Ljudklipp för den här nivån saknas ännu — nivån är avstängd.',
      noLevels:
        'Sifferdiktatet spelar bara riktiga inspelningar — ingen talsyntes — och klippen är inte inspelade ännu. Titta in igen snart.',
    },
  },

  // /zen — the full-screen "Fokus" practice presentation (designs: Tal Fokus
  // v2 = dark, Tal Fokus - Morgendis v2 = light). Flow (user feedback
  // 2026-07-11): läge → riktning (översätt) → källa (repetera · blandat ·
  // tal 0–100 · flashcard-sets). Lower-case labels are deliberate —
  // the screen is typography, not chrome; 'Begynd' is Danish on purpose.
  zen: {
    title: 'Zen',
    description:
      'Öva i fokusläge — lyssna eller översätt, ord och tal, ett i taget utan något runtomkring.',
    modes: {
      lyssna: { label: 'lyssna', sub: 'hör danska · skriv det du hör' },
      översätt: { label: 'översätt', sub: 'se · översätt' },
    },
    directionHeading: 'riktning',
    directions: {
      'sv-da': { label: 'svenska → danska', sub: 'ser svenska · skriver danska' },
      'da-sv': { label: 'danska → svenska', sub: 'ser danska · skriver svenska' },
    },
    sources: { repetera: 'repetera', blandat: 'blandat', tal: 'tal' },
    talNote: '0–100',
    missingNote: 'saknar inspelningar',
    noDueNote: 'inget förfallet',
    freeNote: 'utan schema',
    starterOnlyNote: 'endast grundorden',
    begin: 'Begynd',
    back: 'tillbaka',
    exit: 'lämna',
    enterKey: 'enter',
    escKey: 'esc',
    keyHintPick: 'pilar väljer · enter',
    keyHintBegin: 'enter börjar',
    runHintListen: 'r spelar igen · esc paus',
    runHintListenOrd: 'enter spelar igen · esc paus',
    runHint: 'esc paus',
    saveError: 'kunde inte spara framsteg',
    audioBlockedHint: 'klicka på glöden för ljud',
    replayTitle: 'spela igen',
    youWrote: 'du skrev',
    inputDigits: 'Skriv talet med siffror',
    inputDanish: 'Skriv på danska',
    inputSwedish: 'Skriv på svenska',
    submit: 'svara',
    pauseShort: 'paus',
    ttsNote: 'talsyntes',
    done: (n: number, subject: 'ord' | 'tal') => `${n} ${subject}. Vi ses i morgon.`,
    resume: 'fortsätt',
    quit: 'avsluta',
    year: (y: number) => `år ${y}`,
    kronor: (v: number) => `${v} kronor`,
  },

  wordlist: {
    title: 'Ordlista',
    description: (total: number) =>
      `Sök bland alla ${total} danska ord, med svensk översättning, exempel och uttal.`,
    lead: (starter: number, total: number) =>
      `Sök bland alla ${total} ord som appen tränar. Nedanför hittar du de ${starter} utvalda grundorden som referenslista — klicka på ett danskt ord (eller exempel) för att höra det.`,
    // The search island (searches starter ∪ the lazily fetched praksis deck).
    searchLabel: 'Sök ord',
    searchPlaceholder: 'Sök på danska eller svenska…',
    searchLoading: 'Hämtar hela ordförrådet…',
    searchFailed: 'Kunde inte hämta praksis-orden — söker bara bland grundorden.',
    noMatches: 'Inga träffar.',
    matchCount: (shown: number, total: number) =>
      shown < total
        ? `Visar ${shown} av ${total} träffar.`
        : total === 1
          ? '1 träff.'
          : `${total} träffar.`,
    // 'Träna →' on each themed section header, into the matching reviewer group.
    trainTheme: 'Träna →',
    trainThemeTitle: (label: string) => `Öva ${label} med flashcards`,
  },

  lessons: {
    backToList: '← Lektioner',
    positionPrefix: 'Lektion',
    prerequisitesLabel: 'Gör först:',
    objectivesHead: 'Efter lektionen kan du:',
    trainWords: 'Träna orden:',
    practiceCta: 'Börja öva orden →',
    readBadge: '✓ Läst',
    navLabel: 'Mellan lektioner',
    prev: '← Föregående',
    next: 'Nästa →',
    backToLesson: '← Tillbaka till lektionen',
    indexLead: 'Korta lektioner om det som faktiskt är svårt för svenskar — grupperade efter tema.',
    progress: (done: number, total: number) => `Du har läst ${done} av ${total} lektioner.`,
  },

  // End-of-lesson self-check (a couple of quick multiple-choice questions).
  checkpoint: {
    heading: 'Snabbkoll',
    intro: 'Testa dig själv innan du går vidare.',
    correct: 'Rätt!',
    wrong: 'Inte riktigt — rätt svar är markerat.',
    reset: 'Försök igen',
    done: 'Snyggt! Du är redo att öva orden.',
  },

  // Per-session study settings (embedded in the reviewer, same Store instance).
  settings: {
    summary: 'Inställningar',
    newPerDay: 'Nya ord per dag',
    reviewPerDay: 'Max repetitioner per omgång',
    retention: 'Hur mycket vill du minnas (%)',
    retentionHint: 'Högre = tätare repetition (fler kort, starkare minne).',
    defaultMode: 'Standardläge (öppnas i)',
    defaultModeHint: 'Som svensk tjänar du mest på att lyssna och säga, inte skriva.',
    save: 'Spara',
    saved: 'Sparat — gäller nästa omgång.',
    suspendedCount: (n: number) => `Pausade ord: ${n}`,
    suspendedHint: 'Pausade automatiskt efter många misslyckanden. Bra/Lätt i fri övning återupptar ett ord.',
    resumeAll: 'Återuppta alla',
  },

  // Daily output missions + input log — the bridge from the app to real Danish.
  practice: {
    heading: 'Daglig praktik',
    intro:
      'Du blir flytande av att använda språket. En liten taluppgift om dagen, och logga danskan du faktiskt möter.',
    missionTitle: 'Dagens taluppgift',
    missionDone: 'Klarad ✓',
    missionMarkDone: 'Markera som klarad',
    focusWords: 'Försök få med:',
    // Each focus word is click-to-hear, so the task never starts from silent text.
    hearWord: (word: string) => `Lyssna: ${word}`,
    // Picked deterministically by date — all about producing spoken Danish.
    missions: [
      'Beställ något (kaffe, mat, en biljett) på danska — högt, även om du är ensam.',
      'Beskriv din morgon i tre danska meningar, högt.',
      'Prata med någon och säg minst fem meningar på danska.',
      'Berätta vad du ska göra i helgen — på danska, högt.',
      'Sammanfatta en nyhet du läst eller hört, på danska.',
      'Tänk högt på danska medan du lagar mat eller diskar.',
      'Beskriv vägen hemifrån till närmaste affär, på danska.',
      'Lyssna på en dansk podd eller TV i tio minuter och härma (shadowa) en mening.',
      'Formulera tre frågor du skulle kunna ställa till en dansk — säg dem högt.',
      'Berätta om något du nyss köpt och varför — på danska.',
    ],
    log: {
      heading: 'Logga dansk input',
      intro: 'Vad mötte du på danska i dag? Notera gärna nya ord du fångade upp.',
      sourceLabel: 'Källa',
      sources: {
        tv: 'TV/film',
        podcast: 'Podd/radio',
        samtal: 'Samtal',
        laesning: 'Läsning',
        andet: 'Annat',
      } as Record<string, string>,
      noteLabel: 'Anteckning / nya ord',
      notePlaceholder: 't.ex. "DR Nyheder — nya ord: forsinkelse, aflyst"',
      add: 'Lägg till',
      empty: 'Inget loggat än.',
      remove: 'Ta bort',
      wordsHint: 'Tips: nya ord du loggar kan senare bli en egen kortlek.',
    },
  },

  // Stød discrimination drill (lesson 01): hear one clip, pick which word of a
  // minimal pair it was. Forced choice — the exercise that builds perception.
  minimalPairs: {
    heading: 'Hör du stødet?',
    intro:
      'Spela klippet och välj vilket ord du hörde. Orden skiljs bara av stødet — precis det ditt svenska öra behöver träna.',
    play: 'Spela klippet',
    playAgain: 'Spela igen',
    round: (i: number, n: number) => `Omgång ${i} av ${n}`,
    listenFirst: 'Spela klippet först — välj sedan.',
    correct: '✓ Rätt!',
    wrong: (word: string, gloss: string) => `✗ Inte riktigt — det var ${word} (${gloss}).`,
    next: 'Nästa',
    showResult: 'Visa resultat',
    result: (ok: number, n: number) => `Du hörde rätt på ${ok} av ${n}.`,
    retry: 'Öva igen',
  },

  // Light, non-gamified progress (personal-tool scope).
  progress: {
    words: (started: number, total: number) => `${started} av ${total} ord påbörjade`,
    due: (n: number) => (n === 1 ? '1 ord att repetera' : `${n} ord att repetera`),
    dueNone: 'Inget att repetera just nu',
    streak: (n: number) => (n === 1 ? '🔥 1 dag i rad' : `🔥 ${n} dagar i rad`),
    streakNone: 'Ingen svit än — repetera i dag för att starta en.',
  },
} as const;
