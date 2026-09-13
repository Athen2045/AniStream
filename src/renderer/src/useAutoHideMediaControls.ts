import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_HIDE_DELAY_MS = 2_400;

export function useAutoHideMediaControls(hideDelayMs = DEFAULT_HIDE_DELAY_MS) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinned = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimer();
    if (pinned.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (!pinned.current) setVisible(false);
    }, hideDelayMs);
  }, [clearTimer, hideDelayMs]);

  const reveal = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const setPinned = useCallback(
    (next: boolean) => {
      pinned.current = next;
      if (next) {
        clearTimer();
        setVisible(true);
      } else {
        scheduleHide();
      }
    },
    [clearTimer, scheduleHide],
  );

  useEffect(() => {
    scheduleHide();
    return clearTimer;
  }, [clearTimer, scheduleHide]);

  return { visible, reveal, setPinned };
}
