import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api";

// PSI thresholds from: Yurdakul, B. (2018). Statistical properties of
// population stability index. Western Michigan University.
const PSI_WARN = 0.10;
const PSI_CRIT = 0.20;

const STATUS_STYLES = {
  ok:       { row: "bg-emerald-50 dark:bg-emerald-900/10",  badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", bar: "bg-emerald-500", icon: "✓" },
  warning:  { row: "bg-amber-50  dark:bg-amber-900/10",     badge: "bg-amber-100  text-amber-700  dark:bg-amber-900/40  dark:text-amber-300",  bar: "bg-amber-400",  icon: "!" },
  critical: { row: "bg-red-50    dark:bg-red-900/10",       badge: "bg-red-100    text-red-700    dark:bg-red-900/40    dark:text-red-300",    bar: "bg-red-500",    icon: "✕" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.ok;
  const label = { ok: "No drift", warning: "Moderate drift", critical: "High drift" }[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.badge}`}>
      <span>{s.icon}</span> {label}
    </span>
  );
}

// PSI bar: scale 0 → 0.30 (anything ≥ 0.30 fills the bar)
function PSIBar({ psi, status }) {
  const s   = STATUS_STYLES[status] ?? STATUS_STYLES.ok;
  const pct = Math.min((psi / 0.30) * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
        {/* threshold markers */}
        <div className="absolute top-0 bottom-0 w-px bg-amber-400/60" style={{ left: `${(PSI_WARN / 0.30) * 100}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-red-500/60"   style={{ left: `${(PSI_CRIT / 0.30) * 100}%` }} />
        <div className={`h-2 rounded-full transition-all ${s.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold w-14 text-right ${
        status === "critical" ? "text-red-600 dark:text-red-400" :
        status === "warning"  ? "text-amber-600 dark:text-amber-400" :
                                "text-emerald-600 dark:text-emerald-400"
      }`}>
        {psi.toFixed(4)}
      </span>
    </div>
  );
}

function OverallBanner({ status, maxPsi, sampleCount, minSamples }) {
  if (status === "no_data") {
    return (
      <div className="mb-8 p-5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
        No prediction data yet. Make some predictions first, then check back.
      </div>
    );
  }


  const cfg = {
    ok:       { bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800", icon: "✅", title: "No significant drift detected",   sub: "Input distributions are within the expected range of the training data." },
    warning:  { bg: "bg-amber-50  dark:bg-amber-900/20  border-amber-200  dark:border-amber-800",  icon: "⚠️", title: "Moderate drift detected (PSI ≥ 0.10)", sub: "Some input features are shifting. Monitor closely and consider retraining soon." },
    critical: { bg: "bg-red-50    dark:bg-red-900/20    border-red-200    dark:border-red-800",    icon: "🔴", title: "Significant drift detected (PSI ≥ 0.20)", sub: "Input distribution has shifted significantly. Retraining is recommended." },
  }[status] ?? {};

  return (
    <div className={`mb-8 p-5 rounded-2xl border ${cfg.bg} flex items-start gap-4`}>
      <span className="text-2xl mt-0.5">{cfg.icon}</span>
      <div className="flex-1">
        <p className="font-bold text-slate-800 dark:text-slate-100">{cfg.title}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{cfg.sub}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
          Based on last {sampleCount} prediction{sampleCount !== 1 ? "s" : ""} · Highest PSI: {maxPsi?.toFixed(4) ?? "—"}
        </p>
        {sampleCount < minSamples && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
            Note: PSI is most reliable with {minSamples}+ predictions. Current results are preliminary ({sampleCount} collected).
          </p>
        )}
      </div>
      {status !== "ok" && (
        <Link
          to="/admin/models"
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          Go to Retrain
        </Link>
      )}
    </div>
  );
}

export default function AdminDrift() {
  const { token }             = useAuth();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  async function load() {
    try {
      setLoading(true);
      const res = await api.adminDrift(token);
      setData(res);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const confWarn = data?.thresholds?.conf_warn ?? 75;
  const confCrit = data?.thresholds?.conf_crit ?? 60;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Performance Drift Monitor</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Population Stability Index (PSI) — compares recent prediction inputs against the training data distribution
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
            >
              Refresh
            </button>
            <Link
              to="/admin/users"
              className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/60 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              User Management
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-slate-400">Analysing predictions...</div>
        ) : (
          <>
            <OverallBanner
              status={data?.overall_status}
              maxPsi={data?.max_psi}
              sampleCount={data?.sample_count ?? 0}
              minSamples={data?.min_samples ?? 20}
            />

            {data?.overall_status !== "no_data" && (
              <>
                {/* Summary cards */}
                <div className="grid md:grid-cols-3 gap-6 mb-8">
                  {/* Avg confidence */}
                  <div className={`rounded-2xl border p-5 ${
                    data?.conf_status === "critical" ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10" :
                    data?.conf_status === "warning"  ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10" :
                                                       "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  }`}>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-1">Avg Confidence</p>
                    <p className="text-3xl font-bold text-slate-800 dark:text-white">
                      {data?.avg_confidence != null ? `${data.avg_confidence}%` : "—"}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={data?.conf_status ?? "ok"} />
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                      Warn &lt;{confWarn}% · Alert &lt;{confCrit}%
                    </p>
                  </div>

                  {/* Sample count */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-1">Predictions Analysed</p>
                    <p className="text-3xl font-bold text-slate-800 dark:text-white">{data?.sample_count ?? 0}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Most recent {data?.sample_count} logged predictions</p>
                  </div>

                  {/* PSI legend */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-3">PSI Thresholds</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-400">No drift — PSI &lt; 0.10</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-400">Moderate — PSI 0.10–0.20</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-400">Retrain — PSI &gt; 0.20</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* PSI feature table */}
                {data?.features?.length > 0 && (
                  <section className="mb-8">
                    <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
                      Feature PSI Scores
                    </h2>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            {["Feature", "Training Mean", "Recent Mean", "PSI Score", "Status"].map((h) => (
                              <th key={h} className="px-5 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {data.features.map((f) => {
                            const s = STATUS_STYLES[f.status] ?? STATUS_STYLES.ok;
                            return (
                              <tr key={f.key} className={`transition-colors ${s.row}`}>
                                <td className="px-5 py-4 font-semibold text-slate-800 dark:text-slate-200">{f.label}</td>
                                <td className="px-5 py-4 text-slate-600 dark:text-slate-400 font-mono">{f.training_mean}</td>
                                <td className="px-5 py-4 text-slate-700 dark:text-slate-300 font-mono font-medium">{f.recent_mean}</td>
                                <td className="px-5 py-4 min-w-[200px]">
                                  <PSIBar psi={f.psi} status={f.status} />
                                </td>
                                <td className="px-5 py-4">
                                  <StatusBadge status={f.status} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 px-1">
                      Bar markers show PSI = 0.10 (warning) and PSI = 0.20 (critical). Scale: 0 to 0.30+.
                      Training means are from the full dataset. PSI uses equal-frequency binning (10 bins).
                    </p>
                  </section>
                )}

                {/* Confidence trend */}
                {data?.confidence_trend?.length > 0 && (
                  <section>
                    <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
                      Daily Confidence Trend
                    </h2>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            {["Date", "Avg Confidence", "Predictions", "Status"].map((h) => (
                              <th key={h} className="px-5 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {[...data.confidence_trend].reverse().map((row) => {
                            const cs =
                              row.avg_confidence < confCrit ? "critical" :
                              row.avg_confidence < confWarn ? "warning"  : "ok";
                            return (
                              <tr key={row.date} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td className="px-5 py-3 text-slate-700 dark:text-slate-300 font-medium">{row.date}</td>
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-32 bg-slate-100 dark:bg-slate-700 rounded-full h-2">
                                      <div
                                        className={`h-2 rounded-full ${STATUS_STYLES[cs].bar}`}
                                        style={{ width: `${Math.min(row.avg_confidence, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-slate-700 dark:text-slate-300 font-mono text-sm">{row.avg_confidence}%</span>
                                  </div>
                                </td>
                                <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{row.count}</td>
                                <td className="px-5 py-3"><StatusBadge status={cs} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
