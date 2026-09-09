import { Navigate, Route, Routes } from "react-router-dom";
import { definePlugin } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../../frontend/src/plugin-host.js";
import MetaAdsAccountsPage from "./MetaAdsAccountsPage.js";
import MetaAdsDashboardPage from "./MetaAdsDashboardPage.js";
import "../../../frontend/src/styles/globals.css";

const MetaAdsRoutes = () => (
  <Routes>
    <Route path="/app/p/meta_ads" element={<MetaAdsDashboardPage />} />
    <Route path="/app/p/meta_ads/accounts" element={<MetaAdsAccountsPage />} />
    <Route path="*" element={<Navigate to="/app/p/meta_ads" replace />} />
  </Routes>
);

export default definePlugin({
  mountPage({ container, host }) {
    return mountReactPlugin(container, host, <MetaAdsRoutes />);
  },
});
