import { describe, expect, it } from "vitest";
import { cleanDisplayText, decodeHtmlEntities } from "../../src/shared/text";

describe("display text normalization", () => {
  it("decodes named and numeric HTML entities", () => {
    expect(decodeHtmlEntities("I&#39;m &amp; &#x27;ready&#x27; &quot;now&quot;.")).toBe(
      "I'm & 'ready' \"now\".",
    );
  });

  it("strips provider markup after decoding encoded markup", () => {
    expect(cleanDisplayText("&lt;p&gt;Hello&nbsp;world&lt;/p&gt;")).toBe("Hello world");
  });
});
