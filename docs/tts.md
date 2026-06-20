# Pronunciation audio (Azure TTS)

Danish pronunciation in the app plays **pre-generated native neural audio** so it
sounds native everywhere — not the robotic/American voice browsers substitute
when no `da-DK` Web Speech voice is installed.

The clips are generated **once**, committed under `public/audio/`, and shipped as
static assets. There is no runtime backend and **CI/deploy needs no API key** —
it just builds the site with the committed MP3s. Web Speech remains a last-resort
fallback when a clip is missing.

## Regenerating audio

Needed only when vocab is added/changed (new or edited cards). Existing clips are
skipped, so this is cheap and incremental.

1. Create an [Azure AI Speech](https://portal.azure.com/) resource (the free
   F0 tier covers this deck many times over) and copy its key + region.
2. `cp .env.example .env` and fill in `AZURE_SPEECH_KEY` and
   `AZURE_SPEECH_REGION` (e.g. `westeurope`). `.env` is gitignored.
3. Run the generator:

   ```sh
   AZURE_SPEECH_KEY=… AZURE_SPEECH_REGION=westeurope npm run tts
   ```

   - Generates a word clip (`<id>.mp3`) and an example-sentence clip
     (`<id>-ex.mp3`) per card into `public/audio/`.
   - Rewrites `src/data/vocab/starter-deck.csv` `audio` / `audio_example`
     columns to base-relative paths (the UI resolves them via `withBase()`).
   - **Skips clips that already exist.** Pass `--force` to regenerate all.
   - `AZURE_SPEECH_VOICE` overrides the voice (default `da-DK-ChristelNeural`;
     `da-DK-JeppeNeural` is the male alternative).

4. Commit the new `public/audio/*.mp3` and the updated CSV.

Filenames use the same stable `deriveId(danish, pos)` id the app uses at build
time, so clips always line up with their cards.
