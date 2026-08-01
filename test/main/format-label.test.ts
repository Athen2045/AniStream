import { describe, expect, it } from "vitest";
import { formatMediaLabel } from "../../src/renderer/src/format-label";

describe("media format labels", () => {
  it("keeps common media acronyms uppercase", () => {
    expect(formatMediaLabel("ONA")).toBe("ONA");
    expect(formatMediaLabel("TV")).toBe("TV");
    expect(formatMediaLabel("TV_SHORT")).toBe("TV Short");
  });
});
