import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tg } from "./telegram";
import "./styles.css";

function applyScheme(): void {
  document.documentElement.dataset.scheme = tg.colorScheme();
}

applyScheme();
tg.onThemeChanged(applyScheme);
tg.ready();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
