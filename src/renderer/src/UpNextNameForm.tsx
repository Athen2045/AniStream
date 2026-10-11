import { useState } from "react";
import { BINGE_NAME_MAX } from "../../shared/binge";

/** Names a new or renamed playlist; Escape cancels. */
export function NameForm({
  label,
  submitLabel,
  initial = "",
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <form
      className="upnext-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        aria-label={label}
        placeholder={label}
        value={name}
        maxLength={BINGE_NAME_MAX}
        // Opened by an explicit click, so moving focus into the field is expected.
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" disabled={!trimmed}>
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
