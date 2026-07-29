import { describe, expect, it } from "vitest";
import { parseAnimeToshoJson, parseNyaaRss } from "../../src/main/anime-sources";

describe("approved torrent source normalization", () => {
  it("normalizes a Nyaa RSS item without exposing XML to callers", () => {
    const candidates = parseNyaaRss(`
      <rss><channel><item>
        <title><![CDATA[[Group] Example - 01 [1080p]]]></title>
        <nyaa:magneturl>magnet:?xt=urn:btih:abc&amp;dn=example</nyaa:magneturl>
        <nyaa:seeders>42</nyaa:seeders>
        <nyaa:size>1234</nyaa:size>
      </item></channel></rss>
    `);
    expect(candidates).toMatchObject([
      {
        kind: "torrent",
        label: "[Group] Example - 01 [1080p]",
        quality: "1080p",
        seeders: 42,
        sizeBytes: 1234,
      },
    ]);
    expect(candidates[0]?.url).toBe("magnet:?xt=urn:btih:abc&dn=example");
  });

  it("rejects malformed torrent entries and normalizes valid AnimeTosho entries", () => {
    expect(
      parseAnimeToshoJson([
        { title: "Broken" },
        {
          title: "[Group] Example - 01 [720p]",
          magnet_uri: "magnet:?xt=urn:btih:def",
          seeders: 7,
          total_size: 99,
        },
      ]),
    ).toMatchObject([{ kind: "torrent", quality: "720p", seeders: 7, sizeBytes: 99 }]);
  });
});
