export function createMorePlayerLoadGuard(
  onTimeout: () => void,
  timeoutMs: number,
): {
  start(): void;
  markLoaded(): void;
  dispose(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loaded = false;

  function clear(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  return {
    start() {
      clear();
      loaded = false;
      timer = setTimeout(() => {
        timer = undefined;
        if (!loaded) onTimeout();
      }, timeoutMs);
    },
    markLoaded() {
      loaded = true;
      clear();
    },
    dispose() {
      clear();
    },
  };
}
