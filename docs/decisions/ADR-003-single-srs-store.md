Context: Multiple practice surfaces (flashcards, drills, lessons) grade the same vocabulary and must agree on scheduling.
Decision: All spaced-repetition state lives in the single localStorage-backed `Store` (`dansk4svensk:srs:v1`, records keyed `vocabId::direction`); no feature creates a parallel store.
Consequence: New practice modes write through `Store.grade` against existing directions so dueness stays consistent everywhere; a card graded on one surface leaves every surface's due queue at once.
