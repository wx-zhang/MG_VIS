import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ConfirmDialogProvider } from "./shared/confirmDialog";
import { ApiFeedbackProvider } from "./shared/ApiFeedbackProvider";
import { DeploymentNoticeFrame } from "./shared/DeploymentNoticeFrame";
import { applyStoredThemeMode } from "./themeMode";
import "./styles.css";

const demoOnly = import.meta.env.VITE_MARLOW_DEMO_ONLY === "true";
const FrontendTownApp = React.lazy(() => import("./app/FrontendTownApp").then(module => ({ default: module.FrontendTownApp })));

const routerBasename = import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

applyStoredThemeMode();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <ConfirmDialogProvider>
        <ApiFeedbackProvider>
          <DeploymentNoticeFrame staticMode={demoOnly}>
            {demoOnly ? <React.Suspense fallback={<div className="auth-page">Loading Marlow Green…</div>}><FrontendTownApp /></React.Suspense> : <App />}
          </DeploymentNoticeFrame>
        </ApiFeedbackProvider>
      </ConfirmDialogProvider>
    </BrowserRouter>
  </React.StrictMode>
);
