import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

const CROP_EMOJI = {
  rice: "🌾", wheat: "🌾", maize: "🌽", apple: "🍎", banana: "🍌",
  mango: "🥭", grapes: "🍇", watermelon: "🍉", orange: "🍊", papaya: "🧡",
  coconut: "🥥", cotton: "🌿", coffee: "☕", jute: "🌿",
  default: "🌱",
};

function cropEmoji(name = "") {
  return CROP_EMOJI[name.toLowerCase()] || CROP_EMOJI.default;
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1)  return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  <  7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
      <div className="text-sm font-medium text-slate-600 dark:text-slate-300 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function ConfidencePill({ value }) {
  const color =
    value >= 80 ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400" :
    value >= 55 ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400" :
                  "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {value}%
    </span>
  );
}

// Off-screen PDF panel for history items (always light mode, inline hex styles)
function HistoryReportPanel({ item }) {
  if (!item) return null;
  const result = item.result ?? {};
  const ins    = item.inputs ?? {};

  const date = new Date(item.timestamp).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
  const time = new Date(item.timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit",
  });

  const inputs = [
    { label: "Nitrogen (N)",   value: ins.n,           unit: "mg/kg" },
    { label: "Phosphorus (P)", value: ins.p,           unit: "mg/kg" },
    { label: "Potassium (K)",  value: ins.k,           unit: "mg/kg" },
    { label: "Soil pH",        value: ins.ph,          unit: ""      },
    { label: "Temperature",    value: ins.temperature, unit: "°C"    },
    { label: "Humidity",       value: ins.humidity,    unit: "%"     },
    { label: "Rainfall",       value: ins.rainfall,    unit: "mm"    },
  ];

  return (
    <div
      id="history-pdf-report"
      style={{
        position: "fixed", left: "-9999px", top: 0,
        width: "680px", background: "#ffffff", color: "#1e293b",
        fontFamily: "'Inter', system-ui, sans-serif",
        padding: "40px", fontSize: "14px", lineHeight: "1.5",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px", paddingBottom: "18px", borderBottom: "2px solid #059669" }}>
        <div>
          <div style={{ fontSize: "22px", fontWeight: "700", color: "#059669" }}>SmartCrop</div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>Crop Recommendation Report</div>
        </div>
        <div style={{ textAlign: "right", fontSize: "12px", color: "#64748b" }}>
          <div>{date} at {time}</div>
          <div style={{ marginTop: "2px" }}>Model: {result.model_used ?? "—"}</div>
        </div>
      </div>

      {/* Recommendation */}
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "18px", marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", fontWeight: "700", color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
          Recommended Crop
        </div>
        <div style={{ fontSize: "26px", fontWeight: "700", color: "#064e3b", textTransform: "capitalize", marginBottom: "8px" }}>
          {cropEmoji(result.recommended_crop ?? "")} {result.recommended_crop ?? "—"}
        </div>
        <div style={{ fontSize: "13px", color: "#166534", marginBottom: "8px" }}>
          Confidence: <strong>{result.confidence ?? 0}%</strong>
        </div>
        <div style={{ height: "8px", background: "#d1fae5", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(result.confidence ?? 0, 100)}%`, background: "#059669", borderRadius: "4px" }} />
        </div>
      </div>

      {/* Field Parameters */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
          Field Parameters
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          {inputs.map(({ label, value, unit }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <span style={{ color: "#64748b", fontSize: "13px" }}>{label}</span>
              <span style={{ fontWeight: "600", color: "#1e293b", fontSize: "13px" }}>
                {value != null ? `${value}${unit}` : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top 5 */}
      {result.top5?.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
            Top 5 Predictions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {result.top5.map((entry, i) => (
              <div key={entry.crop} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ width: "16px", color: "#94a3b8", fontSize: "12px", textAlign: "right" }}>{i + 1}</span>
                <span style={{ width: "110px", fontSize: "13px", color: "#1e293b", textTransform: "capitalize", fontWeight: i === 0 ? "600" : "400" }}>
                  {cropEmoji(entry.crop)} {entry.crop}
                </span>
                <div style={{ flex: 1, height: "8px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(entry.probability, 100)}%`, background: i === 0 ? "#059669" : "#34d399", borderRadius: "4px" }} />
                </div>
                <span style={{ width: "44px", textAlign: "right", fontSize: "12px", color: "#64748b" }}>{entry.probability}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "14px", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "11px", color: "#94a3b8" }}>Generated by SmartCrop · Final Year Project</span>
        <span style={{ fontSize: "11px", color: "#94a3b8" }}>BERT + DistilBERT + SHAP</span>
      </div>
    </div>
  );
}

function PredictionCard({ item, onReload, onDownload, isDownloading, onDelete, isDeleting }) {
  const [expanded,       setExpanded]       = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const crop = item.result?.recommended_crop ?? "—";
  const conf = item.result?.confidence ?? 0;
  const ins  = item.inputs ?? {};

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-2xl shrink-0">
          {cropEmoji(crop)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900 dark:text-slate-100 capitalize">{crop}</span>
            <ConfidencePill value={conf} />
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {item.result?.model_used}
            </span>
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5" title={formatDate(item.timestamp)}>
            {relativeTime(item.timestamp)} · {formatDate(item.timestamp)}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onReload(ins)}
            title="Reload these values into the dashboard"
            className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            Reload
          </button>
          <button
            onClick={() => onDownload(item)}
            disabled={isDownloading}
            title="Download PDF report"
            className="flex items-center gap-1 text-xs bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-emerald-700 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-600 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isDownloading ? (
              <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11" />
              </svg>
            )}
            PDF
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-500 font-medium">Delete?</span>
              <button
                onClick={() => { onDelete(item.timestamp); setConfirmDelete(false); }}
                disabled={isDeleting}
                className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-lg font-medium transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete this prediction"
              className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Compact inputs summary (always visible) */}
      <div className="px-4 sm:px-5 pb-4 grid grid-cols-4 sm:grid-cols-7 gap-2">
        {[
          { label: "N",    value: ins.n,           unit: "" },
          { label: "P",    value: ins.p,           unit: "" },
          { label: "K",    value: ins.k,           unit: "" },
          { label: "pH",   value: ins.ph,          unit: "" },
          { label: "Temp", value: ins.temperature, unit: "°C" },
          { label: "Hum",  value: ins.humidity,    unit: "%" },
          { label: "Rain", value: ins.rainfall,    unit: "mm" },
        ].map(({ label, value, unit }) => (
          <div key={label} className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-2 py-1.5 text-center">
            <div className="text-xs text-slate-400 dark:text-slate-500">{label}</div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {value != null ? `${value}${unit}` : "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Expanded: top-5 breakdown */}
      {expanded && item.result?.top5?.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 sm:px-5 py-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
            Top 5 predictions
          </div>
          <div className="space-y-2">
            {item.result.top5.map((entry, i) => (
              <div key={entry.crop} className="flex items-center gap-3">
                <span className="text-slate-400 dark:text-slate-500 text-xs w-4 text-right">{i + 1}</span>
                <span>{cropEmoji(entry.crop)}</span>
                <span className="capitalize text-sm text-slate-700 dark:text-slate-300 flex-1">{entry.crop}</span>
                <div className="flex items-center gap-2 w-36">
                  <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${Math.min(entry.probability, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums w-10 text-right">
                    {entry.probability}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function History() {
  const { token } = useAuth();
  const navigate  = useNavigate();

  const [data,          setData]          = useState(null);
  const [page,          setPage]          = useState(1);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [reportItem,    setReportItem]    = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [deletingId,    setDeletingId]    = useState(null);

  const load = useCallback(async (p) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.history(token, p, 20);
      setData(res);
      setPage(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(1); }, [load]);

  // PDF generation is a two-step async dance:
  //   1. handleDownload sets reportItem → React re-renders HistoryReportPanel with real data.
  //   2. This effect fires AFTER that render, so html2canvas sees the populated DOM.
  // Without the effect deferral, html2canvas would screenshot a blank/stale panel.
  useEffect(() => {
    if (!reportItem) return;

    const run = async () => {
      try {
        const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
          import("jspdf"),
          import("html2canvas"),
        ]);
        const el = document.getElementById("history-pdf-report");
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        const pdf    = new jsPDF("p", "mm", "a4");
        const pageW  = pdf.internal.pageSize.getWidth();
        const pageH  = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const imgW   = pageW - margin * 2;
        const imgH   = (canvas.height * imgW) / canvas.width;
        const imgData = canvas.toDataURL("image/png");
        const pages  = Math.ceil(imgH / pageH);
        for (let i = 0; i < pages; i++) {
          if (i > 0) pdf.addPage();
          pdf.addImage(imgData, "PNG", margin, -i * pageH, imgW, imgH);
        }
        const crop = reportItem.result?.recommended_crop ?? "report";
        const date = new Date(reportItem.timestamp).toISOString().split("T")[0];
        pdf.save(`cropai-history-${crop}-${date}.pdf`);
      } catch (err) {
        console.error("PDF generation failed:", err);
      } finally {
        setDownloadingId(null);
        setReportItem(null);
      }
    };

    run();
  }, [reportItem]);

  const handleReload = (inputs) => {
    navigate("/dashboard", { state: { values: inputs } });
  };

  const handleDelete = async (timestamp) => {
    setDeletingId(timestamp);
    try {
      await api.deleteHistoryItem(token, timestamp);
      setData((prev) => {
        if (!prev) return prev;
        const items = prev.items.filter((i) => i.timestamp !== timestamp);
        return { ...prev, items, total: prev.total - 1 };
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = (item) => {
    if (downloadingId) return;
    setDownloadingId(item.timestamp);
    setReportItem(item);
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const cropCounts = items.reduce((acc, item) => {
    const c = item.result?.recommended_crop;
    if (c) acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const topCrop = Object.entries(cropCounts).sort((a, b) => b[1] - a[1])[0];

  const avgConf = items.length
    ? (items.reduce((s, i) => s + (i.result?.confidence ?? 0), 0) / items.length).toFixed(1)
    : null;

  const firstDate = items.length
    ? new Date(items[items.length - 1].timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div
        className="fixed inset-0 bg-cover bg-center -z-10"
        style={{
          backgroundImage: "url('https://plus.unsplash.com/premium_photo-1664298984101-5c9f1d09f1c3?w=1600&q=80')",
          filter: "blur(4px) brightness(0.4)",
          transform: "scale(1.05)",
        }}
      />
      <div className="fixed inset-0 bg-slate-900/55 -z-10" />
      <Navbar />

      {/* Off-screen PDF panel — always in DOM, updated when reportItem is set */}
      <HistoryReportPanel item={reportItem} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Prediction History</h1>
          <p className="text-white/60 mt-1">
            All your past crop recommendations, newest first.
          </p>
        </div>

        {/* Stats */}
        {total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            <StatCard
              label="Total predictions"
              value={total}
              sub={firstDate ? `since ${firstDate}` : undefined}
            />
            {topCrop && (
              <StatCard
                label="Most recommended"
                value={`${cropEmoji(topCrop[0])} ${topCrop[0]}`}
                sub={`${topCrop[1]} time${topCrop[1] !== 1 ? "s" : ""} on this page`}
              />
            )}
            {avgConf != null && (
              <StatCard
                label="Avg. confidence"
                value={`${avgConf}%`}
                sub="across this page"
              />
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 animate-pulse"
              >
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-700 shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/3" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && total === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-12 flex flex-col items-center text-center">
            <div className="text-5xl mb-4">📋</div>
            <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-lg mb-1">No predictions yet</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-5">
              Run your first crop recommendation and it will appear here.
            </p>
            <button
              onClick={() => navigate("/dashboard")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {/* List */}
        {!loading && items.length > 0 && (
          <div className="space-y-4">
            {items.map((item, i) => (
              <PredictionCard
                key={item.timestamp + i}
                item={item}
                onReload={handleReload}
                onDownload={handleDownload}
                isDownloading={downloadingId === item.timestamp}
                onDelete={handleDelete}
                isDeleting={deletingId === item.timestamp}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && data && data.pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 1}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Page {page} of {data.pages}
            </span>
            <button
              onClick={() => load(page + 1)}
              disabled={page >= data.pages}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
