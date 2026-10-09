import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_FOOTER, LEGAL_POLICY } from "../../src/renderer/src/legal";

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

describe("Copyright & DMCA notice", () => {
  it("keeps LEGAL.md word for word in step with the in-app policy", () => {
    const markdown = flat(readFileSync(join(__dirname, "../../LEGAL.md"), "utf8"));
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
