import { ChevronDown, LogOut } from "lucide-react";
import type { KeyboardEventHandler } from "react";
import { useEffect, useId, useRef, useState } from "react";

type GuestAccountMenuProps = {
  kind: "guest";
  active?: boolean;
  onOpenSettings: () => void;
  onSignIn: () => void;
};

type MemberAccountMenuProps = {
  kind: "member";
  active?: boolean;
  name: string;
  avatarUrl?: string;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

export type NavbarAccountMenuProps = GuestAccountMenuProps | MemberAccountMenuProps;

export function NavbarAccountMenu(props: NavbarAccountMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  function close(restoreFocus = false): void {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }

  function focusMenuItem(position: "first" | "last"): void {
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      if (!items?.length) return;
      items[position === "first" ? 0 : items.length - 1]?.focus();
    });
  }

  return (
    <div
      className="navbar-account-menu"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`account-menu-trigger account-menu-trigger--${props.kind}${props.active ? " active" : ""}`}
        aria-label={props.kind === "guest" ? "Guest account menu" : `${props.name} account menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={props.kind === "guest" ? "Guest menu" : "Account menu"}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            focusMenuItem(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
      >
        {props.kind === "member" && props.avatarUrl ? (
          <img src={props.avatarUrl} alt="" decoding="async" />
        ) : (
          <AccountIcon />
        )}
        {props.kind === "guest" ? <span>Guest</span> : null}
        {props.kind === "guest" ? (
          <ChevronDown className="account-menu-chevron" size={14} aria-hidden="true" />
        ) : null}
      </button>

      {open ? (
        <NavbarAccountMenuPanel
          {...props}
          id={panelId}
          onClose={close}
          onKeyDown={(event) => {
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            ];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              items[(current + direction + items.length) % items.length]?.focus();
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              items[event.key === "Home" ? 0 : items.length - 1]?.focus();
            }
          }}
        />
      ) : null}
    </div>
  );
}

export function NavbarAccountMenuPanel(
  props: NavbarAccountMenuProps & {
    id: string;
    onClose: (restoreFocus?: boolean) => void;
    onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  },
): React.JSX.Element {
  return (
    <div className="account-menu-panel" id={props.id} role="menu" onKeyDown={props.onKeyDown}>
      {props.kind === "member" ? (
        <button
          type="button"
          className="account-menu-identity"
          role="menuitem"
          onClick={() => {
            props.onClose();
            props.onOpenProfile();
          }}
        >
          {props.avatarUrl ? (
            <img src={props.avatarUrl} alt="" decoding="async" />
          ) : (
            <span className="account-menu-identity-fallback" aria-hidden="true">
              <AccountIcon />
            </span>
          )}
          <span>
            <strong>{props.name}</strong>
            <small>AniList profile</small>
          </span>
        </button>
      ) : null}

      <div className="account-menu-actions">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            props.onClose();
            props.onOpenSettings();
          }}
        >
          <SettingsIcon />
          <span>Settings</span>
        </button>
        {props.kind === "guest" ? (
          <button
            type="button"
            className="account-menu-accent"
            role="menuitem"
            onClick={() => {
              props.onClose();
              props.onSignIn();
            }}
          >
            <AccountIcon />
            <span>Sign In</span>
          </button>
        ) : (
          <button
            type="button"
            className="account-menu-accent"
            role="menuitem"
            onClick={() => {
              props.onClose();
              props.onLogout();
            }}
          >
            <LogOut size={18} aria-hidden="true" />
            <span>Log Out</span>
          </button>
        )}
      </div>
    </div>
  );
}

function AccountIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 20C5.33579 17.5226 8.50702 16 12 16C15.493 16 18.6642 17.5226 21 20M16.5 7.5C16.5 9.98528 14.4853 12 12 12C9.51472 12 7.5 9.98528 7.5 7.5C7.5 5.01472 9.51472 3 12 3C14.4853 3 16.5 5.01472 16.5 7.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.7273 14.7273C18.6063 15.0015 18.5702 15.3056 18.6236 15.6005C18.6771 15.8954 18.8177 16.1676 19.0273 16.3818L19.0818 16.4364C19.2509 16.6052 19.385 16.8057 19.4765 17.0265C19.568 17.2472 19.6151 17.4838 19.6151 17.7227C19.6151 17.9617 19.568 18.1983 19.4765 18.419C19.385 18.6397 19.2509 18.8402 19.0818 19.0091C18.913 19.1781 18.7124 19.3122 18.4917 19.4037C18.271 19.4952 18.0344 19.5423 17.7955 19.5423C17.5565 19.5423 17.3199 19.4952 17.0992 19.4037C16.8785 19.3122 16.678 19.1781 16.5091 19.0091L16.4545 18.9545C16.2403 18.745 15.9682 18.6044 15.6733 18.5509C15.3784 18.4974 15.0742 18.5335 14.8 18.6545C14.5311 18.7698 14.3018 18.9611 14.1403 19.205C13.9788 19.4489 13.8921 19.7347 13.8909 20.0273V20.1818C13.8909 20.664 13.6994 21.1265 13.3584 21.4675C13.0174 21.8084 12.5549 22 12.0727 22C11.5905 22 11.1281 21.8084 10.7871 21.4675C10.4461 21.1265 10.2545 20.664 10.2545 20.1818V20.1C10.2475 19.7991 10.1501 19.5073 9.97501 19.2625C9.79991 19.0176 9.55521 18.8312 9.27273 18.7273C8.99853 18.6063 8.69437 18.5702 8.39947 18.6236C8.10456 18.6771 7.83244 18.8177 7.61818 19.0273L7.56364 19.0818C7.39478 19.2509 7.19425 19.385 6.97353 19.4765C6.7528 19.568 6.51621 19.6151 6.27727 19.6151C6.03834 19.6151 5.80174 19.568 5.58102 19.4765C5.36029 19.385 5.15977 19.2509 4.99091 19.0818C4.82186 18.913 4.68775 18.7124 4.59626 18.4917C4.50476 18.271 4.45766 18.0344 4.45766 17.7955C4.45766 17.5565 4.50476 17.3199 4.59626 17.0992C4.68775 16.8785 4.82186 16.678 4.99091 16.5091L5.04545 16.4545C5.25503 16.2403 5.39562 15.9682 5.4491 15.6733C5.50257 15.3784 5.46647 15.0742 5.34545 14.8C5.23022 14.5311 5.03887 14.3018 4.79497 14.1403C4.55107 13.9788 4.26526 13.8921 3.97273 13.8909H3.81818C3.33597 13.8909 2.87351 13.6994 2.53253 13.3584C2.19156 13.0174 2 12.5549 2 12.0727C2 11.5905 2.19156 11.1281 2.53253 10.7871C2.87351 10.4461 3.33597 10.2545 3.81818 10.2545H3.9C4.2009 10.2475 4.49273 10.1501 4.73754 9.97501C4.98236 9.79991 5.16883 9.55521 5.27273 9.27273C5.39374 8.99853 5.42984 8.69437 5.37637 8.39947C5.3229 8.10456 5.18231 7.83244 4.97273 7.61818L4.91818 7.56364C4.74913 7.39478 4.61503 7.19425 4.52353 6.97353C4.43203 6.7528 4.38493 6.51621 4.38493 6.27727C4.38493 6.03834 4.43203 5.80174 4.52353 5.58102C4.61503 5.36029 4.74913 5.15977 4.91818 4.99091C5.08704 4.82186 5.28757 4.68775 5.50829 4.59626C5.72901 4.50476 5.96561 4.45766 6.20455 4.45766C6.44348 4.45766 6.68008 4.50476 6.9008 4.59626C7.12152 4.68775 7.32205 4.82186 7.49091 4.99091L7.54545 5.04545C7.75971 5.25503 8.03183 5.39562 8.32674 5.4491C8.62164 5.50257 8.9258 5.46647 9.2 5.34545H9.27273C9.54161 5.23022 9.77093 5.03887 9.93245 4.79497C10.094 4.55107 10.1807 4.26526 10.1818 3.97273V3.81818C10.1818 3.33597 10.3734 2.87351 10.7144 2.53253C11.0553 2.19156 11.5178 2 12 2C12.4822 2 12.9447 2.19156 13.2856 2.53253C13.6266 2.87351 13.8182 3.33597 13.8182 3.81818V3.9C13.8193 4.19253 13.906 4.47834 14.0676 4.72224C14.2291 4.96614 14.4584 5.15749 14.7273 5.27273C15.0015 5.39374 15.3056 5.42984 15.6005 5.37637C15.8954 5.3229 16.1676 5.18231 16.3818 4.97273L16.4364 4.91818C16.6052 4.74913 16.8057 4.61503 17.0265 4.52353C17.2472 4.43203 17.4838 4.38493 17.7227 4.38493C17.9617 4.38493 18.1983 4.43203 18.419 4.52353C18.6397 4.61503 18.8402 4.74913 19.0091 4.91818C19.1781 5.08704 19.3122 5.28757 19.4037 5.50829C19.4952 5.72901 19.5423 5.96561 19.5423 6.20455C19.5423 6.44348 19.4952 6.68008 19.4037 6.9008C19.3122 7.12152 19.1781 7.32205 19.0091 7.49091L18.9545 7.54545C18.745 7.75971 18.6044 8.03183 18.5509 8.32674C18.4974 8.62164 18.5335 8.9258 18.6545 9.2V9.27273C18.7698 9.54161 18.9611 9.77093 19.205 9.93245C19.4489 10.094 19.7347 10.1807 20.0273 10.1818H20.1818C20.664 10.1818 21.1265 10.3734 21.4675 10.7144C21.8084 11.0553 22 11.5178 22 12C22 12.4822 21.8084 12.9447 21.4675 13.2856C21.1265 13.6266 20.664 13.8182 20.1818 13.8182H20.1C19.8075 13.8193 19.5217 13.906 19.2778 14.0676C19.0339 14.2291 18.8425 14.4584 18.7273 14.7273Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
