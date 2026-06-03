import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api";

const METRIC_KEYS = ["accuracy", "precision", "recall", "f1"];

function MetricBadge({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-slate-800 dark:text-white">
        {value != null ? `${value}%` : "—"}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function ModelCard({ name, data, isActive, onSetActive, busy }) {
  return (
    <div className={`rounded-2xl border p-6 transition-all ${
      isActive
        ? "border-emerald-400 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 shadow-emerald-100 dark:shadow-none shadow-md"
        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
    }`}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{name === "BERT" ? "🧠" : "⚡"}</span>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white">{name}</h3>
            {isActive && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                Active model
              </span>
            )}
          </div>
        </div>
        {!isActive && (
          <button
            onClick={onSetActive}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 hover:bg-emerald-200 text-emerald-700 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 dark:text-emerald-400 transition-colors disabled:opacity-50"
          >
            {busy ? "Setting..." : "Set Active"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl p-4">
        {METRIC_KEYS.map((k) => (
          <MetricBadge key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={data?.[k]} />
        ))}
      </div>
    </div>
  );
}

function CandidateCard({ name, candidateData, retrainStatus, onRetrain, onCancel, onPromote, onDiscard, busy }) {
  const status  = retrainStatus?.status;
  const running = status === "running";
  const done    = status === "complete";
  const failed  = status === "failed";
  const cancelled = status === "cancelled";
  const hasCandidate = !!candidateData;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800 dark:text-slate-200">
          {name} — Retrain
        </h3>
        <div className="flex items-center gap-2">
          {running && (
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-400 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={onRetrain}
            disabled={busy || running}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {running ? "Training..." : "Retrain Model"}
          </button>
        </div>
      </div>

      {/* Progress */}
      {retrainStatus && (
        <div className={`mb-4 p-3 rounded-xl text-sm ${
          done      ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800" :
          failed    ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800" :
          cancelled ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700" :
                      "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
        }`}>
          <div className="flex items-center gap-2">
            {running && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <span className="font-medium">
              {done      ? "Training complete" :
               failed    ? "Training failed" :
               cancelled ? "Cancelled by admin" :
               retrainStatus.progress}
            </span>
          </div>
          {done && retrainStatus.completed_at && (
            <div className="text-xs mt-1 opacity-70">
              Completed: {new Date(retrainStatus.completed_at).toLocaleString()}
            </div>
          )}
          {failed && retrainStatus.error && (
            <div className="text-xs mt-1 opacity-80">{retrainStatus.error}</div>
          )}
        </div>
      )}

      {/* Candidate metrics */}
      {hasCandidate && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
            Candidate Metrics
          </p>
          <div className="grid grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl p-4">
            {METRIC_KEYS.map((k) => (
              <MetricBadge
                key={k}
                label={k.charAt(0).toUpperCase() + k.slice(1)}
                value={candidateData[k]}
              />
            ))}
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={onPromote}
              disabled={busy}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
            >
              {busy ? "Promoting..." : "Promote to Production"}
            </button>
            <button
              onClick={onDiscard}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-400 transition-colors disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {!hasCandidate && !retrainStatus && (
        <p className="text-sm text-slate-400 dark:text-slate-500">
          No candidate — click "Retrain Model" to train a new version.
        </p>
      )}
    </div>
  );
}

export default function AdminModels() {
  const { token }             = useAuth();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [busy, setBusy]       = useState({});
  const pollRef               = useRef(null);

  async function load() {
    try {
      const res = await api.adminModels(token);
      setData(res);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Poll every 5 s while any retrain is running
  useEffect(() => {
    load();
    pollRef.current = setInterval(() => {
      setData((prev) => {
        const anyRunning = prev?.retrain_status &&
          Object.values(prev.retrain_status).some((s) => s.status === "running");
        if (anyRunning) load();
        return prev;
      });
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function action(key, fn, ...args) {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn(token, ...args);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  const activeKey = data?.best_model?.toLowerCase();
  const models    = data?.models ?? {};
  const candidates = data?.candidates ?? {};
  const retrainSt  = data?.retrain_status ?? {};

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Model Management</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Switch active model or retrain and promote a new version
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/admin/drift"
              className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/60 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              Drift Monitor
            </Link>
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
          <div className="text-center py-20 text-slate-400">Loading models...</div>
        ) : (
          <>
            {/* Active model cards */}
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
                Production Models
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {["bert", "distilbert"].map((key) => (
                  <ModelCard
                    key={key}
                    name={key.toUpperCase()}
                    data={models[key]}
                    isActive={activeKey === key}
                    busy={!!busy[`active-${key}`]}
                    onSetActive={() => action(`active-${key}`, api.adminSetActive, key)}
                  />
                ))}
              </div>
            </section>

            {/* Retrain section */}
            <section>
              <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
                Retrain & Promote
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {["bert", "distilbert"].map((key) => (
                  <CandidateCard
                    key={key}
                    name={key.toUpperCase()}
                    candidateData={candidates[key]}
                    retrainStatus={retrainSt[key]}
                    busy={!!busy[`retrain-${key}`]}
                    onRetrain={() => {
                      if (confirm(`Start retraining ${key.toUpperCase()}? This will run in the background and may take 10–60 minutes.`))
                        action(`retrain-${key}`, api.adminRetrain, key);
                    }}
                    onCancel={() => action(`retrain-${key}`, api.adminCancelRetrain, key)}
                    onPromote={() => {
                      if (confirm(`Promote ${key.toUpperCase()} candidate to production? The current production model will be backed up.`))
                        action(`retrain-${key}`, api.adminPromote, key);
                    }}
                    onDiscard={() => {
                      if (confirm(`Discard the ${key.toUpperCase()} candidate?`))
                        action(`retrain-${key}`, api.adminDiscard, key);
                    }}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
                Retraining runs in the background and may take 10–60 minutes depending on hardware. This page auto-refreshes while training.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
