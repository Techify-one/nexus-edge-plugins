import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { registerReloadGuard } from "../../.marketplace/frontend/src/lib/reload-guard.js";
import { translate } from "../../.marketplace/frontend/src/i18n/index.js";
import { acquireCaptureMedia } from "./audio-mixer.js";
import { recorderApi, sha256Base64 } from "./api-client.js";
import { localRecorderStore, localStoragePreflight } from "./indexed-db.js";
import {
  IndependentMediaSegmenter,
  preferredRecorderMimeType,
} from "./media-recorder-segmenter.js";
import { MiniRecorderBar } from "./MiniRecorderBar.js";
import {
  SegmentUploadQueue,
  type UploadQueueSnapshot,
} from "./upload-queue.js";
import type {
  LocalSegment,
  LocalSession,
  RecorderSourceMode,
  Recording,
} from "./types.js";

const CONSENT_VERSION = "2026-08-28";
const SEGMENT_DURATION_MS = 10_000;
const TRANSIENT_SEGMENT_DURATION_MS = 20_000;

export type StartCaptureInput = {
  title: string;
  sourceMode: RecorderSourceMode;
  language: "pt-BR" | "en" | "auto";
  autoTranscribe: boolean;
};

type RecorderSessionContextValue = {
  recording: Recording | null;
  state: "idle" | "starting" | "recording" | "paused" | "finalizing";
  elapsedMs: number;
  queue: UploadQueueSnapshot;
  recoverable: LocalSession[];
  updatePending: boolean;
  start: (input: StartCaptureInput) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  recover: (session: LocalSession) => Promise<void>;
  continueCapture: (session: LocalSession) => Promise<void>;
  dismissRecovery: (recordingId: string) => Promise<void>;
  stopAndReload: () => Promise<void>;
};

const RecorderSessionContext =
  createContext<RecorderSessionContextValue | null>(null);

const emptyQueue: UploadQueueSnapshot = { pending: 0, uploading: 0, failed: 0 };

export function MeetingRecorderSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const queryClient = useQueryClient();
  // The provider lives outside the route pages, so the recordings table and
  // overview would keep showing stale data after a capture ends unless the
  // shared cache is invalidated here.
  const refreshLists = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["meeting-recorder"] });
  }, [queryClient]);
  const [state, setState] =
    useState<RecorderSessionContextValue["state"]>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [queueSnapshot, setQueueSnapshot] = useState(emptyQueue);
  const [recoverable, setRecoverable] = useState<LocalSession[]>([]);
  const [updatePending, setUpdatePending] = useState(false);
  const segmenter = useRef<IndependentMediaSegmenter | null>(null);
  const queue = useRef<SegmentUploadQueue | null>(null);
  const closeMedia = useRef<(() => void) | null>(null);
  const activeSession = useRef<LocalSession | null>(null);
  const uploaded = useRef<LocalSegment[]>([]);
  const autoTranscribe = useRef(true);
  const storageEnabled = useRef(true);
  const recoveryInProgress = useRef(false);
  const autoResumeAttempted = useRef<string | null>(null);

  useEffect(() => {
    void localRecorderStore
      .sessions()
      .then(setRecoverable)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(
      () => setElapsedMs((value) => value + 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (!recording || (state !== "recording" && state !== "paused")) return;
    const heartbeat = () =>
      void recorderApi.heartbeat(recording.id).catch(() => undefined);
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(timer);
  }, [recording, state]);

  useEffect(
    () =>
      registerReloadGuard("meeting-recorder.capture", () => state !== "idle"),
    [state],
  );

  useEffect(() => {
    const update = () => setUpdatePending(true);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (state === "idle") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("app:update-pending", update);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("app:update-pending", update);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [state]);

  const persistSegment = useCallback(
    async (input: {
      blob: Blob;
      sequence: number;
      startOffsetMs: number;
      durationMs: number;
      mimeType: string;
    }) => {
      const session = activeSession.current;
      if (!session) return;
      const local: LocalSegment = {
        recordingId: session.recordingId,
        sequence: input.sequence,
        blob: input.blob,
        mimeType: input.mimeType,
        sizeBytes: input.blob.size,
        startOffsetMs: input.startOffsetMs,
        durationMs: input.durationMs,
        checksumSha256: await sha256Base64(input.blob),
        clientSessionId: session.clientSessionId,
        attempts: 0,
        nextRetryAt: Date.now(),
      };
      await localRecorderStore.saveSegment(local);
      const updatedSession = {
        ...session,
        nextSequence: input.sequence + 1,
        accumulatedMs: input.startOffsetMs + input.durationMs,
      };
      activeSession.current = updatedSession;
      await localRecorderStore.saveSession(updatedSession);
      queue.current?.enqueue(local);
    },
    [],
  );

  const start = useCallback(
    async (input: StartCaptureInput) => {
      if (state !== "idle") throw new Error("CAPTURE_ALREADY_ACTIVE");
      setState("starting");
      try {
        const preflight = await localStoragePreflight();
        if (
          preflight.availableBytes !== null &&
          preflight.availableBytes < 50 * 1024 * 1024
        )
          throw new Error("LOCAL_STORAGE_LOW");
        const mimeType = preferredRecorderMimeType();
        if (!mimeType) throw new Error("MEDIA_RECORDER_UNSUPPORTED");
        const defaults = await recorderApi.defaults();
        const retainAudio = defaults.storageEnabled;
        const segmentDurationMs = retainAudio
          ? SEGMENT_DURATION_MS
          : TRANSIENT_SEGMENT_DURATION_MS;
        if (!retainAudio && !input.autoTranscribe)
          throw new Error("TRANSCRIPTION_REQUIRED");
        const media = await acquireCaptureMedia(input.sourceMode);
        closeMedia.current = media.close;
        const clientSessionId = crypto.randomUUID();
        const created = await recorderApi.create({
          clientSessionId,
          title: input.title,
          sourceType: input.sourceMode,
          language: input.language,
          mimeType,
          bitrateBps: 64_000,
          segmentDurationMs,
          autoTranscribe: input.autoTranscribe,
          consentVersion: CONSENT_VERSION,
          consentAcknowledged: true,
        });
        const session: LocalSession = {
          recordingId: created.recording.id,
          clientSessionId,
          title: input.title,
          sourceMode: input.sourceMode,
          nextSequence: 0,
          startedAt: Date.now(),
          accumulatedMs: 0,
          state: "recording",
          storageEnabled: created.recording.audioStorageMode === "r2",
          language: input.language,
          autoTranscribe: input.autoTranscribe,
        };
        await localRecorderStore.saveSession(session);
        activeSession.current = session;
        autoTranscribe.current = input.autoTranscribe;
        storageEnabled.current = session.storageEnabled === true;
        uploaded.current = [];
        queue.current = new SegmentUploadQueue(
          setQueueSnapshot,
          storageEnabled.current ? 2 : 1,
          (segment) => {
            uploaded.current.push(segment);
          },
          storageEnabled.current,
        );
        segmenter.current = new IndependentMediaSegmenter(
          media.stream,
          segmentDurationMs,
          0,
          0,
          persistSegment,
        );
        setRecording(created.recording);
        setElapsedMs(0);
        setState("recording");
        segmenter.current.start();
        refreshLists();
      } catch (error) {
        closeMedia.current?.();
        closeMedia.current = null;
        setState("idle");
        throw error;
      }
    },
    [persistSegment, refreshLists, state],
  );

  const pause = useCallback(async () => {
    if (!recording || state !== "recording") return;
    await segmenter.current?.pause();
    await recorderApi.captureState(recording.id, "paused");
    if (activeSession.current) {
      activeSession.current = { ...activeSession.current, state: "paused" };
      await localRecorderStore.saveSession(activeSession.current);
    }
    setState("paused");
    refreshLists();
  }, [recording, refreshLists, state]);

  const resume = useCallback(async () => {
    if (!recording || state !== "paused") return;
    await recorderApi.captureState(recording.id, "recording");
    if (activeSession.current) {
      activeSession.current = { ...activeSession.current, state: "recording" };
      await localRecorderStore.saveSession(activeSession.current);
    }
    setState("recording");
    segmenter.current?.resume();
    refreshLists();
  }, [recording, refreshLists, state]);

  const stop = useCallback(async () => {
    if (!recording || state === "idle" || state === "finalizing") return;
    setState("finalizing");
    await segmenter.current?.stop();
    closeMedia.current?.();
    closeMedia.current = null;
    await queue.current?.drain();
    if (queue.current?.hasFailures()) {
      await recorderApi.captureState(recording.id, "interrupted");
      const localSession = activeSession.current;
      if (localSession) {
        const interrupted: LocalSession = {
          ...localSession,
          state: "interrupted",
        };
        await localRecorderStore.saveSession(interrupted);
        setRecoverable((items) => [
          interrupted,
          ...items.filter(
            (item) => item.recordingId !== interrupted.recordingId,
          ),
        ]);
      }
      activeSession.current = null;
      segmenter.current = null;
      queue.current = null;
      setRecording(null);
      setState("idle");
      refreshLists();
      toast.error(translate("meetingRecorder.recoveryPendingError"));
      return;
    }
    const localSession = activeSession.current;
    if (localSession) {
      activeSession.current = { ...localSession, state: "finalizing" };
      await localRecorderStore.saveSession(activeSession.current);
    }
    await recorderApi.captureState(recording.id, "finalizing");
    const lastSequence = Math.max(
      0,
      (activeSession.current?.nextSequence ?? 1) - 1,
    );
    try {
      await recorderApi.finalize(recording.id, lastSequence);
    } catch (error) {
      const pending = activeSession.current;
      if (pending) {
        await localRecorderStore.saveSession(pending);
        setRecoverable((items) => [
          pending,
          ...items.filter((item) => item.recordingId !== pending.recordingId),
        ]);
      }
      activeSession.current = null;
      segmenter.current = null;
      queue.current = null;
      setRecording(null);
      setState("idle");
      refreshLists();
      toast.error(translate("meetingRecorder.recoveryPendingError"));
      return;
    }
    if (autoTranscribe.current && storageEnabled.current) {
      for (const segment of uploaded.current.toSorted(
        (a, b) => a.sequence - b.sequence,
      )) {
        try {
          await recorderApi.transcribe(
            recording.id,
            segment.sequence,
            segment.checksumSha256,
          );
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : translate("meetingRecorder.transcriptionFailed"),
          );
          break;
        }
      }
    }
    await localRecorderStore.removeSession(recording.id);
    activeSession.current = null;
    segmenter.current = null;
    queue.current = null;
    setQueueSnapshot(emptyQueue);
    setRecoverable((items) =>
      items.filter((item) => item.recordingId !== recording.id),
    );
    setRecording(null);
    setState("idle");
    refreshLists();
  }, [recording, refreshLists, state]);

  const recover = useCallback(
    async (session: LocalSession) => {
      if (state !== "idle") throw new Error("CAPTURE_ALREADY_ACTIVE");
      if (recoveryInProgress.current) return;
      recoveryInProgress.current = true;
      try {
        const segments = await localRecorderStore.segments(session.recordingId);
        const recording = (await recorderApi.recording(session.recordingId))
          .recording;
        const retainAudio = recording.audioStorageMode === "r2";
        const remote = await recorderApi.segments(session.recordingId);
        const pending: LocalSegment[] = [];
        for (const segment of segments) {
          const stored = remote.items.find(
            (item) => item.sequence === segment.sequence,
          );
          if (
            stored?.checksumSha256 === segment.checksumSha256 &&
            (retainAudio
              ? stored.storageStatus === "stored"
              : stored.transcriptionStatus === "ready")
          )
            await localRecorderStore.removeSegment(
              session.recordingId,
              segment.sequence,
            );
          else pending.push(segment);
        }
        const recoveryQueue = new SegmentUploadQueue(
          setQueueSnapshot,
          retainAudio ? 2 : 1,
          undefined,
          retainAudio,
        );
        pending.forEach((segment) => recoveryQueue.enqueue(segment));
        await recoveryQueue.drain();
        if (recoveryQueue.hasFailures())
          throw new Error(translate("meetingRecorder.recoveryPendingError"));
        if (retainAudio && recording.autoTranscribe) {
          const stored = await recorderApi.segments(session.recordingId);
          for (const segment of stored.items) {
            if (
              segment.storageStatus === "stored" &&
              segment.transcriptionStatus !== "ready"
            )
              await recorderApi.transcribe(
                session.recordingId,
                segment.sequence,
                segment.checksumSha256,
              );
          }
        }
        await recorderApi.finalize(
          session.recordingId,
          Math.max(0, session.nextSequence - 1),
        );
        await localRecorderStore.removeSession(session.recordingId);
        setRecoverable((items) =>
          items.filter((item) => item.recordingId !== session.recordingId),
        );
        setQueueSnapshot(emptyQueue);
        refreshLists();
      } finally {
        recoveryInProgress.current = false;
      }
    },
    [refreshLists, state],
  );

  const continueCapture = useCallback(
    async (session: LocalSession) => {
      if (state !== "idle") throw new Error("CAPTURE_ALREADY_ACTIVE");
      if (recoveryInProgress.current) return;
      const recording = (await recorderApi.recording(session.recordingId))
        .recording;
      if (
        recording.captureStatus === "complete" ||
        recording.captureStatus === "deleting"
      )
        throw new Error("RECORDING_FINALIZED");
      setState("starting");
      try {
        const remote = await recorderApi.segments(session.recordingId);
        const local = await localRecorderStore.segments(session.recordingId);
        for (const segment of local) {
          const stored = remote.items.find(
            (item) => item.sequence === segment.sequence,
          );
          if (
            stored?.checksumSha256 === segment.checksumSha256 &&
            (recording.audioStorageMode === "r2"
              ? stored.storageStatus === "stored"
              : stored.transcriptionStatus === "ready")
          )
            await localRecorderStore.removeSegment(
              session.recordingId,
              segment.sequence,
            );
        }
        const pending = await localRecorderStore.segments(session.recordingId);
        const lastSequence = Math.max(
          session.nextSequence - 1,
          ...remote.items.map((item) => item.sequence),
          ...pending.map((item) => item.sequence),
        );
        const offsetMs = Math.max(
          session.accumulatedMs,
          recording.timelineDurationMs,
          ...pending.map((item) => item.startOffsetMs + item.durationMs),
        );
        if (
          recording.audioStorageMode === "r2" &&
          !(await recorderApi.defaults()).storageEnabled
        )
          throw new Error("R2_NOT_ENABLED");
        if (recording.captureStatus === "finalizing")
          throw new Error("RECORDING_FINALIZING");
        const media = await acquireCaptureMedia(session.sourceMode);
        closeMedia.current = media.close;
        const updated: LocalSession = {
          ...session,
          storageEnabled: recording.audioStorageMode === "r2",
          nextSequence: lastSequence + 1,
          accumulatedMs: offsetMs,
          state: "recording",
        };
        if (recording.captureStatus !== "recording")
          await recorderApi.captureState(recording.id, "recording");
        await localRecorderStore.saveSession(updated);
        activeSession.current = updated;
        autoTranscribe.current = recording.autoTranscribe;
        storageEnabled.current = recording.audioStorageMode === "r2";
        uploaded.current = [];
        queue.current = new SegmentUploadQueue(
          setQueueSnapshot,
          storageEnabled.current ? 2 : 1,
          (segment) => uploaded.current.push(segment),
          storageEnabled.current,
        );
        segmenter.current = new IndependentMediaSegmenter(
          media.stream,
          storageEnabled.current
            ? SEGMENT_DURATION_MS
            : TRANSIENT_SEGMENT_DURATION_MS,
          updated.nextSequence,
          offsetMs,
          persistSegment,
        );
        setRecording(recording);
        setElapsedMs(offsetMs);
        setRecoverable((items) =>
          items.filter((item) => item.recordingId !== recording.id),
        );
        setState("recording");
        segmenter.current.start();
        pending.forEach((segment) => queue.current?.enqueue(segment));
        refreshLists();
      } catch (error) {
        closeMedia.current?.();
        closeMedia.current = null;
        setState("idle");
        throw error;
      }
    },
    [persistSegment, refreshLists, state],
  );

  useEffect(() => {
    if (
      state !== "idle" ||
      recoverable.length !== 1 ||
      !window.location.pathname.startsWith("/app/p/meeting_recorder")
    )
      return;
    const session = recoverable[0]!;
    if (
      session.sourceMode !== "microphone" ||
      session.state !== "recording" ||
      document.visibilityState !== "visible" ||
      autoResumeAttempted.current === session.recordingId
    )
      return;
    autoResumeAttempted.current = session.recordingId;
    void continueCapture(session).catch(() => undefined);
  }, [continueCapture, recoverable, state]);

  const dismissRecovery = useCallback(async (recordingId: string) => {
    const segments = await localRecorderStore.segments(recordingId);
    await Promise.all(
      segments.map((segment) =>
        localRecorderStore.removeSegment(recordingId, segment.sequence),
      ),
    );
    await localRecorderStore.removeSession(recordingId);
    setRecoverable((items) =>
      items.filter((item) => item.recordingId !== recordingId),
    );
  }, []);

  const stopAndReload = useCallback(async () => {
    await stop();
    window.location.reload();
  }, [stop]);

  useEffect(() => {
    const safeReload = () => void stopAndReload();
    window.addEventListener("app:request-safe-reload", safeReload);
    return () =>
      window.removeEventListener("app:request-safe-reload", safeReload);
  }, [stopAndReload]);

  const value = useMemo<RecorderSessionContextValue>(
    () => ({
      recording,
      state,
      elapsedMs,
      queue: queueSnapshot,
      recoverable,
      updatePending,
      start,
      pause,
      resume,
      stop,
      recover,
      continueCapture,
      dismissRecovery,
      stopAndReload,
    }),
    [
      dismissRecovery,
      continueCapture,
      elapsedMs,
      pause,
      queueSnapshot,
      recording,
      recover,
      recoverable,
      resume,
      start,
      state,
      stop,
      stopAndReload,
      updatePending,
    ],
  );

  return (
    <RecorderSessionContext.Provider value={value}>
      {children}
      <MiniRecorderBar />
    </RecorderSessionContext.Provider>
  );
}

export function useMeetingRecorderSession(): RecorderSessionContextValue {
  const context = useContext(RecorderSessionContext);
  if (!context)
    throw new Error(
      "useMeetingRecorderSession requires MeetingRecorderSessionProvider",
    );
  return context;
}
