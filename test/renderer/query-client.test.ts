import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  createAppQueryClient,
  refetchFailedOnReconnect,
} from "../../src/renderer/src/query-client";

describe("app query client", () => {
  it("runs queries while the device is offline instead of holding them as loading", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    try {
      const client = createAppQueryClient();
      await expect(client.fetchQuery({ queryKey: ["x"], queryFn: async () => 1 })).resolves.toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reloads only the failed queries on screen when the connection returns", async () => {
    const client = createAppQueryClient();
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    let online = false;
    const failing = vi.fn(async () => {
      if (!online) throw new Error("offline");
      return "loaded";
    });
    const fine = vi.fn(async () => "fine");
    const watch = (key: string, queryFn: () => Promise<string>) => {
      const observer = new QueryObserver(client, { queryKey: [key], queryFn });
      const unsubscribe = observer.subscribe(() => undefined);
      return unsubscribe;
    };
    const stopA = watch("failing", failing);
    const stopB = watch("fine", fine);
    await vi.waitFor(() => expect(client.getQueryState(["failing"])?.status).toBe("error"));
    await vi.waitFor(() => expect(client.getQueryData(["fine"])).toBe("fine"));

    const stop = refetchFailedOnReconnect(
      client,
      target as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
      [0],
    );
    online = true;
    listeners.get("online")?.();
    await vi.waitFor(() => expect(client.getQueryData(["failing"])).toBe("loaded"));
    expect(fine).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.has("online")).toBe(false);
    stopA();
    stopB();
  });
});
