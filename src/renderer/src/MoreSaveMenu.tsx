import { Bookmark, Check, CheckCheck, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MoreTitleStatusAction } from "../../shared/contracts";

/**
 * The More "+" button: a small menu to plan a title or mark it already watched. The menu renders
 * in a portal so carousels and hover cards that clip their content cannot cut it off.
 */
export function MoreSaveMenu({
  title,
  saved,
  completed,
  onAction,
  className,
  iconSize = 18,
}: {
  title: string;
  saved: boolean;
  completed: boolean;
  onAction: (action: MoreTitleStatusAction) => void;
  className?: string;
  iconSize?: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = 260;
    // Open below the button, or above it when the window has no room underneath.
    const height = 132;
    const below = rect.bottom + 8;
    setPosition({
      top: below + height > window.innerHeight - 8 ? Math.max(8, rect.top - 8 - height) : below,
      left: Math.max(
        8,
        Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2),
      ),
    });
  }, [open]);

  // Move focus into the menu once it exists, without scrolling the rail behind it.
  useEffect(() => {
    if (open && position)
      menu.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (menu.current?.contains(target) || button.current?.contains(target))) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const dismiss = (): void => setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const choose = (action: MoreTitleStatusAction): void => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
    onAction(action);
  };
  const state = completed ? "Completed" : saved ? "In My Watch List" : undefined;

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={`${state ? `${state}: ` : ""}Save options for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={state ?? "Save"}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        {completed ? (
          <CheckCheck size={iconSize} />
        ) : saved ? (
          <Check size={iconSize} />
        ) : (
          <Plus size={iconSize} />
        )}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menu}
              id={menuId}
              className="more-save-menu"
              role="menu"
              aria-label={`Save ${title}`}
              style={{ top: position.top, left: position.left }}
            >
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={saved}
                disabled={completed}
                onClick={() => choose(saved ? "unplanned" : "planning")}
              >
                <Bookmark size={16} aria-hidden="true" />
                <span>
                  <strong>{saved ? "Remove from Watch List" : "Add to Watch List"}</strong>
                  <small>Planning</small>
                </span>
                {saved ? <Check size={16} aria-hidden="true" /> : null}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={completed}
                disabled={completed}
                onClick={() => choose("completed")}
              >
                <CheckCheck size={16} aria-hidden="true" />
                <span>
                  <strong>Completed</strong>
                  <small>Already watched</small>
                </span>
                {completed ? <Check size={16} aria-hidden="true" /> : null}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
