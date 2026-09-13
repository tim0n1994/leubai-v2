import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ink.css";
import { initializeAppearance } from "./appearance";
import { AuthBootstrap } from "./auth/AuthBootstrap";

initializeAppearance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthBootstrap><App /></AuthBootstrap>
    </BrowserRouter>
  </StrictMode>,
);
