import { Navigate, Route, Routes } from "react-router-dom";
import { definePlugin } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../.marketplace/frontend/src/plugin-host.js";
import { registerPluginTranslations } from "../../.marketplace/frontend/src/i18n/index.js";
import { asaasFrontendMessages } from "./i18n.js";
import AsaasDashboardPage from "./AsaasDashboardPage.js";
import AsaasPixPage from "./AsaasPixPage.js";
import AsaasSettingsPage from "./AsaasSettingsPage.js";
import AsaasStatementPage from "./AsaasStatementPage.js";
import "../../.marketplace/frontend/src/styles/globals.css";

registerPluginTranslations(asaasFrontendMessages);

const AsaasRoutes = () => (
  <Routes>
    <Route path="/app/p/asaas" element={<AsaasDashboardPage />} />
    <Route path="/app/p/asaas/statement" element={<AsaasStatementPage />} />
    <Route path="/app/p/asaas/pix" element={<AsaasPixPage />} />
    <Route path="/app/p/asaas/settings" element={<AsaasSettingsPage />} />
    <Route path="*" element={<Navigate to="/app/p/asaas" replace />} />
  </Routes>
);

export default definePlugin({
  mountPage({ container, host }) {
    return mountReactPlugin(container, host, <AsaasRoutes />);
  },
});
