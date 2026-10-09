import { describe, expect, it } from "vitest";
import { TmdbClient } from "../../src/main/tmdb";

describe("TMDB More adapter", () => {
  it("normalizes trending results and keeps bearer auth in the main-process client", async () => {
    let requestedUrl = "";
    let authorization = "";
    const client = new TmdbClient("test-token", async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify({
          page: 1,
          total_pages: 2,
          total_results: 1,
          results: [
            {
              id: 27205,
              title: "Inception",
              overview: "A dream heist.",
              poster_path: "/poster.jpg",
              backdrop_path: "/backdrop.jpg",
              release_date: "2010-07-16",
              vote_average: 8.4,
              vote_count: 100,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    await expect(client.getTrending("MOVIE", 1)).resolves.toMatchObject({
      items: [
        {
          id: 27205,
          title: "Inception",
          type: "MOVIE",
          year: 2010,
          posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
          backdropUrl: "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
        },
      ],
    });
    expect(requestedUrl).toContain("/3/trending/movie/week");
    expect(authorization).toBe("Bearer test-token");
  });

  it("reads hero artwork, rating, creators, and network from a show detail", async () => {
    let requestedUrl = "";
    const client = new TmdbClient("test-token", async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        id: 100088,
        name: "Sample Show",
        overview: "A long journey.",
        backdrop_path: "/backdrop.jpg",
        first_air_date: "2023-01-15",
        last_air_date: "2025-05-25",
        original_language: "en",
        status: "Returning Series",
        number_of_seasons: 2,
        number_of_episodes: 16,
        genres: [{ name: "Drama" }],
        created_by: [{ name: "First Creator" }, { name: "Second Creator" }],
        networks: [{ name: "Example Network", logo_path: "/network.png" }],
        seasons: [{ season_number: 1, name: "Season 1", episode_count: 9 }],
        content_ratings: {
          results: [
            { iso_3166_1: "DE", rating: "16" },
            { iso_3166_1: "US", rating: "TV-MA" },
          ],
        },
        images: {
          logos: [
            { iso_639_1: "fr", file_path: "/logo-fr.png" },
            { iso_639_1: "en", file_path: "/logo-en.svg" },
          ],
        },
      });
    });
    await expect(client.getDetail(100088, "TV")).resolves.toMatchObject({
      logoUrl: "https://image.tmdb.org/t/p/w500/logo-en.svg",
      heroBackdropUrl: "https://image.tmdb.org/t/p/original/backdrop.jpg",
      certification: "TV-MA",
      creators: ["First Creator", "Second Creator"],
      originalLanguage: "en",
      lastAirDate: "2025-05-25",
      brandName: "Example Network",
      brandLogoUrl: "https://image.tmdb.org/t/p/w300/network.png",
    });
    expect(requestedUrl).toContain("append_to_response=images%2Ccontent_ratings");
    expect(requestedUrl).toContain("include_image_language=en%2Cnull");
  });

  it("reads a movie's US certification and ignores unsafe artwork paths", async () => {
    const client = new TmdbClient("test-token", async () =>
      jsonResponse({
        id: 27205,
        title: "Sample Movie",
        backdrop_path: "/../escape.jpg",
        runtime: 148,
        release_dates: {
          results: [
            {
              iso_3166_1: "US",
              release_dates: [{ certification: "" }, { certification: "PG-13" }],
            },
          ],
        },
        production_companies: [{ name: "No Logo Studio" }],
        images: { logos: [{ iso_639_1: null, file_path: "javascript:alert(1)" }] },
      }),
    );
    const detail = await client.getDetail(27205, "MOVIE");
    expect(detail).toMatchObject({
      certification: "PG-13",
      brandName: "No Logo Studio",
      creators: [],
    });
    expect(detail.logoUrl).toBeUndefined();
    expect(detail.heroBackdropUrl).toBeUndefined();
    expect(detail.brandLogoUrl).toBeUndefined();
  });

  it("reads lead cast and keeps only well-voted recommendations", async () => {
    let requestedUrl = "";
    const client = new TmdbClient("test-token", async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        id: 361743,
        title: "Sample Movie",
        credits: {
          cast: [
            { name: "Lead", character: "Hero", profile_path: "/lead.jpg" },
            { name: "No Photo", character: "Sidekick" },
            { character: "Nameless" },
            ...Array.from({ length: 10 }, (_, index) => ({ name: `Extra ${index}` })),
          ],
        },
        recommendations: {
          results: [
            { id: 1, title: "Popular Pick", poster_path: "/a.jpg", vote_count: 5000 },
            { id: 2, title: "Obscure Pick", poster_path: "/b.jpg", vote_count: 12 },
            { id: 3, title: "No Poster", vote_count: 9000 },
          ],
        },
      });
    });
    const detail = await client.getDetail(361743, "MOVIE");
    expect(requestedUrl).toContain("credits%2Crecommendations");
    expect(detail.cast).toHaveLength(8);
    expect(detail.cast[0]).toEqual({
      name: "Lead",
      character: "Hero",
      profileUrl: "https://image.tmdb.org/t/p/w185/lead.jpg",
    });
    expect(detail.cast[1]).toEqual({ name: "No Photo", character: "Sidekick" });
    expect(detail.recommendations.map((item) => item.title)).toEqual(["Popular Pick"]);
  });

  it("reads a show's cast roles from aggregate credits", async () => {
    const client = new TmdbClient("test-token", async () =>
      jsonResponse({
        id: 100088,
        name: "Sample Show",
        aggregate_credits: { cast: [{ name: "Star", roles: [{ character: "Captain" }] }] },
      }),
    );
    const detail = await client.getDetail(100088, "TV");
    expect(detail.cast).toEqual([{ name: "Star", character: "Captain" }]);
    expect(detail.recommendations).toEqual([]);
  });

  it("normalizes a season's episodes and rejects malformed seasons", async () => {
    const client = new TmdbClient("test-token", async (input) =>
      String(input).includes("/season/2")
        ? jsonResponse({ name: "Broken" })
        : jsonResponse({
            name: "Season 1",
            episodes: [
              {
                episode_number: 1,
                name: "Pilot",
                still_path: "/still.jpg",
                runtime: 81,
                vote_average: 8.7,
              },
              { episode_number: 0, name: "Invalid" },
              { episode_number: 2, runtime: 0 },
            ],
          }),
    );
    await expect(client.getSeason(100088, 1)).resolves.toEqual({
      seasonNumber: 1,
      name: "Season 1",
      episodes: [
        {
          number: 1,
          name: "Pilot",
          stillUrl: "https://image.tmdb.org/t/p/w780/still.jpg",
          runtimeMinutes: 81,
          score: 8.7,
        },
        { number: 2, name: "Episode 2" },
      ],
    });
    await expect(client.getSeason(100088, 2)).rejects.toThrow(/invalid season/);
    await expect(client.getSeason(100088, -1)).rejects.toThrow(/Invalid TMDB season/);
  });

  it("stops on a 429 instead of retrying", async () => {
    let calls = 0;
    const client = new TmdbClient("test-token", async () => {
      calls += 1;
      return new Response("{}", { status: 429 });
    });
    await expect(client.getSeason(1, 1)).rejects.toThrow(/refused/);
    expect(calls).toBe(1);
  });
});

describe("TMDB host fallback", () => {
  const page = { page: 1, total_pages: 1, total_results: 0, results: [] };

  it("retries a connection failure on the alternate host and keeps preferring it", async () => {
    const hosts: string[] = [];
    const client = new TmdbClient("test-token", async (input) => {
      const url = new URL(String(input));
      hosts.push(url.host);
      if (url.host === "api.themoviedb.org") throw new TypeError("fetch failed");
      expect(url.pathname).toMatch(/^\/3\//);
      return jsonResponse(page);
    });
    await expect(client.getTrending("MOVIE", 1)).resolves.toMatchObject({ items: [] });
    await expect(client.getTrending("TV", 1)).resolves.toMatchObject({ items: [] });
    expect(hosts).toEqual(["api.themoviedb.org", "api.tmdb.org", "api.tmdb.org"]);
  });

  it("does not switch hosts for HTTP errors or rate limits", async () => {
    const hosts: string[] = [];
    const client = new TmdbClient("test-token", async (input) => {
      hosts.push(new URL(String(input)).host);
      return new Response("{}", { status: hosts.length === 1 ? 401 : 429 });
    });
    await expect(client.getTrending("MOVIE", 1)).rejects.toThrow(/failed \(401\)/);
    await expect(client.getTrending("TV", 1)).rejects.toThrow(/refused/);
    expect(hosts).toEqual(["api.themoviedb.org", "api.themoviedb.org"]);
  });

  it("reports the original failure when both hosts are unreachable", async () => {
    let calls = 0;
    const client = new TmdbClient("test-token", async (input) => {
      calls += 1;
      throw new TypeError(`unreachable ${new URL(String(input)).host}`);
    });
    await expect(client.getTrending("MOVIE", 1)).rejects.toThrow(
      /^unreachable api\.themoviedb\.org$/,
    );
    expect(calls).toBe(2);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("More search filters", () => {
  const page = (results: unknown[]) =>
    new Response(
      JSON.stringify({ page: 1, total_pages: 3, total_results: results.length, results }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  const movie = (id: number, extra: Record<string, unknown>) => ({
    id,
    title: `Movie ${id}`,
    release_date: "2024-05-01",
    vote_average: 7.5,
    vote_count: 500,
    popularity: 10,
    genre_ids: [18],
    original_language: "ml",
    ...extra,
  });

  it("browses /discover with genre, language, year, score and sort when there is no title", async () => {
    const urls: URL[] = [];
    const client = new TmdbClient("test-token", async (input) => {
      urls.push(new URL(String(input)));
      return page([{ id: 1, name: "Show 1", first_air_date: "2023-01-01" }]);
    });
    const result = await client.browse({
      type: "TV",
      page: 2,
      genre: "Sci-Fi",
      language: "ko",
      year: 2023,
      minScore: 7,
      sort: "rated",
    });
    const url = urls[0];
    expect(url.pathname).toBe("/3/discover/tv");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      page: "2",
      with_genres: "10765",
      with_original_language: "ko",
      first_air_date_year: "2023",
      "vote_average.gte": "7",
      "vote_count.gte": "300",
      sort_by: "vote_average.desc",
    });
    expect(result.items[0]).toMatchObject({ id: 1, type: "TV" });
    expect(result.pageInfo.hasNextPage).toBe(true);
  });

  it("narrows title search results by the same filters, and skips a type without the genre", async () => {
    const urls: URL[] = [];
    const client = new TmdbClient("test-token", async (input) => {
      urls.push(new URL(String(input)));
      return page([
        movie(1, {}),
        movie(2, { original_language: "en" }),
        movie(3, { genre_ids: [35] }),
        movie(4, { release_date: "2019-01-01" }),
        movie(5, { vote_average: 9, vote_count: 3 }),
        movie(6, { popularity: 99 }),
      ]);
    });
    const result = await client.browse({
      type: "MOVIE",
      page: 1,
      query: "home",
      genre: "Drama",
      language: "ml",
      year: 2024,
      minScore: 7,
      sort: "popular",
    });
    expect(urls[0].pathname).toBe("/3/search/movie");
    expect(result.items.map((item) => item.id)).toEqual([6, 1]);
    // Few matches per page: up to three search pages are read, and paging continues after them.
    expect(urls.map((url) => url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(result.pageInfo.currentPage).toBe(3);
    // TMDB has no Horror genre for shows: nothing is requested.
    const before = urls.length;
    expect(
      (await client.browse({ type: "TV", page: 1, genre: "Horror", sort: "popular" })).items,
    ).toEqual([]);
    expect(urls.length).toBe(before);
  });
});
