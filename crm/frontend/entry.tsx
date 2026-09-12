import { Navigate, Route, Routes } from "react-router-dom";
import { definePlugin } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../.marketplace/frontend/src/plugin-host.js";
import { registerPluginTranslations } from "../../.marketplace/frontend/src/i18n/index.js";
import { crmFrontendMessages } from "./i18n.js";
import CrmHomePage from "./CrmHomePage.js";
import LeadListPage from "./LeadListPage.js";
import "../../.marketplace/frontend/src/styles/globals.css";

registerPluginTranslations(crmFrontendMessages);

const CrmRoutes = () => (
  <Routes>
    <Route path="/app/p/crm" element={<CrmHomePage />} />
    <Route path="/app/p/crm/leads" element={<LeadListPage />} />
    <Route path="/app/p/crm/leads/:leadId" element={<LeadListPage />} />
    <Route path="*" element={<Navigate to="/app/p/crm/leads" replace />} />
  </Routes>
);

export default definePlugin({
  mountPage({ container, host }) {
    return mountReactPlugin(container, host, <CrmRoutes />);
  },
});
