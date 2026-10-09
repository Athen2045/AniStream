#!/usr/bin/env node
// One-time, paced capture of a public AniList library for the offline recommendation harness.
// Usage: node scripts/capture-recommendation-fixture.mjs <anilist-username>
// Output: test/fixtures/personal/anilist-<username>.json (gitignored; never commit it).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.anilist.co";
const USER_AGENT = "AniStream-dev/recommendation-fixture (local evaluation harness)";
const MIN_INTERVAL_MS = 3_000; // Conservative app policy under AniList's degraded 30 req/min.
const MAX_RETRIES = 3;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const userName = process.argv[2];
if (!userName || !/^[A-Za-z0-9_-]{2,20}$/.test(userName)) {
  console.error("Usage: node scripts/capture-recommendation-fixture.mjs <anilist-username>");
  process.exit(1);
}
const outFile = join(root, "test", "fixtures", "personal", `anilist-${userName}.json`);

const MEDIA_FIELDS = `
  id type format status episodes chapters genres averageScore meanScore popularity favourites
  seasonYear countryOfOrigin isAdult
  title { romaji english userPreferred }
  startDate { year }
  tags { id name rank category isMediaSpoiler }
  studios(isMain: true) { nodes { id name } }
  staff(perPage: 6, sort: [RELEVANCE, ID]) { edges { role node { id name { full } } } }`;

const SEED_FIELDS = `${MEDIA_FIELDS}
  recommendations(perPage: 12, sort: [RATING_DESC, ID]) {
    nodes { rating mediaRecommendation { id type } }
  }
  relations { edges { relationType node { id type } } }`;

const LIST_QUERY = `query ($userName: String!, $type: MediaType!) {
  MediaListCollection(userName: $userName, type: $type) {
    lists { entries {
      mediaId status score(format: POINT_10_DECIMAL) progress repeat updatedAt
      startedAt { year month day } completedAt { year month day }
    } }
  }
}`;

const MEDIA_QUERY = (fields) => `query ($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 25) { media(id_in: $ids) { ${fields} } }
}`;

const BROWSE_QUERY = `query ($type: MediaType, $genre: String, $sort: [MediaSort]) {
  Page(page: 1, perPage: 20) {
    media(type: $type, genre: $genre, sort: $sort, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

let lastRequestAt = 0;
let requestCount = 0;

async function graphql(query, variables) {
  for (let attempt = 0; ; attempt += 1) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount += 1;
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after")) || 60;
      console.warn(`429 from AniList; waiting ${retryAfter}s (attempt ${attempt + 1}).`);
      await sleep(retryAfter * 1000);
      continue;
    }
    if (response.status === 403) throw new Error("AniList returned 403; stopping.");
    const body = await response.json();
    if (!response.ok || body.errors?.length)
      throw new Error(`AniList ${response.status}: ${JSON.stringify(body.errors ?? body)}`);
    return body.data;
  }
}

async function loadMedia(ids, fields) {
  const byId = new Map();
  for (let index = 0; index < ids.length; index += 25) {
    const chunk = ids.slice(index, index + 25);
    const data = await graphql(MEDIA_QUERY(fields), { ids: chunk, page: 1 });
    for (const media of data.Page.media) byId.set(media.id, media);
    process.stdout.write(`  media ${Math.min(index + 25, ids.length)}/${ids.length}\r`);
  }
  process.stdout.write("\n");
  return byId;
}

async function main() {
  const existing = await readFile(outFile, "utf8").catch(() => undefined);
  if (existing && !process.argv.includes("--force")) {
    console.log(`Fixture already exists: ${outFile} (pass --force to recapture).`);
    return;
  }

  const lists = {};
  for (const type of ["ANIME", "MANGA"]) {
    const data = await graphql(LIST_QUERY, { userName, type });
    const entries = data.MediaListCollection.lists.flatMap((list) => list.entries);
    lists[type] = [...new Map(entries.map((entry) => [entry.mediaId, entry])).values()];
    console.log(`${type}: ${lists[type].length} entries`);
  }

  const libraryIds = [...lists.ANIME, ...lists.MANGA].map((entry) => entry.mediaId);
  console.log("Loading library media with recommendations…");
  const seeds = await loadMedia(libraryIds, SEED_FIELDS);

  const library = new Set(libraryIds);
  const recommended = new Set();
  for (const media of seeds.values())
    for (const node of media.recommendations?.nodes ?? [])
      if (node.mediaRecommendation && !library.has(node.mediaRecommendation.id))
        recommended.add(node.mediaRecommendation.id);
  console.log(`Loading ${recommended.size} recommended candidates…`);
  const candidates = await loadMedia([...recommended], MEDIA_FIELDS);

  console.log("Loading baseline browse pools (trending + per-genre top score)…");
  const genres = [
    ...new Set([...seeds.values(), ...candidates.values()].flatMap((media) => media.genres ?? [])),
  ].sort();
  const browse = [];
  for (const type of ["ANIME", "MANGA"]) {
    for (const genre of [undefined, ...genres]) {
      const sort = genre ? ["SCORE_DESC"] : ["TRENDING_DESC"];
      const data = await graphql(BROWSE_QUERY, { type, genre, sort });
      browse.push({
        type,
        genre: genre ?? null,
        sort: sort[0],
        ids: data.Page.media.map((m) => m.id),
      });
      for (const media of data.Page.media)
        if (!seeds.has(media.id)) candidates.set(media.id, media);
    }
  }

  const fixture = {
    capturedAt: new Date().toISOString(),
    userName,
    lists,
    media: Object.fromEntries([...seeds, ...candidates]),
    browse,
  };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(fixture));
  console.log(
    `Saved ${Object.keys(fixture.media).length} media to ${outFile} (${requestCount} requests).`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
