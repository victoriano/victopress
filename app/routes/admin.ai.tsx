/**
 * Admin - Photo AI
 *
 * Reviews AI-generated photo metadata and gallery membership suggestions.
 * Analysis runs in resumable batches through /api/admin/ai.
 */

import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "~/components/AdminLayout";
import { PhotoAiGraph } from "~/components/PhotoAiGraph";
import { checkAdminAuth, getAdminUser } from "~/utils/admin-auth";

interface AiSummary {
  total: number;
  eligible: number;
  pending: number;
  completed: number;
  failed: number;
  skippedProtected: number;
}

interface GallerySuggestion {
  gallerySlug: string;
  galleryTitle: string;
  confidence: number;
  reason: string;
  status: string;
  alreadyCurrent: boolean;
}

interface AiPhotoRecord {
  assetId: string;
  path: string;
  filename: string;
  gallerySlug: string;
  caption: string;
  tags: string[];
  status: string;
  error?: string;
  suggestions: GallerySuggestion[];
}

interface AiDashboardData {
  configured: boolean;
  model: string;
  embeddingModel: string;
  vectorBackend: string;
  summary: AiSummary;
  records: AiPhotoRecord[];
}

interface AiMutationResponse extends Partial<AiDashboardData> {
  success?: boolean;
  done?: boolean;
  processed?: number;
  remaining?: number;
  message?: string;
  error?: string;
  job?: {
    done?: boolean;
    remaining?: number;
  };
}

type StatusFilter = "all" | "pending" | "completed" | "failed";
type ViewMode = "map" | "review";

export async function loader({ request, context }: LoaderFunctionArgs) {
  await checkAdminAuth(request, context);
  const username = await getAdminUser(request, context);
  return json({ username });
}

export default function AdminAi() {
  const { username } = useLoaderData<typeof loader>();
  const dashboardFetcher = useFetcher<AiDashboardData | { error: string }>();
  const startFetcher = useFetcher<AiMutationResponse>();
  const batchFetcher = useFetcher<AiMutationResponse>();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const initialDashboardLoadStarted = useRef(false);
  const handledStartResponse = useRef<AiMutationResponse | null>(null);
  const handledBatchResponse = useRef<AiMutationResponse | null>(null);

  const refreshDashboard = useCallback(() => {
    dashboardFetcher.load("/api/admin/ai");
  }, [dashboardFetcher]);

  const processNextBatch = useCallback(() => {
    const formData = new FormData();
    formData.append("action", "process-batch");
    batchFetcher.submit(formData, {
      method: "POST",
      action: "/api/admin/ai",
    });
  }, [batchFetcher]);

  useEffect(() => {
    if (
      !initialDashboardLoadStarted.current &&
      dashboardFetcher.state === "idle" &&
      dashboardFetcher.data === undefined
    ) {
      initialDashboardLoadStarted.current = true;
      refreshDashboard();
    }
  }, [dashboardFetcher.data, dashboardFetcher.state, refreshDashboard]);

  useEffect(() => {
    const response = startFetcher.data;
    if (startFetcher.state !== "idle" || !response || handledStartResponse.current === response) {
      return;
    }
    handledStartResponse.current = response;

    const error = getMutationError(response);
    if (error) {
      setIsBatchRunning(false);
      setNotice({ type: "error", text: error });
      refreshDashboard();
      return;
    }

    refreshDashboard();
    if (isProcessingDone(response)) {
      setIsBatchRunning(false);
      setNotice({ type: "success", text: response.message || "All eligible photos are already analyzed." });
      return;
    }

    setIsBatchRunning(true);
    processNextBatch();
  }, [processNextBatch, refreshDashboard, startFetcher.data, startFetcher.state]);

  useEffect(() => {
    const response = batchFetcher.data;
    if (batchFetcher.state !== "idle" || !response || handledBatchResponse.current === response) {
      return;
    }
    handledBatchResponse.current = response;
    refreshDashboard();

    const error = getMutationError(response);
    if (error) {
      setIsBatchRunning(false);
      setNotice({ type: "error", text: error });
      return;
    }

    if (isProcessingDone(response)) {
      setIsBatchRunning(false);
      setNotice({ type: "success", text: response.message || "Photo analysis is complete." });
      return;
    }

    if (isBatchRunning) {
      const timer = window.setTimeout(processNextBatch, 250);
      return () => window.clearTimeout(timer);
    }
  }, [batchFetcher.data, batchFetcher.state, isBatchRunning, processNextBatch, refreshDashboard]);

  const dashboard = isDashboardData(dashboardFetcher.data) ? dashboardFetcher.data : null;
  const dashboardError = dashboardFetcher.data && "error" in dashboardFetcher.data
    ? dashboardFetcher.data.error
    : null;
  const isStarting = startFetcher.state !== "idle";
  const isProcessing = isBatchRunning || isStarting || batchFetcher.state !== "idle";

  const filteredRecords = useMemo(() => {
    if (!dashboard) return [];
    if (filter === "all") return dashboard.records;
    return dashboard.records.filter((record) => normalizeRecordStatus(record.status) === filter);
  }, [dashboard, filter]);

  const beginAnalysis = useCallback(() => {
    setNotice(null);
    handledStartResponse.current = null;
    handledBatchResponse.current = null;
    const formData = new FormData();
    formData.append("action", "start");
    startFetcher.submit(formData, {
      method: "POST",
      action: "/api/admin/ai",
    });
  }, [startFetcher]);

  const stopAfterCurrentBatch = useCallback(() => {
    setIsBatchRunning(false);
    setNotice({
      type: "success",
      text: "Analysis will pause after the current batch. You can resume it at any time.",
    });
  }, []);

  return (
    <AdminLayout username={username || undefined}>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Photo AI</h1>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                Suggestions
              </span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 max-w-2xl">
              Generate searchable descriptions and review which existing galleries may suit each photo.
            </p>
          </div>
          <Link
            to="/admin/upload"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Upload photos
          </Link>
        </div>

        {notice && (
          <div
            role={notice.type === "error" ? "alert" : "status"}
            className={`mb-6 rounded-lg border p-4 text-sm ${
              notice.type === "error"
                ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                : "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200"
            }`}
          >
            {notice.text}
          </div>
        )}

        {dashboardError && (
          <ErrorPanel message={dashboardError} onRetry={refreshDashboard} />
        )}

        {!dashboard && !dashboardError ? (
          <DashboardSkeleton />
        ) : dashboard ? (
          <>
            <ConfigurationPanel
              dashboard={dashboard}
              isProcessing={isProcessing}
              onAnalyze={beginAnalysis}
              onPause={stopAfterCurrentBatch}
              onRefresh={refreshDashboard}
              isRefreshing={dashboardFetcher.state !== "idle"}
            />

            <SummaryPanel summary={dashboard.summary} isProcessing={isProcessing} />
          </>
        ) : null}

        <div className="mt-8 inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-950" aria-label="Photo AI view">
          {(["map", "review"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === mode
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {mode === "map" ? "Similarity map" : "Review suggestions"}
            </button>
          ))}
        </div>

        <div className={viewMode === "map" ? "mt-4" : "hidden"} aria-hidden={viewMode !== "map"}>
          <PhotoAiGraph onChanged={refreshDashboard} onNotice={setNotice} />
        </div>

        {viewMode === "review" && dashboard ? (
          <section aria-labelledby="photo-results-heading" className="mt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-4">
              <div>
                <h2 id="photo-results-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
                  Analyzed photos
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Accepting or rejecting a gallery suggestion records your editorial decision only.
                </p>
              </div>
              <StatusFilters
                value={filter}
                summary={dashboard.summary}
                totalRecords={dashboard.records.length}
                onChange={setFilter}
              />
            </div>

            {filteredRecords.length === 0 ? (
              <EmptyState configured={dashboard.configured} hasRecords={dashboard.records.length > 0} />
            ) : (
              <div className="grid gap-5 xl:grid-cols-2">
                {filteredRecords.map((record) => (
                  <AiPhotoCard
                    key={record.assetId}
                    record={record}
                    onChanged={refreshDashboard}
                    onNotice={setNotice}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </AdminLayout>
  );
}

function ConfigurationPanel({
  dashboard,
  isProcessing,
  onAnalyze,
  onPause,
  onRefresh,
  isRefreshing,
}: {
  dashboard: AiDashboardData;
  isProcessing: boolean;
  onAnalyze: () => void;
  onPause: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const hasPendingWork = dashboard.summary.pending > 0;

  return (
    <section className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-5 lg:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                dashboard.configured
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dashboard.configured ? "bg-green-500" : "bg-amber-500"}`} />
              {dashboard.configured ? "AI configured" : "Configuration required"}
            </span>
            {isProcessing && (
              <span className="inline-flex items-center gap-1.5 text-sm text-violet-700 dark:text-violet-300" role="status" aria-live="polite">
                <Spinner className="w-4 h-4" /> Processing
              </span>
            )}
          </div>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <ModelDetail label="Analysis" value={dashboard.model || "Not configured"} />
            <ModelDetail label="Embeddings" value={dashboard.embeddingModel || "Not configured"} />
            <ModelDetail label="Vector index" value={dashboard.vectorBackend || "Not configured"} />
          </dl>
          {!dashboard.configured && (
            <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
              Configure the Gemini API secret and vector index binding before starting analysis.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          {isProcessing ? (
            <button
              type="button"
              onClick={onPause}
              className="px-4 py-2 rounded-lg border border-violet-300 dark:border-violet-800 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
            >
              Pause after this batch
            </button>
          ) : (
            <button
              type="button"
              onClick={onAnalyze}
              disabled={!dashboard.configured || dashboard.summary.eligible === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <SparklesIcon />
              {hasPendingWork ? "Resume analysis" : "Analyze existing photos"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ModelDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-900 dark:text-gray-100 truncate" title={value}>{value}</dd>
    </div>
  );
}

function SummaryPanel({ summary, isProcessing }: { summary: AiSummary; isProcessing: boolean }) {
  const denominator = Math.max(summary.eligible, 1);
  const processed = Math.min(summary.completed + summary.failed, denominator);
  const progress = summary.eligible === 0 ? 0 : Math.round((processed / denominator) * 100);

  return (
    <section aria-label="Analysis progress" className="mt-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Photos" value={summary.total} />
        <SummaryCard label="Eligible" value={summary.eligible} />
        <SummaryCard label="Pending" value={summary.pending} tone={summary.pending > 0 ? "violet" : "default"} />
        <SummaryCard label="Completed" value={summary.completed} tone="green" />
        <SummaryCard label="Failed" value={summary.failed} tone={summary.failed > 0 ? "red" : "default"} />
        <SummaryCard label="Protected" value={summary.skippedProtected} />
      </div>
      <div className="mt-3 bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-medium text-gray-700 dark:text-gray-200">
            {isProcessing ? "Analysis in progress" : "Analysis progress"}
          </span>
          <span className="text-gray-500 dark:text-gray-400">{progress}%</span>
        </div>
        <div
          className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
          role="progressbar"
          aria-label="Photo analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className="h-full bg-violet-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "violet" | "green" | "red";
}) {
  const valueColor = {
    default: "text-gray-900 dark:text-white",
    violet: "text-violet-700 dark:text-violet-300",
    green: "text-green-700 dark:text-green-300",
    red: "text-red-700 dark:text-red-300",
  }[tone];

  return (
    <div className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  );
}

function StatusFilters({
  value,
  summary,
  totalRecords,
  onChange,
}: {
  value: StatusFilter;
  summary: AiSummary;
  totalRecords: number;
  onChange: (filter: StatusFilter) => void;
}) {
  const filters: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: totalRecords },
    { id: "pending", label: "Pending", count: summary.pending },
    { id: "completed", label: "Completed", count: summary.completed },
    { id: "failed", label: "Failed", count: summary.failed },
  ];

  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-1" aria-label="Filter photos by analysis status">
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          onClick={() => onChange(filter.id)}
          aria-pressed={value === filter.id}
          className={`whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === filter.id
              ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
              : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          {filter.label} <span className="ml-1 opacity-70">{filter.count}</span>
        </button>
      ))}
    </div>
  );
}

function AiPhotoCard({
  record,
  onChanged,
  onNotice,
}: {
  record: AiPhotoRecord;
  onChanged: () => void;
  onNotice: (notice: { type: "success" | "error"; text: string }) => void;
}) {
  const retryFetcher = useFetcher<AiMutationResponse>();
  const handledRetryResponse = useRef<AiMutationResponse | null>(null);
  const status = normalizeRecordStatus(record.status);

  useEffect(() => {
    const response = retryFetcher.data;
    if (retryFetcher.state !== "idle" || !response || handledRetryResponse.current === response) return;
    handledRetryResponse.current = response;
    const error = getMutationError(response);
    onNotice(error
      ? { type: "error", text: error }
      : { type: "success", text: response.message || `${record.filename} was queued for analysis.` });
    onChanged();
  }, [onChanged, onNotice, record.filename, retryFetcher.data, retryFetcher.state]);

  const retry = () => {
    handledRetryResponse.current = null;
    const formData = new FormData();
    formData.append("action", "analyze-photo");
    formData.append("assetId", record.assetId);
    retryFetcher.submit(formData, { method: "POST", action: "/api/admin/ai" });
  };

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <div className="flex min-h-36">
        <div className="w-32 sm:w-40 flex-shrink-0 bg-gray-100 dark:bg-gray-800">
          <img
            src={`/api/images/${encodeImagePath(record.path)}`}
            alt={record.caption || record.filename}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-medium text-gray-900 dark:text-white" title={record.filename}>
                {record.filename}
              </h3>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400 mt-0.5" title={record.gallerySlug}>
                Current gallery: {record.gallerySlug || "Unassigned"}
              </p>
            </div>
            <RecordStatusBadge status={status} rawStatus={record.status} />
          </div>

          {record.caption && (
            <p className="mt-3 text-sm leading-5 text-gray-700 dark:text-gray-300">{record.caption}</p>
          )}

          {record.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Suggested tags">
              {record.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-300">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {record.error && (
            <div role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
              {record.error}
            </div>
          )}

          {status === "failed" && (
            <button
              type="button"
              onClick={retry}
              disabled={retryFetcher.state !== "idle"}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline disabled:opacity-50"
            >
              {retryFetcher.state !== "idle" && <Spinner className="w-3.5 h-3.5" />}
              Retry this photo
            </button>
          )}
        </div>
      </div>

      {record.suggestions?.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-800 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
            Gallery suggestions
          </h4>
          <div className="space-y-3">
            {record.suggestions.map((suggestion) => (
              <SuggestionRow
                key={suggestion.gallerySlug}
                assetId={record.assetId}
                suggestion={suggestion}
                onChanged={onChanged}
                onNotice={onNotice}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function SuggestionRow({
  assetId,
  suggestion,
  onChanged,
  onNotice,
}: {
  assetId: string;
  suggestion: GallerySuggestion;
  onChanged: () => void;
  onNotice: (notice: { type: "success" | "error"; text: string }) => void;
}) {
  const fetcher = useFetcher<AiMutationResponse>();
  const handledResponse = useRef<AiMutationResponse | null>(null);
  const isPending = fetcher.state !== "idle";
  const confidence = formatConfidence(suggestion.confidence);
  const rawReviewStatus = suggestion.status?.toLowerCase();
  const reviewStatus = rawReviewStatus === "accepted" || rawReviewStatus === "rejected"
    ? rawReviewStatus
    : "pending";

  useEffect(() => {
    const response = fetcher.data;
    if (fetcher.state !== "idle" || !response || handledResponse.current === response) return;
    handledResponse.current = response;
    const error = getMutationError(response);
    onNotice(error
      ? { type: "error", text: error }
      : { type: "success", text: response.message || "Gallery suggestion updated." });
    onChanged();
  }, [fetcher.data, fetcher.state, onChanged, onNotice]);

  const review = (decision: "accepted" | "rejected") => {
    handledResponse.current = null;
    const formData = new FormData();
    formData.append("action", "review-suggestion");
    formData.append("assetId", assetId);
    formData.append("gallerySlug", suggestion.gallerySlug);
    formData.append("decision", decision);
    fetcher.submit(formData, { method: "POST", action: "/api/admin/ai" });
  };

  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm text-gray-900 dark:text-white">{suggestion.galleryTitle}</p>
            <span className="text-xs font-medium text-violet-700 dark:text-violet-300">{confidence} match</span>
            {suggestion.alreadyCurrent && (
              <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                Current gallery
              </span>
            )}
            {reviewStatus !== "pending" && (
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                reviewStatus === "accepted"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              }`}>
                {reviewStatus === "accepted" ? "Accepted" : "Rejected"}
              </span>
            )}
          </div>
          {suggestion.reason && (
            <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-400">{suggestion.reason}</p>
          )}
        </div>
      </div>

      {!suggestion.alreadyCurrent && reviewStatus === "pending" && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => review("accepted")}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-medium disabled:opacity-50"
          >
            {isPending && <Spinner className="w-3 h-3" />}
            Accept suggestion
          </button>
          <button
            type="button"
            onClick={() => review("rejected")}
            disabled={isPending}
            className="px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function RecordStatusBadge({ status, rawStatus }: { status: StatusFilter; rawStatus: string }) {
  const styles = {
    all: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    pending: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  }[status];

  return (
    <span className={`flex-shrink-0 px-2 py-1 rounded-full text-[11px] font-medium capitalize ${styles}`}>
      {rawStatus || status}
    </span>
  );
}

function EmptyState({ configured, hasRecords }: { configured: boolean; hasRecords: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-6 py-12 text-center">
      <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 flex items-center justify-center">
        <SparklesIcon />
      </div>
      <h3 className="font-medium text-gray-900 dark:text-white">
        {hasRecords ? "No photos match this filter" : "No photos analyzed yet"}
      </h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {!configured
          ? "Complete the AI configuration to begin."
          : hasRecords
            ? "Choose another status to see more photos."
            : "Start an analysis to create captions, tags, and gallery suggestions."}
      </p>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900/60 dark:bg-red-950/30">
      <h2 className="font-semibold text-red-900 dark:text-red-200">Photo AI could not be loaded</h2>
      <p className="mt-1 text-sm text-red-700 dark:text-red-300">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-red-800 dark:text-red-200 underline">
        Try again
      </button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="Loading Photo AI" role="status" className="animate-pulse space-y-5">
      <div className="h-36 rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-24 rounded-xl bg-gray-200 dark:bg-gray-800" />
        ))}
      </div>
      <span className="sr-only">Loading photo analysis data…</span>
    </div>
  );
}

function Spinner({ className }: { className: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M12 3a9 9 0 00-9 9h3a6 6 0 016-6V3z" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.456-2.456L14.25 6l1.035-.259a3.375 3.375 0 002.456-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

function encodeImagePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function formatConfidence(value: number): string {
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
}

function normalizeRecordStatus(status: string): StatusFilter {
  switch (status?.toLowerCase()) {
    case "complete":
    case "completed":
    case "analyzed":
    case "ready":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "pending":
    case "queued":
    case "processing":
    case "running":
      return "pending";
    default:
      return "all";
  }
}

function isDashboardData(data: AiDashboardData | { error: string } | undefined): data is AiDashboardData {
  return Boolean(data && "summary" in data && "records" in data && "configured" in data);
}

function getMutationError(response: AiMutationResponse): string | null {
  if (response.error) return response.error;
  if (response.success === false) return response.message || "The request could not be completed.";
  return null;
}

function isProcessingDone(response: AiMutationResponse): boolean {
  return response.done === true
    || response.remaining === 0
    || response.job?.done === true
    || response.job?.remaining === 0;
}
