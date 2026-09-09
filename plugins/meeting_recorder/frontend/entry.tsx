import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Navigate, Route, Routes } from "react-router-dom";
import { definePlugin } from "@nexus/plugin-sdk";
import { mountReactPlugin } from "../../../frontend/src/plugin-host.js";
import MeetingRecorderDetailPage from "./MeetingRecorderDetailPage.js";
import MeetingRecorderHomePage from "./MeetingRecorderHomePage.js";
import MeetingRecorderNewPage from "./MeetingRecorderNewPage.js";
import MeetingRecorderSettingsPage from "./MeetingRecorderSettingsPage.js";
import { MeetingRecorderSessionProvider } from "./MeetingRecorderSessionProvider.js";
import "../../../frontend/src/styles/globals.css";

const MeetingRecorderRoutes = () => (
  <Routes>
    <Route
      path="/app/p/meeting_recorder"
      element={<MeetingRecorderHomePage />}
    />
    <Route
      path="/app/p/meeting_recorder/new"
      element={<MeetingRecorderNewPage />}
    />
    <Route
      path="/app/p/meeting_recorder/settings"
      element={<MeetingRecorderSettingsPage />}
    />
    <Route
      path="/app/p/meeting_recorder/:recordingId"
      element={<MeetingRecorderDetailPage />}
    />
    <Route
      path="*"
      element={<Navigate to="/app/p/meeting_recorder" replace />}
    />
  </Routes>
);

type PageMount = { container: HTMLElement; content: ReactNode } | null;
type MeetingRecorderSession = {
  current: PageMount;
  listeners: Set<(mount: PageMount) => void>;
};

const updateMount = (session: MeetingRecorderSession, mount: PageMount) => {
  session.current = mount;
  session.listeners.forEach((listener) => listener(mount));
};

function PersistentMeetingRecorder({
  session,
}: {
  session: MeetingRecorderSession;
}) {
  const [mount, setMount] = useState<PageMount>(session.current);
  useEffect(() => {
    session.listeners.add(setMount);
    setMount(session.current);
    return () => {
      session.listeners.delete(setMount);
    };
  }, [session]);
  return (
    <MeetingRecorderSessionProvider>
      {mount ? createPortal(mount.content, mount.container) : null}
    </MeetingRecorderSessionProvider>
  );
}

export default definePlugin({
  activate() {
    return {
      current: null,
      listeners: new Set<(mount: PageMount) => void>(),
    } satisfies MeetingRecorderSession;
  },
  mountSurface({ container, host, session }) {
    return mountReactPlugin(
      container,
      host,
      <PersistentMeetingRecorder session={session as MeetingRecorderSession} />,
    );
  },
  mountPage({ container, session }) {
    const active = session as MeetingRecorderSession;
    const mount = { container, content: <MeetingRecorderRoutes /> };
    updateMount(active, mount);
    return {
      dispose() {
        if (active.current === mount) updateMount(active, null);
        container.replaceChildren();
      },
    };
  },
});
