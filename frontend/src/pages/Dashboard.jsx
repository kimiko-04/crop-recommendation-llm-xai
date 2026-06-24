import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

const FIELDS = [
  { key: "n",           label: "Nitrogen (N)",   unit: "mg/kg", min: 0,   max: 300, step: 1,   def: 50,  hint: "Amount of nitrogen in the soil, essential for leaf and stem growth." },
  { key: "p",           label: "Phosphorus (P)", unit: "mg/kg", min: 0,   max: 300, step: 1,   def: 50,  hint: "Amount of phosphorus in the soil, which drives root development and flowering." },
  { key: "k",           label: "Potassium (K)",  unit: "mg/kg", min: 0,   max: 300, step: 1,   def: 50,  hint: "Amount of potassium in the soil, which boosts disease resistance and fruit quality." },
  { key: "ph",          label: "Soil pH",         unit: "",      min: 3.5, max: 9.5, step: 0.1, def: 6.5, hint: "Measure of soil acidity or alkalinity, where most crops thrive between 5.5 and 7.5." },
  { key: "temperature", label: "Temperature",     unit: "°C",    min: 10,  max: 50,  step: 0.5, def: 25,  hint: "Average ambient air temperature of the growing area in degrees Celsius." },
  { key: "humidity",    label: "Humidity",        unit: "%",     min: 10,  max: 100, step: 1,   def: 60,  hint: "Relative moisture level in the air, expressed as a percentage." },
  { key: "rainfall",    label: "Rainfall",        unit: "mm",    min: 20,  max: 500, step: 5,   def: 100, hint: "Average annual rainfall the field receives, measured in millimetres." },
];

const FIELD_META = {
  N:           { label: "Nitrogen",    unit: "mg/kg", key: "n"           },
  P:           { label: "Phosphorus",  unit: "mg/kg", key: "p"           },
  K:           { label: "Potassium",   unit: "mg/kg", key: "k"           },
  pH:          { label: "Soil pH",     unit: "",      key: "ph"          },
  Temperature: { label: "Temperature", unit: "°C",    key: "temperature" },
  Humidity:    { label: "Humidity",    unit: "%",     key: "humidity"    },
  Rainfall:    { label: "Rainfall",    unit: "mm",    key: "rainfall"    },
};

const CROP_WIKI = {
  rice: "Rice", wheat: "Wheat", maize: "Maize", apple: "Apple",
  banana: "Banana", mango: "Mango", grapes: "Grape", watermelon: "Watermelon",
  orange: "Orange_(fruit)", papaya: "Papaya", coconut: "Coconut",
  cotton: "Cotton", coffee: "Coffee", jute: "Jute", chickpea: "Chickpea",
  kidneybeans: "Kidney_bean", pigeonpeas: "Pigeon_pea", mothbeans: "Moth_bean",
  mungbean: "Mung_bean", blackgram: "Vigna_mungo", lentil: "Lentil",
  pomegranate: "Pomegranate",
};

function CropImage({ name, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    const title = CROP_WIKI[name.toLowerCase()];
    if (!title) return;
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`)
      .then((r) => r.json())
      .then((d) => { if (d.thumbnail?.source) setSrc(d.thumbnail.source); })
      .catch(() => {});
  }, [name]);
  if (!src) return null;
  return (
    <img
      src={src} alt={name} className={className}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  );
}

// SHAP bar chart: positive (green) = feature pushes model TOWARD this crop,
// negative (red) = feature pushes model AWAY from this crop.
// Bars are scaled relative to the largest absolute SHAP value so all 7 bars fit.
function ShapChart({ shap, values }) {
  const entries = Object.entries(shap.values).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  );
  const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 0.0001);
  // Guard: if all values are near zero the user's inputs are close to the dataset mean
  // (the SHAP baseline), so no single feature stands out — show a hint instead.
  const allNearZero = entries.every(([, v]) => Math.abs(v) < 0.001);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Why this crop?</h3>
        <span className="text-xs bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium">
          SHAP
        </span>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">
        Feature contributions toward{" "}
        <span className="capitalize font-medium text-slate-600 dark:text-slate-300">{shap.crop}</span>
        {" · "}baseline {(shap.base_value * 100).toFixed(1)}%
      </p>

      {allNearZero && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700 dark:text-amber-400">
          Your field values are very close to the dataset average, so no single feature stands out.
          Try adjusting your parameters to see which features matter most.
        </div>
      )}

      <div className="space-y-3">
        {entries.map(([name, val]) => {
          const pct   = (Math.abs(val) / maxAbs) * 42;
          const isPos = val >= 0;
          const meta  = FIELD_META[name] || {};
          const raw   = meta.key ? values[meta.key] : "—";
          const unit  = meta.unit || "";
          return (
            <div key={name} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-right">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">{meta.label || name}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{raw}{unit}</div>
              </div>
              <div className="flex-1 relative h-6 flex items-center">
                <div className="absolute left-1/2 top-1 bottom-1 w-px bg-slate-200 dark:bg-slate-600" />
                {isPos ? (
                  <div className="absolute left-1/2 top-1.5 bottom-1.5 rounded-r-sm bg-emerald-400 dark:bg-emerald-500" style={{ width: `${pct}%` }} />
                ) : (
                  <div className="absolute top-1.5 bottom-1.5 rounded-l-sm bg-red-400 dark:bg-red-500" style={{ right: "50%", width: `${pct}%` }} />
                )}
              </div>
              <div className={`w-14 shrink-0 text-xs font-mono font-semibold tabular-nums ${isPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                {isPos ? "+" : ""}{(val * 100).toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-5 mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-emerald-400 dark:bg-emerald-500" />
          <span className="text-xs text-slate-400 dark:text-slate-500">Pushes toward crop</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-400 dark:bg-red-500" />
          <span className="text-xs text-slate-400 dark:text-slate-500">Pushes away</span>
        </div>
      </div>
    </div>
  );
}

// ── Off-screen PDF report panel ───────────────────────────────────────────────
// This component is rendered off-screen (left: -9999px) at all times.
// When the user clicks "Download Report", html2canvas screenshots this element
// and jsPDF converts the canvas to a PDF.  Using a real DOM element instead of
// drawing on a canvas directly gives us the full CSS layout for free.
// It is always light-mode (inline hex styles) so the PDF looks consistent
// regardless of the user's dark/light preference.
function ReportPanel({ result, values, reasoning, shap }) {
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const inputs = [
    { label: "Nitrogen (N)",   value: values.n,           unit: "mg/kg" },
    { label: "Phosphorus (P)", value: values.p,           unit: "mg/kg" },
    { label: "Potassium (K)",  value: values.k,           unit: "mg/kg" },
    { label: "Soil pH",        value: values.ph,          unit: ""      },
    { label: "Temperature",    value: values.temperature, unit: "°C"    },
    { label: "Humidity",       value: values.humidity,    unit: "%"     },
    { label: "Rainfall",       value: values.rainfall,    unit: "mm"    },
  ];

  const shapEntries = shap
    ? Object.entries(shap.values).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    : [];
  const shapMax = shapEntries.length
    ? Math.max(...shapEntries.map(([, v]) => Math.abs(v)), 0.0001)
    : 0.0001;

  const s = (obj) => Object.assign({}, obj);

  return (
    <div
      id="pdf-report"
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
          <div>{date}</div>
          <div style={{ marginTop: "2px" }}>Model: {result.model_used}</div>
        </div>
      </div>

      {/* Recommendation */}
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "18px", marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", fontWeight: "700", color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
          Recommended Crop
        </div>
        <div style={{ fontSize: "26px", fontWeight: "700", color: "#064e3b", textTransform: "capitalize", marginBottom: "8px" }}>
          {result.recommended_crop}
        </div>
        <div style={{ fontSize: "13px", color: "#166534", marginBottom: "8px" }}>
          Confidence: <strong>{result.confidence}%</strong>
        </div>
        <div style={{ height: "8px", background: "#d1fae5", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(result.confidence, 100)}%`, background: "#059669", borderRadius: "4px" }} />
        </div>
      </div>

      {/* Field parameters */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
          Field Parameters
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          {inputs.map(({ label, value, unit }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <span style={{ color: "#64748b", fontSize: "13px" }}>{label}</span>
              <span style={{ fontWeight: "600", color: "#1e293b", fontSize: "13px" }}>{value}{unit}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top 5 */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "11px", fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
          Top 5 Predictions
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {result.top5.map((item, i) => (
            <div key={item.crop} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ width: "16px", color: "#94a3b8", fontSize: "12px", textAlign: "right" }}>{i + 1}</span>
              <span style={{ width: "110px", fontSize: "13px", color: "#1e293b", textTransform: "capitalize", fontWeight: i === 0 ? "600" : "400" }}>
                {item.crop}
              </span>
              <div style={{ flex: 1, height: "8px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(item.probability, 100)}%`, background: i === 0 ? "#059669" : "#34d399", borderRadius: "4px" }} />
              </div>
              <span style={{ width: "44px", textAlign: "right", fontSize: "12px", color: "#64748b" }}>{item.probability}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* BERT reasoning */}
      {reasoning && (
        <div style={{ marginBottom: "20px", padding: "14px 16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "11px", fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            AI Reasoning (BERT Attention)
          </div>
          <p style={{ fontSize: "13px", color: "#475569", lineHeight: "1.65", margin: 0 }}>
            {reasoning.reasoning}
          </p>
        </div>
      )}

      {/* SHAP */}
      {shap && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", fontWeight: "700", color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
            SHAP Feature Importance
          </div>
          <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "10px" }}>
            Contributions toward {shap.crop} · baseline {(shap.base_value * 100).toFixed(1)}%
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {shapEntries.map(([name, val]) => {
              const isPos = val >= 0;
              const barW = (Math.abs(val) / shapMax) * 38;
              return (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "88px", fontSize: "12px", color: "#374151", textAlign: "right" }}>
                    {FIELD_META[name]?.label || name}
                  </span>
                  <div style={{ flex: 1, position: "relative", height: "16px", display: "flex", alignItems: "center" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "1px", background: "#e2e8f0" }} />
                    {isPos
                      ? <div style={{ position: "absolute", left: "50%", top: "3px", bottom: "3px", width: `${barW}%`, background: "#34d399", borderRadius: "0 2px 2px 0" }} />
                      : <div style={{ position: "absolute", right: "50%", top: "3px", bottom: "3px", width: `${barW}%`, background: "#f87171", borderRadius: "2px 0 0 2px" }} />
                    }
                  </div>
                  <span style={{ width: "48px", fontSize: "11px", fontFamily: "monospace", fontWeight: "600", color: isPos ? "#059669" : "#dc2626", textAlign: "right" }}>
                    {isPos ? "+" : ""}{(val * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
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

export default function Dashboard() {
  const { token, user } = useAuth();
  const location = useLocation();

  const initValues = location.state?.values
    ?? Object.fromEntries(FIELDS.map((f) => [f.key, f.def]));

  const [values, setValues]           = useState(initValues);
  const [rawInputs, setRawInputs]     = useState(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(initValues[f.key])]))
  );
  const [result, setResult]           = useState(null);
  const [reasoning, setReasoning]     = useState(null);
  const [shap, setShap]               = useState(null);
  const [shapLoading, setShapLoading] = useState(false);
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [activeModel, setActiveModel] = useState(null);

  useEffect(() => {
    fetch("http://localhost:8000/models/info")
      .then((r) => r.json())
      .then((d) => {
        const info = d.models?.[d.active];
        if (info) setActiveModel(info);
      })
      .catch(() => {});
  }, []);

  const onNumberChange = (key, raw) => {
    setRawInputs((r) => ({ ...r, [key]: raw }));
    const num = parseFloat(raw);
    if (!isNaN(num)) setValues((v) => ({ ...v, [key]: num }));
  };

  const onNumberBlur = (field) => {
    const num = parseFloat(rawInputs[field.key]);
    const clamped = isNaN(num)
      ? field.def
      : Math.min(field.max, Math.max(field.min, num));
    setValues((v) => ({ ...v, [field.key]: clamped }));
    setRawInputs((r) => ({ ...r, [field.key]: String(clamped) }));
  };

  const onSliderChange = (key, raw) => {
    const num = parseFloat(raw);
    setValues((v) => ({ ...v, [key]: num }));
    setRawInputs((r) => ({ ...r, [key]: String(num) }));
  };

  const reset = () => {
    const defs = Object.fromEntries(FIELDS.map((f) => [f.key, f.def]));
    setValues(defs);
    setRawInputs(Object.fromEntries(FIELDS.map((f) => [f.key, String(f.def)])));
    setResult(null);
    setReasoning(null);
    setShap(null);
    setError("");
  };

  const downloadPDF = async () => {
    if (!result || downloading) return;
    setDownloading(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const el = document.getElementById("pdf-report");
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const pdf     = new jsPDF("p", "mm", "a4");
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const margin  = 10;
      const imgW    = pageW - margin * 2;
      const imgH    = (canvas.height * imgW) / canvas.width;
      const imgData = canvas.toDataURL("image/png");
      // Shift by exactly pageH per page so each page shows a clean, non-overlapping
      // slice of the canvas image. The report HTML already has internal padding so
      // anchoring at y=0 with left/right margins produces the correct visual result.
      const pages = Math.ceil(imgH / pageH);
      for (let i = 0; i < pages; i++) {
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", margin, -i * pageH, imgW, imgH);
      }
      const date = new Date().toISOString().split("T")[0];
      pdf.save(`cropai-${result.recommended_crop}-${date}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setReasoning(null);
    setShap(null);
    setLoading(true);
    try {
      // Step 1 — fast prediction (~100 ms): show the crop recommendation immediately.
      const data = await api.predict(token, values);
      if (data.error) throw new Error(data.error);
      setResult(data);
      setLoading(false);

      // Step 2 — fire BERT reasoning and SHAP in parallel.
      // Promise.allSettled (not Promise.all) means one failure doesn't cancel the other.
      // SHAP can take ~30 s so this keeps the UI from feeling frozen.
      setShapLoading(true);
      const [reasonData, shapData] = await Promise.allSettled([
        api.reason(token, values),
        api.explain(token, values),
      ]);
      if (reasonData.status === "fulfilled") setReasoning(reasonData.value);
      if (shapData.status === "fulfilled") setShap(shapData.value);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    } finally {
      setShapLoading(false);
    }
  };

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

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7">
        {/* Page header */}
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Crop Recommendation</h1>
            <p className="text-white/60 mt-0.5 text-sm">
              Hi {user?.username || "there"} — adjust the parameters below and hit <strong className="text-white/90">Recommend Crop</strong>.
            </p>
          </div>
          {activeModel && (
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-4 py-2.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <div className="text-right">
                <p className="text-white text-sm font-semibold">{activeModel.name} v{activeModel.version}</p>
                <p className="text-white/50 text-xs">Active Model{activeModel.accuracy ? ` · ${activeModel.accuracy}% acc` : ""}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── RESULTS (top) ───────────────────────────────────────── */}
        <div className="mb-5">
          {/* Empty state */}
          {!result && !loading && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm px-8 py-10 flex flex-col items-center justify-center text-center">
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                Set your field parameters and click{" "}
                <strong className="text-slate-700 dark:text-slate-200">Recommend Crop</strong> to see results.
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm px-8 py-10 flex flex-col items-center justify-center text-center">
              <div className="w-9 h-9 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">Running model inference…</p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-5">
              {/* Download button row */}
              <div className="flex justify-end">
                <button
                  onClick={downloadPDF}
                  disabled={downloading}
                  className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-400 dark:hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 text-slate-600 dark:text-slate-300 text-sm font-medium px-4 py-2 rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  {downloading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      Generating PDF…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11" />
                      </svg>
                      Download Report
                    </>
                  )}
                </button>
              </div>

              {/* Off-screen report panel captured by html2canvas */}
              <ReportPanel result={result} values={values} reasoning={reasoning} shap={shap} />

              {/* Prediction card + Top 5 side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Prediction gradient card */}
                <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl overflow-hidden text-white shadow-md">
                  <div className="relative h-32 overflow-hidden bg-emerald-700/40">
                    <CropImage name={result.recommended_crop} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-emerald-700/80 to-transparent" />
                  </div>
                  <div className="p-5">
                    <div className="text-xs font-medium text-emerald-200 mb-2 uppercase tracking-wide">Recommended Crop</div>
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="text-2xl font-bold capitalize tracking-tight">{result.recommended_crop}</div>
                        <div className="text-emerald-200 text-sm mt-0.5">
                          {result.confidence}% confidence · {result.model_used}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(result.confidence, 100)}%` }}
                      />
                    </div>
                    {reasoning && (
                      <div className="mt-4 pt-4 border-t border-white/20">
                        <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium">
                          BERT/DISTILBERT reasoning
                        </span>
                        <p className="text-sm text-emerald-100 leading-relaxed mt-2">{reasoning.reasoning}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Top 5 */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">Top 5 Predictions</h3>
                  <div className="space-y-3">
                    {result.top5.map((item, i) => (
                      <div key={item.crop} className="flex items-center gap-3">
                        <span className="text-slate-400 dark:text-slate-500 text-sm w-5 text-right">{i + 1}</span>
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-emerald-50 dark:bg-slate-700 shrink-0">
                          <CropImage name={item.crop} className="w-full h-full object-cover" />
                        </div>
                        <span className="capitalize text-slate-700 dark:text-slate-300 font-medium flex-1">{item.crop}</span>
                        <div className="flex items-center gap-2 w-40">
                          <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(item.probability, 100)}%` }} />
                          </div>
                          <span className="text-slate-500 dark:text-slate-400 text-sm tabular-nums w-12 text-right">
                            {item.probability}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* SHAP — full width */}
              {shapLoading && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Computing SHAP explanation…</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Analysing feature contributions (may take ~30 s)</p>
                  </div>
                </div>
              )}
              {shap && <ShapChart shap={shap} values={values} />}
            </div>
          )}
        </div>

        {/* ── INPUT FORM (bottom) ──────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">Field Parameters</h2>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2 transition-colors"
            >
              Reset to defaults
            </button>
          </div>

          <form onSubmit={submit}>
            {/* 7 compact columns on xl, 4 on md, 2 on mobile */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-x-4 gap-y-4 mb-4">
              {FIELDS.map((f) => (
                <div key={f.key} title={f.hint} className="flex flex-col min-w-0">
                  <label
                    htmlFor={`input-${f.key}`}
                    className="text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1 mb-1.5 truncate"
                  >
                    <span className="truncate">{f.label}</span>
                  </label>

                  <div className="flex items-center gap-1 mb-1.5">
                    <input
                      id={`input-${f.key}`}
                      type="number"
                      inputMode="decimal"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={rawInputs[f.key]}
                      onChange={(e) => onNumberChange(f.key, e.target.value)}
                      onBlur={() => onNumberBlur(f)}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-0 text-center text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-200 dark:border-emerald-700 rounded-lg px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 focus:border-emerald-500 transition-colors"
                    />
                    {f.unit && (
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{f.unit}</span>
                    )}
                  </div>

                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={isNaN(values[f.key]) ? f.def : values[f.key]}
                    onChange={(e) => onSliderChange(f.key, e.target.value)}
                    className="w-full h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-emerald-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    <span>{f.min}</span>
                    <span>{f.max}</span>
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm mb-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors"
            >
              {loading ? "Analysing…" : "Recommend Crop"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
