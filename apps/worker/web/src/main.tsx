import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { mountDebugBar } from "./preview/DebugBar";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

if (import.meta.env.DEV && import.meta.env.MODE === "local-preview") {
  await mountDebugBar();
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
