import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";
import "./styles/controls.css";
import "./styles/notifications.css";
import "./styles/redesign.css";
import "./styles/account-menu.css";

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
