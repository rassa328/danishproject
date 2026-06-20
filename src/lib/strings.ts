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
  },

  flashcards: {
    title: 'Flashcards',
    // No "FSRS" acronym — describe the benefit in plain Swedish instead.
    description: 'Skriv det danska ordet utifrån svenskan. Du repeterar varje ord precis innan du hinner glömma det.',
    lead: `Skriv det danska ordet utifrån svenskan. Repetitionen schemaläggs åt dig — du ser varje ord precis innan du hinner glömma det. ${PROGRESS_NOTE}.`,
    loading: 'Laddar…',
    deckLabel: 'Kortlek:',
    directionLegend: 'Riktning',
    write: 'Skriv',
    listen: 'Lyssna',
    recognize: 'Känn igen',
    choosePrompt: 'Välj rätt danska ord',
    charHelper: 'Saknar æ ø å på tangentbordet? Klicka för att infoga:',
    trainingTagPrefix: 'Tränar taggen',
    showAllDecks: 'Visa alla kortlekar',
    listenPrompt: '🎧 Lyssna och skriv ordet du hör:',
    replay: 'Spela igen',
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
    repeatDue: 'Repetera förfallna',
    practiceFree: 'Öva fritt (påverkar inte schemat)',
    noTagMatch: 'Inga kort matchar den här taggen.',
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

  wordlist: {
    title: 'Ordlista',
    description: (n: number) => `Alla ${n} danska ord med svensk översättning, exempel och uttal.`,
    lead: (n: number) =>
      `Alla ${n} ord på ett ställe — din referenslista. Klicka på ett danskt ord (eller exempel) för att höra det på danska.`,
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

  // Light, non-gamified progress (personal-tool scope).
  progress: {
    words: (started: number, total: number) => `${started} av ${total} ord påbörjade`,
    due: (n: number) => (n === 1 ? '1 ord att repetera' : `${n} ord att repetera`),
    dueNone: 'Inget att repetera just nu',
    homeHint: 'Börja med en lektion, träna sedan orden med flashcards.',
  },
} as const;
