import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_FOOTER, LEGAL_POLICY } from "../../src/renderer/src/legal";

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
// LEGAL.md may link text (for example to the LICENSE file); the in-app policy shows plain text.
const withoutLinks = (text: string): string => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

describe("Copyright & DMCA notice", () => {
  it("keeps LEGAL.md word for word in step with the in-app policy", () => {
    const markdown = flat(withoutLinks(readFileSync(join(__dirname, "../../LEGAL.md"), "utf8")));
    const texts = [
      LEGAL_FOOTER,
      ...LEGAL_POLICY.flatMap((section) => [
        `## ${section.heading}`,
        ...section.paragraphs,
        ...(section.list ?? []).map((item, index) => `${index + 1}. ${item}`),
        ...(section.after ?? []),
      ]),
    ];
    for (const text of texts) expect(markdown).toContain(flat(text));
  });
});
