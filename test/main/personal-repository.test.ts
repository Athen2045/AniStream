import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createPersonalRepository } from "../../src/main/personal-repository";

describe("release acknowledgement persistence", () => {
  it("survives repository recreation and cannot move an acknowledgement backwards", () => {
    const database = new Database(":memory:");
    try {
      const first = createPersonalRepository(database);
      first.acknowledgeRelease({ key: "ANIME:10", unit: 5 });
      first.acknowledgeRelease({ key: "ANIME:10", unit: 3 });
      first.acknowledgeRelease({ key: "MANGA:20:pt-br", unit: 4.5 });
      expect(createPersonalRepository(database).getReleaseAcknowledgements()).toEqual(
        expect.arrayContaining([
          { key: "ANIME:10", unit: 5 },
          { key: "MANGA:20:pt-br", unit: 4.5 },
        ]),
      );
    } finally {
      database.close();
    }
  });
  it("rejects malformed keys and non-finite progress at the persistence boundary", () => {
    const database = new Database(":memory:");
    try {
      const repository = createPersonalRepository(database);
      for (const item of [
        { key: "anything", unit: 5 },
        { key: "ANIME:10", unit: NaN },
        { key: "MANGA:0:en", unit: 3 },
      ])
        expect(() => repository.acknowledgeRelease(item)).toThrow();
      expect(repository.getReleaseAcknowledgements()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
