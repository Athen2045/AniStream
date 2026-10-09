import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 340;
const VIEWPORT_MARGIN = 12;

/**
 * Themed replacement for the native `<select>`, whose popup is drawn by the OS and ignores the
 * app's dark styling. Follows the WAI-ARIA select-only combobox pattern: the trigger keeps focus
 * and owns keyboard handling; the listbox is portaled to `<body>` so dialogs and rails with
 * `overflow: hidden` cannot clip it.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled = false,
}: {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<React.CSSProperties>();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = (index = selectedIndex): void => {
    if (disabled || !options.length) return;
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  };

  const commit = (index: number): void => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close(true);
  };

  // Position against the trigger; open upward when there is not enough room below.
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const below = window.innerHeight - trigger.bottom - VIEWPORT_MARGIN;
      const above = trigger.top - VIEWPORT_MARGIN;
      const upward = below < Math.min(MENU_MAX_HEIGHT, 220) && above > below;
      // Grow away from the nearer window edge so long labels never run off-screen.
      const alignRight = trigger.left + trigger.width / 2 > window.innerWidth / 2;
      const room = alignRight
        ? trigger.right - VIEWPORT_MARGIN
        : window.innerWidth - trigger.left - VIEWPORT_MARGIN;
      setPlacement({
        ...(alignRight
          ? { right: document.documentElement.clientWidth - trigger.right }
          : { left: Math.max(VIEWPORT_MARGIN, trigger.left) }),
        minWidth: Math.min(Math.max(trigger.width, 180), room),
        maxWidth: room,
        maxHeight: Math.min(MENU_MAX_HEIGHT, (upward ? above : below) - MENU_GAP),
        ...(upward
          ? { bottom: window.innerHeight - trigger.top + MENU_GAP }
          : { top: trigger.bottom + MENU_GAP }),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Close on outside pointer, page scroll (not the list's own scroll), or window blur.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) close(false);
    };
    const onScroll = (event: Event): void => {
      if (!listRef.current?.contains(event.target as Node)) close(false);
    };
    const onBlur = (): void => close(false);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, placement]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return;
    const last = options.length - 1;
    const move = (index: number): void => {
      event.preventDefault();
      if (open) setActiveIndex(Math.max(0, Math.min(last, index)));
      else openMenu(Math.max(0, Math.min(last, index)));
    };
    switch (event.key) {
      case "ArrowDown":
        return open ? move(activeIndex + 1) : move(selectedIndex < 0 ? 0 : selectedIndex);
      case "ArrowUp":
        return open ? move(activeIndex - 1) : move(selectedIndex < 0 ? 0 : selectedIndex);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "PageDown":
        return move(activeIndex + 8);
      case "PageUp":
        return move(activeIndex - 8);
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) commit(activeIndex);
        else openMenu();
        return;
      case "Escape":
        if (open) {
          // Close only the menu, not an enclosing dialog that also listens for Escape.
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
        return;
      case "Tab":
        if (open) close(false);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const now = Date.now();
          const state = typeahead.current;
          state.text = now - state.at > 700 ? event.key : state.text + event.key;
          state.at = now;
          const query = state.text.toLocaleLowerCase();
          const start = open ? activeIndex : selectedIndex;
          const ordered = options.map((_, offset) => (start + 1 + offset) % options.length);
          const match = ordered.find((index) =>
            options[index]?.label.toLocaleLowerCase().startsWith(query),
          );
          if (match !== undefined) {
            if (open) setActiveIndex(match);
            else if (options[match]?.value !== value) onChange(options[match].value);
          }
        }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`ui-select${className ? ` ${className}` : ""}${open ? " is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(true) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="ui-select-value">{selected?.label ?? ""}</span>
        <ChevronDown className="ui-select-chevron" size={16} aria-hidden="true" />
      </button>
      {open && placement
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              className="ui-select-menu"
              style={placement}
              tabIndex={-1}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={index === activeIndex ? "is-active" : undefined}
                  onPointerMove={() => setActiveIndex(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => commit(index)}
                >
                  <span>{option.label}</span>
                  {index === selectedIndex ? <Check size={15} aria-hidden="true" /> : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
