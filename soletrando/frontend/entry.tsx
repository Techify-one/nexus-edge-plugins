import { Navigate, Route, Routes } from "react-router-dom";
import { definePlugin } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../.marketplace/frontend/src/plugin-host.js";
import { registerPluginTranslations } from "../../.marketplace/frontend/src/i18n/index.js";
import { soletrandoFrontendMessages } from "./i18n.js";
import ChildDetailPage from "./ChildDetailPage.js";
import ChildrenPage from "./ChildrenPage.js";
import PracticePage from "./PracticePage.js";
import "../../.marketplace/frontend/src/styles/globals.css";

registerPluginTranslations(soletrandoFrontendMessages);

const SoletrandoRoutes = () => (
  <Routes>
    <Route path="/app/p/soletrando" element={<ChildrenPage />} />
    <Route
      path="/app/p/soletrando/children/:childId"
      element={<ChildDetailPage />}
    />
    <Route path="*" element={<Navigate to="/app/p/soletrando" replace />} />
  </Routes>
);

const SoletrandoPublicRoutes = () => (
  <Routes>
    <Route path="/soletrando/c/:token" element={<PracticePage />} />
  </Routes>
);

export default definePlugin({
  mountPage({ container, host }) {
    return mountReactPlugin(container, host, <SoletrandoRoutes />);
  },
  mountPublicPage({ container, host }) {
    return mountReactPlugin(container, host, <SoletrandoPublicRoutes />);
  },
});
