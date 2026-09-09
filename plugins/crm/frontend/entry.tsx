import { Navigate, Route, Routes } from "react-router-dom";
import { definePlugin } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../../frontend/src/plugin-host.js";
import CrmHomePage from "./CrmHomePage.js";
import LeadListPage from "./LeadListPage.js";
import "../../../frontend/src/styles/globals.css";

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
