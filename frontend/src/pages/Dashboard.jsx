import { useState, useEffect } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

const FIELDS = [
  { key: "n",           label: "Nitrogen (N)",     icon: "🌿", unit: "mg/kg",  min: 0,   max: 300, step: 1,   def: 50,  hint: "Amount of nitrogen in the soil, essential for leaf and stem growth." },
  { key: "p",           label: "Phosphorus (P)",   icon: "🌸", unit: "mg/kg",  min: 0,   max: 300, step: 1,   def: 50,  hint: "Amount of phosphorus in the soil, which drives root development and flowering." },
  { key: "k",           label: "Potassium (K)",    icon: "🛡️", unit: "mg/kg",  min: 0,   max: 300, step: 1,   def: 50,  hint: "Amount of potassium in the soil, which boosts disease resistance and fruit quality." },
  { key: "ph",          label: "Soil pH",           icon: "⚖️", unit: "",       min: 3.5, max: 9.5, step: 0.1, def: 6.5, hint: "Measure of soil acidity or alkalinity, where most crops thrive between 5.5 and 7.5." },
  { key: "temperature", label: "Temperature",       icon: "🌡️", unit: "°C",     min: 10,  max: 50,  step: 0.5, def: 25,  hint: "Average ambient air temperature of the growing area in degrees Celsius." },
  { key: "humidity",    label: "Humidity",          icon: "💧", unit: "%",      min: 10,  max: 100, step: 1,   def: 60,  hint: "Relative moisture level in the air, expressed as a percentage." },
  { key: "rainfall",    label: "Rainfall",          icon: "🌧️", unit: "mm",     min: 20,  max: 500, step: 5,   def: 100, hint: "Average annual rainfall the field receives, measured in millimetres." },
];

const FIELD_META = {
  N:           { label: "Nitrogen",     unit: "mg/kg", key: "n"           },
  P:           { label: "Phosphorus",   unit: "mg/kg", key: "p"           },
  K:           { label: "Potassium",    unit: "mg/kg", key: "k"           },
  pH:          { label: "Soil pH",      unit: "",      key: "ph"          },
  Temperature: { label: "Temperature",  unit: "°C",    key: "temperature" },
  Humidity:    { label: "Humidity",     unit: "%",     key: "humidity"    },
  Rainfall:    { label: "Rainfall",     unit: "mm",    key: "rainfall"    },
};

const CROP_EMOJI = {
  rice: "🌾", wheat: "🌾", maize: "🌽", apple: "🍎", banana: "🍌",
  mango: "🥭", grapes: "🍇", watermelon: "🍉", orange: "🍊", papaya: "🧡",
  coconut: "🥥", cotton: "🌿", coffee: "☕", jute: "🌿",
  default: "🌱",
};

// Maps dataset crop names → Wikipedia article titles for image lookup
const CROP_WIKI = {
  rice:        "Rice",
  wheat:       "Wheat",
  maize:       "Maize",
  apple:       "Apple",
  banana:      "Banana",
  mango:       "Mango",
  grapes:      "Grape",
  watermelon:  "Watermelon",
  orange:      "Orange_(fruit)",
  papaya:      "Papaya",
  coconut:     "Coconut",
  cotton:      "Cotton",
  coffee:      "Coffee",
  jute:        "Jute",
  chickpea:    "Chickpea",
  kidneybeans: "Kidney_bean",
  pigeonpeas:  "Pigeon_pea",
  mothbeans:   "Moth_bean",
  mungbean:    "Mung_bean",
  blackgram:   "Vigna_mungo",
  lentil:      "Lentil",
  pomegranate: "Pomegranate",
};

function cropEmoji(name = "") {
  return CROP_EMOJI[name.toLowerCase()] || CROP_EMOJI.default;
}

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
      src={src}
      alt={name}
      className={className}
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  );
}

function ShapChart({ shap, values }) {
  const entries = Object.entries(shap.values).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  );
  const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 0.0001);
  const allNearZero = entries.every(([, v]) => Math.abs(v) < 0.001);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
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
                  <div
                    className="absolute left-1/2 top-1.5 bottom-1.5 rounded-r-sm bg-emerald-400 dark:bg-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                ) : (
                  <div
                    className="absolute top-1.5 bottom-1.5 rounded-l-sm bg-red-400 dark:bg-red-500"
                    style={{ right: "50%", width: `${pct}%` }}
                  />
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

export default function Dashboard() {
  const { token, user } = useAuth();

  const initValues = Object.fromEntries(FIELDS.map((f) => [f.key, f.def]));
  const [values, setValues]               = useState(initValues);
  const [result, setResult]               = useState(null);
  const [reasoning, setReasoning]         = useState(null);
  const [shap, setShap]                   = useState(null);
  const [shapLoading, setShapLoading]     = useState(false);
  const [error, setError]                 = useState("");
  const [loading, setLoading]             = useState(false);

  const onChange = (key, val) =>
    setValues((v) => ({ ...v, [key]: parseFloat(val) }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setReasoning(null);
    setShap(null);
    setLoading(true);
    try {
      const data = await api.predict(token, values);
      if (data.error) throw new Error(data.error);
      setResult(data);
      setLoading(false);

      // Fetch reasoning and SHAP in parallel — reasoning is fast (~200ms)
      const [reasonData, shapData] = await Promise.allSettled([
        api.reason(token, values),
        api.explain(token, values),
      ]);
      if (reasonData.status === "fulfilled") setReasoning(reasonData.value);

      setShapLoading(true);
      if (shapData.status === "fulfilled") setShap(shapData.value);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    } finally {
      setShapLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Crop Recommendation</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Hi {user?.username || "there"} — enter your field parameters below.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Input form */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-5 text-lg">Field Parameters</h2>

            <form onSubmit={submit} className="space-y-5">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <div className="flex justify-between items-center mb-0.5">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <span className="text-base leading-none">{f.icon}</span>
                      {f.label}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={values[f.key]}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v >= f.min && v <= f.max)
                            onChange(f.key, e.target.value);
                        }}
                        className="w-20 text-right text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums bg-transparent border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
                      />
                      {f.unit && (
                        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{f.unit}</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5 leading-snug">{f.hint}</p>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={values[f.key]}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-full appearance-none cursor-pointer accent-emerald-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-1">
                    <span>{f.min}{f.unit}</span>
                    <span>{f.max}{f.unit}</span>
                  </div>
                </div>
              ))}

              {error && (
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors mt-2"
              >
                {loading ? "Analysing…" : "Recommend Crop"}
              </button>
            </form>
          </div>

          {/* Results */}
          <div className="flex flex-col gap-5">
            {!result && !loading && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 flex flex-col items-center justify-center text-center flex-1 min-h-64">
                <div className="text-5xl mb-4">🌿</div>
                <p className="text-slate-500 dark:text-slate-400">
                  Set your field parameters and click <br />
                  <strong className="text-slate-700 dark:text-slate-200">Recommend Crop</strong> to see results.
                </p>
              </div>
            )}

            {loading && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 flex flex-col items-center justify-center text-center flex-1 min-h-64">
                <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-slate-500 dark:text-slate-400">Running model inference…</p>
              </div>
            )}

            {result && (
              <>
                {/* Top prediction */}
                <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl overflow-hidden text-white">
                  {/* Crop image banner — loaded from Wikipedia */}
                  <div className="relative h-44 overflow-hidden bg-emerald-700/40">
                    <CropImage
                      name={result.recommended_crop}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-emerald-700/80 to-transparent" />
                  </div>

                  <div className="p-6">
                    <div className="text-sm font-medium text-emerald-200 mb-2">Recommended Crop</div>
                    <div className="flex items-center gap-3">
                      <span className="text-5xl">{cropEmoji(result.recommended_crop)}</span>
                      <div>
                        <div className="text-3xl font-bold capitalize">{result.recommended_crop}</div>
                        <div className="text-emerald-200 text-sm mt-0.5">
                          {result.confidence}% confidence · {result.model_used}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white rounded-full transition-all duration-700"
                          style={{ width: `${Math.min(result.confidence, 100)}%` }}
                        />
                      </div>
                    </div>

                    {reasoning && (
                      <div className="mt-4 pt-4 border-t border-white/20">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium">
                            BERT reasoning
                          </span>
                        </div>
                        <p className="text-sm text-emerald-100 leading-relaxed">
                          {reasoning.reasoning}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Top 5 */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">Top 5 Predictions</h3>
                  <div className="space-y-3">
                    {result.top5.map((item, i) => (
                      <div key={item.crop} className="flex items-center gap-3">
                        <span className="text-slate-400 dark:text-slate-500 text-sm w-5 text-right">{i + 1}</span>
                        <span className="text-lg">{cropEmoji(item.crop)}</span>
                        <span className="capitalize text-slate-700 dark:text-slate-300 font-medium flex-1">
                          {item.crop}
                        </span>
                        <div className="flex items-center gap-2 w-40">
                          <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.min(item.probability, 100)}%` }}
                            />
                          </div>
                          <span className="text-slate-500 dark:text-slate-400 text-sm tabular-nums w-12 text-right">
                            {item.probability}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SHAP explanation */}
                {shapLoading && (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Computing SHAP explanation…</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Analysing feature contributions</p>
                    </div>
                  </div>
                )}

                {shap && <ShapChart shap={shap} values={values} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
