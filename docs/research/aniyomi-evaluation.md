# Aniyomi evaluation for AniStream

Verified: 2026-07-27

## Conclusion

Aniyomi is useful to AniStream as an architecture and product-behavior reference, but it is not a drop-in dependency. AniStream should adapt Aniyomi's narrow source contracts, independent source failures, local-library model, progress/history handling, and source-migration workflow. It should not attempt to load Aniyomi extension APKs or embed the Android application.

## Verified facts

- The main repository is active. A shallow clone of `main` on 2026-07-27 resolved to commit `122a773b2bb3291fbae01e7a514e7761a4ec6588`, dated 2026-07-25.
- The application is Kotlin/Android, requires Android 8 or later, and is licensed under Apache-2.0. Its README describes local anime/manga, an mpv-android player, a configurable reader, library categories, backups, scheduled updates, and tracker integrations.
- Its repository is divided into explicit modules including `app`, `data`, `domain`, `source-api`, and `source-local`.
- `source-api` separates manga and anime providers:
  - A manga source supplies details, chapters, and ordered pages.
  - An anime source supplies details, seasons, episodes, hosters, and video variants.
  - Its video value includes URL, quality/resolution, request headers, subtitle/audio tracks, timestamps, and player arguments.
- Source extensions are Android packages. The app discovers and validates installed packages through Android's `PackageManager`, and extension installation uses the APK MIME type. These packages cannot be loaded directly by Electron or Node.
- The old official `aniyomi-extensions` catalog was archived on 2025-07-05. Aniyomi announced on 2024-07-05 that it had removed its extension list, was moving to a bring-your-own-content model, would not support unofficial repositories, and could not guarantee old extensions would keep working.
- Aniyomi documentation describes global search across installed sources and source-specific browse/search.
- Standard tracker synchronization is one-way from Aniyomi to the tracker. The docs list AniList among supported trackers and say offline progress is sent when connectivity returns. This is not equivalent to AniStream's planned two-way/conflict-safe synchronization.
- Local files are first-class sources. Current documentation describes local `.mp4`/`.mkv` anime and structured local manga, with optional JSON metadata.

## What AniStream can reuse

### Adapt the ideas

1. **Provider contracts**
   - Keep separate `AnimeVideoSource` and `MangaPageSource` contracts.
   - Normalize provider output before it reaches the renderer.
   - Include provider-specific request headers alongside resolved media URLs; many extracted links will not work without them.
   - Model an anime resolution chain as title mapping → seasons/episodes → hoster → playable variants.

2. **Domain separation**
   - Keep catalog metadata, source availability, local library state, tracker state, and playback state as separate records.
   - Keep source adapters outside UI components and make each source independently removable.

3. **Failure and migration behavior**
   - Record which source supplied an item without making that source the canonical identity.
   - Support remapping a library item to a replacement source when a scraper disappears.
   - Preserve watched/read progress during source migration.

4. **Local media as a durable fallback**
   - A future local-file adapter would fit the same contracts as HLS/torrent adapters and reduce dependence on fragile sites.

5. **Backup scope**
   - AniStream backups should include library entries, categories, progress/history, mappings, source settings, and pending sync work, but treat downloaded media as separately managed bulk data.

### Do not reuse directly

- Do not load Aniyomi APK extensions. That requires Android runtime services, package metadata, Android networking/UI dependencies, and Kotlin interfaces.
- Do not port its complete application or Android UI layer. AniStream already has an Electron/React desktop stack and different macOS interaction needs.
- Do not import an unofficial Aniyomi extension catalog as a trusted registry. It is third-party executable code, its provenance varies, and Aniyomi itself warns about malware risk.
- Do not copy provider implementations merely because Apache-2.0 permits reuse. Verify each target's current behavior and legal/ToS implications, and retain required license notices for any copied code.
- Do not copy Aniyomi's one-way tracker semantics. AniStream has explicitly chosen fuller AniList and MangaDex synchronization.

## Recommendation

**Adapt, do not integrate.**

For AniStream's TypeScript codebase, create native provider interfaces inspired by the shape of Aniyomi's `source-api`, then implement and test TypeScript adapters in the trusted Electron main process. Treat Aniyomi as evidence that provider isolation, source migration, local media, and a rich normalized video value are proven patterns. It does not replace AniList or MangaDex, and it does not provide a supported catalog of streaming sources.

## Sources

- [Aniyomi repository and README](https://github.com/aniyomiorg/aniyomi)
- [Aniyomi `source-api` module](https://github.com/aniyomiorg/aniyomi/tree/main/source-api)
- [Aniyomi extension-list removal announcement](https://aniyomi.org/news/2024-07-05-extensions-removal)
- [Aniyomi getting-started guide](https://aniyomi.org/docs/guides/getting-started)
- [Aniyomi tracking guide](https://aniyomi.org/docs/guides/tracking)
- [Aniyomi local anime guide](https://aniyomi.org/docs/guides/local-anime-source/)
- [Archived official extension repository](https://github.com/aniyomiorg/aniyomi-extensions)
