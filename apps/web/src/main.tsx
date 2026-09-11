import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyTheme, readTheme } from "./lib/theme.ts";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/chat.css";

applyTheme(readTheme());

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing from index.html");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
