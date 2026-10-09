import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";
import "./styles/controls.css";
import "./styles/redesign.css";
import "./styles/account-menu.css";
import "./styles/more.css";
import "./styles/search.css";
import "./styles/title.css";
import "./styles/profile.css";
import "./styles/schedule.css";
import "./styles/upnext.css";
import "./styles/settings.css";
import "./styles/continue.css";
import "./styles/chapters.css";
import "./styles/reader.css";
import "./styles/player-chrome.css";
import "./styles/similar.css";
import "./styles/profile-simkl.css";
import "./styles/loading.css";

document.documentElement.dataset.platform = navigator.userAgent.includes("Windows")
  ? "win32"
  : "darwin";

const root = document.getElementById("root");
if (!root) throw new Error("AniStream renderer root was not found");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
