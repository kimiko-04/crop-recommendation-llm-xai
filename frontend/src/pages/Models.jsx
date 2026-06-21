import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

const BASE = "http://localhost:8000";

function pct(val) {
  return `${val.toFixed(1)}%`;
}

function MetricBadge({ label, value, highlight }) {
  return (
    <div className={`rounded-xl p-4 text-center ${highlight ? "bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700" : "bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600"}`}>
      <div className={`text-2xl font-bold tabular-nums ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-200"}`}>
        {pct(value)}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{label}</div>
    </div>
  );
}

function ConfusionMatrix({ cm }) {
  const { labels, matrix } = cm;
  const n = labels.length;

  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const maxDiag   = Math.max(...matrix.map((row, i) => row[i]));

  const cellColor = (r, c, val) => {
    if (val === 0) return "transparent";
    if (r === c) {
      const alpha = 0.15 + (val / maxDiag) * 0.75;
      return `rgba(16,185,129,${alpha.toFixed(2)})`;
    }
    const alpha = Math.min((val / rowTotals[r]) * 6, 0.85);
    return `rgba(239,68,68,${alpha.toFixed(2)})`;
  };

  const cellText = (r, c, val) => {
    if (val === 0) return "";
    return val;
  };

  return (
    <div className="overflow-auto">
      <div style={{ display: "inline-flex", flexDirection: "column", gap: 0 }}>
        {/* Top labels (rotated) */}
        <div style={{ display: "flex", paddingLeft: 88 }}>
          {labels.map((lbl) => (
            <div
              key={lbl}
              style={{ width: 26, height: 72, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 4 }}
            >
              <span
                style={{ fontSize: 9, transform: "rotate(-60deg)", transformOrigin: "bottom center", whiteSpace: "nowrap", color: "inherit" }}
                className="text-slate-500 dark:text-slate-400 capitalize"
              >
                {lbl}
              </span>
            </div>
          ))}
        </div>

        {/* Rows */}
        {matrix.map((row, r) => (
          <div key={r} style={{ display: "flex", alignItems: "center" }}>
            {/* Row label */}
            <div
              style={{ width: 88, paddingRight: 6, textAlign: "right", fontSize: 9, flexShrink: 0 }}
              className="text-slate-500 dark:text-slate-400 capitalize"
            >
              {labels[r]}
            </div>
            {/* Cells */}
            {row.map((val, c) => (
              <div
                key={c}
                title={`Actual: ${labels[r]} → Predicted: ${labels[c]}: ${val}`}
                style={{
                  width: 26, height: 26,
                  backgroundColor: cellColor(r, c, val),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 7, fontWeight: 600, lineHeight: 1,
                  border: "1px solid rgba(0,0,0,0.06)",
                  color: r === c && val > maxDiag * 0.5 ? "#fff" : "rgba(0,0,0,0.6)",
                  flexShrink: 0,
                }}
              >
                {cellText(r, c, val)}
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
        Rows = actual class · Columns = predicted class · Hover a cell for details
      </p>
    </div>
  );
}

export default function Models() {
  const { token } = useAuth();
  const [info, setInfo]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [computing, setComputing] = useState({});
  const [activeTab, setActiveTab] = useState(null);
  const [error, setError]       = useState("");

  const fetchInfo = async () => {
    try {
      const res  = await fetch(`${BASE}/models/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setInfo(data);
      if (!activeTab && data.models) {
        setActiveTab(Object.keys(data.models)[0]);
      }
    } catch {
      setError("Failed to load model information.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInfo(); }, []);

  const handleCompute = async (key) => {
    setComputing((c) => ({ ...c, [key]: true }));
    try {
      await fetch(`${BASE}/models/compute-matrix/${key}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchInfo();
    } finally {
      setComputing((c) => ({ ...c, [key]: false }));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 dark:text-slate-400">Loading model information…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <Navbar />
        <div className="max-w-6xl mx-auto px-4 py-20 text-center">
          <p className="text-red-500">{error || "No model data available."}</p>
        </div>
      </div>
    );
  }

  const modelKeys  = Object.keys(info.models);
  const activeModel = activeTab && info.models[activeTab];

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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">

        {/* Active model banner */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 text-white mb-8 shadow-md">
          <p className="text-emerald-200 text-sm font-medium">Active recommendation model</p>
          <p className="text-2xl font-bold mt-0.5">{info.best_model}</p>
          <p className="text-emerald-200 text-sm mt-0.5">
            Model is selected based on the highest validation accuracy
          </p>
        </div>

        {/* Model comparison cards */}
        <h2 className="text-lg font-semibold text-white mb-4">Model Performance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          {modelKeys.map((key) => {
            const m = info.models[key];
            const isBest = key.toUpperCase() === info.best_model;
            return (
              <div
                key={key}
                className={`bg-white dark:bg-slate-800 rounded-2xl border p-6 transition-shadow ${isBest ? "border-emerald-400 dark:border-emerald-600 shadow-md" : "border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md"}`}
              >
                <div className="flex items-center gap-3 mb-5">
                  <h3 className="text-xl font-bold text-white">{m.name}</h3>
                  {isBest && (
                    <span className="text-xs bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 rounded-full font-semibold">
                      ✓ In use
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricBadge label="Accuracy"  value={m.accuracy}  highlight={isBest} />
                  <MetricBadge label="Precision" value={m.precision} highlight={false}  />
                  <MetricBadge label="Recall"    value={m.recall}    highlight={false}  />
                  <MetricBadge label="F1 Score"  value={m.f1}        highlight={false}  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Confusion matrix section */}
        <h2 className="text-lg font-semibold text-white mb-4">Confusion Matrix</h2>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {modelKeys.map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === key
                  ? "bg-emerald-600 text-white"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-300"
              }`}
            >
              {info.models[key].name}
            </button>
          ))}
        </div>

        {activeModel && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
            {activeModel.confusion_matrix ? (
              <ConfusionMatrix cm={activeModel.confusion_matrix} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-5xl mb-4">📊</div>
                <p className="text-slate-700 dark:text-slate-300 font-medium mb-2">
                  Confusion matrix not yet computed
                </p>
                <p className="text-slate-400 dark:text-slate-500 text-sm mb-6 max-w-sm">
                  This runs inference on the full dataset (~2 200 samples) and caches the result. Takes about 15 seconds.
                </p>
                <button
                  onClick={() => handleCompute(activeTab)}
                  disabled={computing[activeTab]}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
                >
                  {computing[activeTab] ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Computing…
                    </>
                  ) : "Compute Confusion Matrix"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        {activeModel?.confusion_matrix && (
          <div className="flex items-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: "rgba(16,185,129,0.75)" }} />
              <span className="text-xs text-slate-500 dark:text-slate-400">Correct prediction</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: "rgba(239,68,68,0.6)" }} />
              <span className="text-xs text-slate-500 dark:text-slate-400">Misclassification</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
              <span className="text-xs text-slate-500 dark:text-slate-400">Zero</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
