import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { brandCssVars } from "@madat/core/brand/tokens";
import { App } from "./App";
import { tg } from "./telegram";
import "./styles.css";

// Brand tokens from core: the same colours the PDF report uses.
const tokens = document.createElement("style");
tokens.textContent = `:root{${brandCssVars("light")}}:root[data-scheme="dark"]{${brandCssVars("dark")}}`;
document.head.append(tokens);

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
