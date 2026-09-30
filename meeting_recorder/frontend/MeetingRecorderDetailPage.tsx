import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Info, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  Input,
  Skeleton,
} from "../../.marketplace/frontend/src/components/ui/index.js";
import { can } from "../../.marketplace/frontend/src/lib/ability.js";
import { recentReauthHeaders } from "../../.marketplace/frontend/src/lib/api/core-client.js";
import { getAppLocale } from "../../.marketplace/frontend/src/i18n/index.js";
import {
  useI18n,
  type TranslationKey,
} from "../../.marketplace/frontend/src/i18n/index.js";
import { recorderApi, segmentAudioUrl } from "./api-client.js";
import { MeetingRecorderRouteGate } from "./MeetingRecorderRouteGate.js";

const statusKeys: Record<string, TranslationKey> = {
  recording: "meetingRecorder.status.recording",
  paused: "meetingRecorder.status.paused",
  interrupted: "meetingRecorder.status.interrupted",
  finalizing: "meetingRecorder.status.finalizing",
  complete: "meetingRecorder.status.complete",
  deleting: "meetingRecorder.status.deleting",
};

function DetailContent() {
  const { recordingId = "" } = useParams();
  const { t, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const recording = useQuery({
    queryKey: ["meeting-recorder", "recording", recordingId],
    queryFn: () => recorderApi.recording(recordingId),
  });
  const segments = useQuery({
    queryKey: ["meeting-recorder", "segments", recordingId],
    queryFn: () => recorderApi.segments(recordingId),
  });
  const transcript = useQuery({
    queryKey: ["meeting-recorder", "transcript", recordingId],
    queryFn: () => recorderApi.transcript(recordingId),
  });
  const [title, setTitle] = useState("");
  useEffect(
    () => setTitle(recording.data?.recording.title ?? ""),
    [recording.data],
  );

  const rename = useMutation({
    mutationFn: () =>
      recorderApi.rename(
        recordingId,
        title.trim(),
        recording.data!.recording.version,
      ),
    onSuccess: () => {
      setEditingTitle(false);
      void queryClient.invalidateQueries({ queryKey: ["meeting-recorder"] });
      toast.success(t("meetingRecorder.saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const transcribe = useMutation({
    mutationFn: async () => {
      for (const segment of segments.data?.items ?? []) {
        if (
          segment.storageStatus === "stored" &&
          segment.transcriptionStatus !== "ready"
        )
          await recorderApi.transcribe(
            recordingId,
            segment.sequence,
            segment.checksumSha256,
          );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["meeting-recorder", "recording", recordingId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["meeting-recorder", "segments", recordingId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["meeting-recorder", "transcript", recordingId],
      });
      toast.success(t("meetingRecorder.transcriptionComplete"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const headers = await recentReauthHeaders(
        t("meetingRecorder.deletePassword"),
      );
      const started = await recorderApi.deleteRecording(recordingId, headers);
      if (!started) return;
      let complete = false;
      let stepNumber = 0;
      while (!complete) {
        const step = await recorderApi.deletionStep(
          recordingId,
          started.operationId,
          stepNumber,
        );
        stepNumber += 1;
        complete = step?.complete ?? true;
      }
    },
    onSuccess: () => {
      toast.success(t("meetingRecorder.deleted"));
      navigate("/app/p/meeting_recorder", { replace: true });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (recording.isPending || segments.isPending || transcript.isPending)
    return <Skeleton className="h-96" />;
  if (!recording.data) return null;
  const item = recording.data.recording;
  const audioSegments =
    segments.data?.items.filter(
      (segment) => segment.storageStatus === "stored",
    ) ?? [];
  const activeAudio = audioSegments[playlistIndex];
  const hasTranscribableAudio = Boolean(
    segments.data?.items.some(
      (segment) =>
        segment.storageStatus === "stored" &&
        segment.transcriptionStatus !== "ready",
    ),
  );
  const downloadTranscript = async () => {
    const response = await fetch(
      `/api/v1/p/meeting_recorder/recordings/${encodeURIComponent(recordingId)}/transcript`,
      {
        credentials: "include",
        headers: {
          Accept: "text/plain",
          "Accept-Language": getAppLocale(),
        },
      },
    );
    if (!response.ok) throw new Error(t("meetingRecorder.loadFailed"));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${item.title}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const statusTone =
    item.effectiveCaptureStatus === "complete"
      ? "success"
      : item.effectiveCaptureStatus === "interrupted"
        ? "danger"
        : "warning";
  const hasAudio = audioSegments.length > 0;
  const transcriptText = transcript.data?.text ?? "";
  const minutes = Math.floor(item.timelineDurationMs / 60_000);
  const seconds = Math.round((item.timelineDurationMs % 60_000) / 1_000);
  const durationLabel =
    minutes > 0
      ? `${minutes}min ${String(seconds).padStart(2, "0")}s`
      : `${seconds}s`;
  const submitTitle = () => {
    if (title.trim() && title.trim() !== item.title) rename.mutate();
    else setEditingTitle(false);
  };
  const metrics: Array<{ label: string; value: string }> = [
    { label: t("meetingRecorder.column.duration"), value: durationLabel },
    {
      label: t("meetingRecorder.column.size"),
      value: hasAudio
        ? `${(item.totalBytes / 1024 / 1024).toFixed(1)} MB`
        : "-",
    },
    { label: t("meetingRecorder.column.owner"), value: item.ownerName ?? "-" },
    {
      label: t("meetingRecorder.segments"),
      value: String(segments.data?.items.length ?? 0),
    },
  ];

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <form
              className="flex max-w-2xl items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitTitle();
              }}
            >
              <Input
                autoFocus
                aria-label={t("meetingRecorder.rename")}
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setTitle(item.title);
                    setEditingTitle(false);
                  }
                }}
              />
              <Button
                type="submit"
                busy={rename.isPending}
                disabled={!title.trim()}
                aria-label={t("common.save")}
              >
                <Check className="h-4 w-4" />
                {t("common.save")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label={t("common.cancel")}
                onClick={() => {
                  setTitle(item.title);
                  setEditingTitle(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <div className="flex items-start gap-2">
              <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight">
                {item.title}
              </h1>
              {can("meeting_recorder.recording.update") && (
                <Button
                  variant="ghost"
                  className="mt-0.5 shrink-0 px-2"
                  aria-label={t("meetingRecorder.rename")}
                  title={t("meetingRecorder.rename")}
                  onClick={() => setEditingTitle(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <Badge tone={statusTone}>
              {t(
                statusKeys[item.effectiveCaptureStatus] ??
                  "meetingRecorder.status.interrupted",
              )}
            </Badge>
            <span>
              {t(`meetingRecorder.source.${item.ingestSource}`)} ·{" "}
              {formatDateTime(item.startedAt)}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            disabled={!transcriptText}
            onClick={() => void downloadTranscript()}
          >
            <Download className="h-4 w-4" />
            {t("meetingRecorder.download")}
          </Button>
          {can("meeting_recorder.recording.delete") && (
            <Button
              variant="danger"
              busy={remove.isPending}
              aria-label={t("common.delete")}
              onClick={() =>
                confirm(
                  t("meetingRecorder.deleteConfirm", { name: item.title }),
                ) && remove.mutate()
              }
            >
              <Trash2 className="h-4 w-4" />
              {t("common.delete")}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {metric.label}
            </p>
            <p className="mt-1 break-words text-lg font-bold tabular-nums">
              {metric.value}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">{t("meetingRecorder.transcript")}</h2>
            {can("meeting_recorder.transcription.create") &&
              hasTranscribableAudio && (
                <Button
                  variant="secondary"
                  busy={transcribe.isPending}
                  onClick={() => transcribe.mutate()}
                >
                  {t("meetingRecorder.transcribe")}
                </Button>
              )}
          </div>
          {transcriptText ? (
            <div className="max-w-3xl space-y-4 text-[15px] leading-7 text-slate-700">
              {transcriptText.split(/\n{2,}/u).map((paragraph, index) => (
                <p key={index} className="whitespace-pre-wrap">
                  {paragraph}
                </p>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              {t("meetingRecorder.noTranscript")}
            </p>
          )}
        </Card>

        <Card
          className={`min-w-0 lg:sticky lg:top-4 ${hasAudio ? "order-first lg:order-none" : ""}`}
        >
          <h2 className="font-bold">{t("meetingRecorder.audio")}</h2>
          {activeAudio ? (
            <>
              <audio
                className="mt-3 w-full"
                controls
                src={segmentAudioUrl(recordingId, activeAudio.sequence)}
                onEnded={() =>
                  setPlaylistIndex((index) =>
                    Math.min(index + 1, audioSegments.length - 1),
                  )
                }
              />
              <p className="mt-2 text-xs text-slate-500">
                {t("meetingRecorder.segmentProgress", {
                  current: playlistIndex + 1,
                  total: audioSegments.length,
                })}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {audioSegments.map((segment, index) => (
                  <Button
                    key={segment.id}
                    variant={index === playlistIndex ? "primary" : "secondary"}
                    className="h-8 min-w-8 px-2 text-xs"
                    onClick={() => setPlaylistIndex(index)}
                    aria-label={t("meetingRecorder.playSegment", {
                      number: segment.sequence + 1,
                    })}
                  >
                    {segment.sequence + 1}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 flex items-start gap-2 text-sm text-slate-500">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t(
                  segments.data?.items.some(
                    (segment) => segment.storageStatus === "missing",
                  )
                    ? "meetingRecorder.audioNotRetained"
                    : "meetingRecorder.noAudio",
                )}
              </span>
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

export default function MeetingRecorderDetailPage() {
  return (
    <MeetingRecorderRouteGate>
      <DetailContent />
    </MeetingRecorderRouteGate>
  );
}
