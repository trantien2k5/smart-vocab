# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Vocab Sprout (🌱) is a Vietnamese-language, client-only vocabulary learning web app (no backend, no build step, no npm dependencies). It's a single `index.html` plus three plain `<script>` files, run directly in a browser. All data persists in `localStorage`. UI strings/content are in Vietnamese.

## Commands

- **Run the app**: open `index.html` directly in a browser (e.g. via a local static server or double-click). No build/install step exists.
- **Check for syntax/reference errors**: `node check.js` — validates that `index.html`'s linked CSS/JS files exist, checks CSS brace/paren balance, syntax-checks the JS files, and does a mocked DOM dry-run of app init (`loadData()`, `applySettingsUI()`, `renderHome()`). Run this after editing `index.html`, `css/style.css`, `data/words.js`, `js/fsrs.js`, or `js/app.js`.
- There is no test suite, linter, or package.json — `check.js` is the only automated verification available.

## Architecture

Load order (from `index.html`): `data/words.js` → `js/fsrs.js` → `js/app.js`. All three define globals consumed by later scripts and by inline `onclick=` handlers in `index.html` — there is no module system, so new functions referenced from HTML must be attached as globals (plain `function foo(){}` at top level).

### `data/words.js` — seed vocabulary
- `LEGACY_STARTER_WORDS`: kept only so `loadData()` can prune old pre-finance seed words from existing users' saved data once; not used to seed new installs.
- Topic word arrays (e.g. `TOPIC_FINANCE_WORDS`, `TOPIC_WORK_OFFICE_WORDS`) hold the actual seed vocab, each entry with `word/ipa/pos/meaning/example/exampleVi/collocations/synonyms/antonyms/cefr/note/topic`.
- `ALL_TOPIC_WORDS` concatenates all topic arrays — this is what actually seeds new installs and is diffed against existing saved words to auto-add newly introduced words to existing users (see `loadData()` in app.js). **To add a new word topic: add a new array here and append it to `ALL_TOPIC_WORDS`.**

### `js/fsrs.js` — spaced repetition engine
Self-contained FSRS-6 implementation (verified against the official spec / same default weights as `py-fsrs`/`ts-fsrs`), exposed as the `FSRS` global with `schedule`, `previewIntervals`, `formatInterval`, `retrievability`. `schedule(card, grade, now, opts)` is the core entry point: given a card's current FSRS state and a grade (1=Again, 2=Hard, 3=Good, 4=Easy), returns the next `{difficulty, stability, retrievability, due, lastReview, intervalDays, reps, lapses, state}`. `opts.retention` (desired retention target) and `opts.fuzz` (interval randomization) are user-configurable via Settings. This file has no dependency on the DOM or `app.js` and could be unit-tested in isolation.

### `js/app.js` — all application logic and rendering
Single flat script (no classes/modules) organized by section comments: TTS, NAV, HOME, SHARED CARD RENDER, LEARN, REVIEW, STATS, SETTINGS, MODALS, HELPERS, INIT. Key structural points:

- **State**: `words` (array of card objects, each created by `makeCard()` and persisted via `saveWords()`/`localStorage` under `DB_KEY`), `settings` (`SET_KEY`), `dailyLog` (per-day activity stats, `LOG_KEY`). `loadData()` at the bottom of the file bootstraps all three from `localStorage`, seeding `words` from `ALL_TOPIC_WORDS` on first run and merging in newly-added topic words on later runs.
- **Card object shape** (from `makeCard`): identity/content fields from the word data, plus FSRS fields (`state`, `difficulty`, `stability`, `due`, `lastReview`, `reps`, `lapses`) and weak-word tracking fields (`correctCount`, `wrongCount`, `lastGrade`, `wrongStreak`).
- **Navigation**: `goTab(tab)` toggles `.screen`/`.nav-btn` classes and calls the matching `render*()` function; there's no router, just direct DOM class toggling. Nested "study" sub-views within Learn/Review/Stats tabs are shown/hidden by toggling `display` on their container divs rather than being separate tabs.
- **Weak-word detection** (`isWordWeak`/`weakScore`/`getWeakWords`): based on accumulated review history (wrong count, accuracy, last grade, FSRS stability, wrong streak), not a single answer — used to power the "Từ yếu" (weak words) feature in both Review and Stats tabs.
- **Study queue ordering**: `priorityOrder()` (used for Learn/new-word sessions) tiers words weak → recently-seen → hard → normal → mastered, shuffling within each tier. `overdueOrder()` (used for Review sessions) buckets due words by due-day and orders most-overdue-first with light shuffling within the same due-day. Keep these two distinct — they serve different UX goals (teaching new content vs. clearing the review backlog).
- **Learn vs. Review are separate flows** with parallel but independent queue/state variables (`learnQueue`/`learnIdx`/... vs. `reviewQueue`/`reviewIdx`/...) and parallel grading functions (`learnRate` vs. `gradeReviewWord`) — when fixing a bug in one, check whether the same bug exists in the other.
- **Review has 3 interchangeable card modes** sharing one queue/progress mechanism: Flashcard (`drawFlashcardReview`), Trắc nghiệm/quiz (`drawQuizReview`, with smart distractor picking via `pickSmartDistractors`/`distractorScore`), and Gõ từ/typing (`drawTypingReview`). Review also has a non-FSRS "practice mode" (`isPracticeMode`) for Quick Practice and Weak Practice — these grade for stats/UI feedback only and never call `FSRS.schedule`, so they don't affect the real spaced-repetition schedule.
- **Grading always flows through**: `FSRS.schedule()` → `Object.assign(card, result)` → `updateWeakTracking()` → `saveWords()` → `logStudyActivity()`/`logEvent()`. When a card is graded "Again" (1) mid-session, it's spliced back into the queue a few items later rather than dropped, both in Learn and Review.
- **Rendering helpers are shared** between Learn and Review flashcards: `cardFrontHTML()`/`cardBackHTML()` respect the per-field visibility toggles in `settings` (`showIpa`, `showPos`, `showRetrievability`, etc., configured via the "Thông tin hiển thị trên thẻ" modal).
- **XSS-safety**: any user-authored or word-data string interpolated into `innerHTML` must go through `esc()` (HTML-escape) or `escJs()` (for values placed inside an inline `onclick="...'...'"` JS string) — see existing call sites for the pattern.
- **Import/export/reset**: `exportData()`/`submitRestore()` round-trip `{words, dailyLog}` as JSON for backup; `performReset()` clears all three localStorage keys and reloads.

### `css/style.css`
Plain CSS with custom properties for theming (light/dark via `settings.theme`, toggled by setting `document.documentElement.className`). No preprocessor, no build step.
