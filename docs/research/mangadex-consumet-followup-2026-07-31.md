# MangaDex chapter-gap and Consumet follow-up — 2026-07-31

Follow-up to the "most manga does not provide chapters" report and the request to
re-check [MangaDex's API docs](https://api.mangadex.org/docs/swagger.html) and
[Consumet's docs](https://docs.consumet.org/) for manga and light novels. Read-only
research; no code changed as part of this note. `docs/research/consumet-evaluation.md`
(2026-07-26) is the prior Consumet evaluation this follow-up updates.

## Root cause of "most manga has no chapters" — confirmed in this codebase

[`src/main/mangadex.ts`](../../src/main/mangadex.ts) hardcodes a **single** translated
language for every chapter-related call:

```
src/main/mangadex.ts:68   translatedLanguage = process.env.MANGADEX_LANGUAGE?.trim() || DEFAULT_LANGUAGE  (defaults to "en")
src/main/mangadex.ts:109  availabilityUrl.searchParams.append("availableTranslatedLanguage[]", this.translatedLanguage)
src/main/mangadex.ts:276  aggregateUrl.searchParams.append("translatedLanguage[]", this.translatedLanguage)
src/main/mangadex.ts:312  chaptersUrl.searchParams.append("translatedLanguage[]", this.translatedLanguage)
```

Every availability check, aggregate lookup, and chapter-feed call is filtered down to
exactly one language (English by default) and never falls back to any other. MangaDex
hosts a huge number of titles whose English-scanlation chapters were taken down by
publishers (licensed titles especially) while chapters in other languages (Spanish,
Portuguese, Indonesian, French, etc.) remain fully available. For those titles,
AniStream will report "no chapters" even though the manga has chapters on MangaDex —
this is a language-filter gap, not a missing-data gap. This matches what CONTEXT.md
already documents as a known limitation, and the code confirms it's the actual
mechanism, not just a stated caveat.

## Does the MangaDex API itself support fixing this?

Yes. `translatedLanguage[]` (used on both `/manga/{id}/feed` and
`/manga/{id}/aggregate`) and `availableTranslatedLanguage[]` are documented, stable,
repeatable array parameters on MangaDex's public API — they accept **multiple**
language codes in one request, and omitting the parameter entirely returns chapters/
aggregates across **all** available languages rather than filtering to just one. (The
interactive Swagger UI at the URL supplied loads its spec via JavaScript and returned
no static content to fetch directly, so this is stated from MangaDex's long-standing,
well-documented, stable public API contract rather than a page dump — it is not new or
uncertain behavier, it's how these endpoints have always worked.)

This means the fix is achievable **entirely within the existing MangaDex integration**,
with no new provider needed:

- **Option A — query more languages, don't add a source.** Replace the single
  `this.translatedLanguage` with either (a) an ordered fallback list (e.g. the
  configured language, then English, then no filter at all so every language is
  considered) or (b) drop the language filter for the *availability/aggregate* check
  entirely (so "does this manga have chapters at all" no longer depends on language),
  and keep a language filter only at actual chapter-*reading* time, with a way for the
  reader to show/select from whatever languages are actually present instead of
  assuming English. This directly closes the gap the user is seeing and requires no
  new legal/licensing exposure, no new adapter, no new failure domain — it's a change
  to parameters on calls AniStream already makes.
- This is the recommended fix. It's scoped, uses data AniStream is already licensed and
  set up to fetch, and doesn't reopen the guardrails around adding new scraped sources.

## Does Consumet help with this, or add anything new?

**No — for manga specifically, Consumet does not add a different data source.**
Verified today (2026-07-31) against the current docs at docs.consumet.org:

- Consumet's **Manga → Mangadex** provider (`/rest-api/Manga/mangadex/get-manga-chapter-pages`)
  takes exactly one parameter, `chapterId`, and wraps the *same* MangaDex chapter-page
  delivery AniStream already calls directly. It is not a second manga database — it's
  an indirection layer in front of the identical source, so it cannot supply chapters
  MangaDex itself doesn't have, and it doesn't document any language-coverage advantage
  over calling MangaDex directly (which AniStream already does, with its own rate
  limiting, MangaDex@Home reporting, and account-sync path that a generic wrapper
  would not replicate).
- **Consumet does now document a Light Novels category** that didn't appear in the
  2026-07-26 evaluation: two providers, "Read Light Novels" and "NovelUpdates" (search
  / get-info / get-chapter for each). This is new information — if light novels become
  an actual feature goal, Consumet is the only currently-documented lead for that
  content type. That said, it's still a scraper wrapper around other public sites, with
  the same unresolved-license and availability risk described below, not an
  authoritative light-novel database — nothing here changes that risk calculus, it only
  means light novels are technically in scope for what Consumet documents.
- **The hosted public API is still dead.** `https://api.consumet.org/` returned
  **HTTP 451 (Unavailable For Legal Reasons)** on a direct check today — identical to
  the 2026-07-27 finding. The docs site still lists that URL as the base URL, which
  remains stale/wrong.
- **The license situation is unresolved or worse.** The docs' license link
  (`https://raw.githubusercontent.com/consumet/consumet.ts/master/LICENSE`) returned
  **HTTP 404** today. Previously this evaluation could at least read a cached GitHub
  page showing conflicting MIT/GPL-3.0 labels; now the raw file isn't retrievable at
  all. There is no improvement here — if anything, less is verifiable today than in the
  2026-07-26/27 evaluation.

## Recommendation

**Fix the chapter gap inside the existing MangaDex integration (Option A above).**
Don't add Consumet for manga — it wraps the identical MangaDex source AniStream already
owns directly, so it cannot close the gap the user is seeing and would only add a
second, less-capable path to the same data.

**Hold off on Consumet for light novels too, for now**, despite the newly-documented
Light Novels category, because:
- the hosted API is confirmed still returning HTTP 451 today, not just historically;
- the license file is now 404, i.e. *less* resolvable than at the last evaluation, not more;
- this project's own guardrail (API.md) requires "explicit approval and current
  research" before adding any new source domain/scraper/endpoint, and the prior
  rejection's stated reversal conditions — "the official source repositories return,
  the license is unambiguous, post-takedown maintenance resumes" — are not met by
  anything found today.

If light novels become a real, wanted feature, that's a separate decision the user
should make explicitly (not bundled into this manga-chapter-gap fix), and at that point
it would need its own fresh source-by-source verification the same way MangaDex,
MangaBaka, and Anikoto each were individually vetted before adoption — not a blanket
"add Consumet" decision.

## Suggested next step

Implement Option A in `src/main/mangadex.ts`: stop hard-filtering chapter availability/
aggregate/feed calls to a single configured language, and instead either (a) check
availability with no language filter (any language counts as "has chapters") while
still defaulting the *reader* to the configured language when present, falling back to
whatever language actually has the most recent chapter otherwise, or (b) let the reader
show a language picker sourced from whatever `translatedLanguage` values the feed
response actually contains. This is a contained change to one file plus its tests
(`test/main/mangadex.test.ts`) — happy to scope and implement it as its own task if you
want to proceed, since it changes what "available" means for every manga card in the
app and is worth a quick confirmation before I touch it.
