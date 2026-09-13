import { Settings2 } from "lucide-react";
import type { ReaderSettings } from "../../shared/reader-settings";

export function ReaderSettingsPanel({
  settings,
  quality,
  saving,
  error,
  onChange,
  onRetry,
  onOpenChange,
}: {
  settings: ReaderSettings;
  quality: ReaderSettings["quality"];
  saving: boolean;
  error?: string;
  onChange: (settings: ReaderSettings) => void;
  onRetry: () => void;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <details
      className="reader-settings"
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary title="Reader settings">
        <Settings2 size={18} aria-hidden="true" />
        <span>Reader settings{error ? " · needs attention" : ""}</span>
      </summary>
      <div className="reader-settings-panel">
        <label>
          Page width
          <select
            aria-label="Page width"
            value={settings.width}
            disabled={saving}
            onChange={(event) =>
              onChange({
                ...settings,
                width: Number(event.target.value) as ReaderSettings["width"],
              })
            }
          >
            <option value={720}>Narrow · 720px</option>
            <option value={960}>Medium · 960px</option>
            <option value={1120}>Wide · 1120px</option>
            <option value={1400}>Extra wide · 1400px</option>
          </select>
        </label>
        <label>
          Image fit
          <select
            aria-label="Image fit"
            value={settings.fit}
            disabled={saving}
            onChange={(event) =>
              onChange({ ...settings, fit: event.target.value as ReaderSettings["fit"] })
            }
          >
            <option value="width">Fit width</option>
            <option value="original">Original size (no enlargement)</option>
          </select>
        </label>
        <label>
          Image quality
          <select
            aria-label="Image quality"
            value={settings.quality}
            disabled={saving}
            onChange={(event) =>
              onChange({ ...settings, quality: event.target.value as ReaderSettings["quality"] })
            }
          >
            <option value="data">Original quality</option>
            <option value="data-saver">Data saver</option>
          </select>
        </label>
        <p>
          Quality applies when you open the next chapter. Data saver uses smaller MangaDex images.
        </p>
        {settings.quality !== quality ? (
          <p role="status">This chapter keeps its current quality.</p>
        ) : null}
        {saving ? <p role="status">Saving…</p> : null}
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button type="button" disabled={saving} onClick={onRetry}>
              Retry settings
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
