import { AppUpdates } from "./AppUpdates";
import { LocalDataSettings } from "./LocalDataSettings";

export function SettingsView(): React.JSX.Element {
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-shell">
        <header className="settings-header">
          <p>ANISTREAM</p>
          <h1 id="settings-title" data-settings-heading tabIndex={-1}>
            Settings
          </h1>
          <span>Manage local progress, backups, and application updates.</span>
        </header>
        <div className="profile-utilities settings-sections">
          <LocalDataSettings />
          <AppUpdates />
        </div>
      </div>
    </section>
  );
}
