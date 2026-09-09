import { Navigate, Route, Routes } from "react-router-dom";
import { definePlugin } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../../frontend/src/plugin-host.js";
import ChildDetailPage from "./ChildDetailPage.js";
import ChildrenPage from "./ChildrenPage.js";
import "../../../frontend/src/styles/globals.css";

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

export default definePlugin({
  mountPage({ container, host }) {
    return mountReactPlugin(container, host, <SoletrandoRoutes />);
  },
});
