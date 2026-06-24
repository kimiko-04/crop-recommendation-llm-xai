import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

const features = [
  {
    title: "BERT & DistilBERT Models",
    desc: "State-of-the-art transformer models fine-tuned on soil and climate data for highly accurate crop predictions.",
  },
  {
    title: "SHAP Explainability",
    desc: "Understand exactly which soil and weather factors drove each recommendation with SHAP feature importance charts.",
  },
  {
    title: "22 Crop Classes",
    desc: "Covers a wide variety of crops including rice, wheat, maize, fruits, and legumes suitable for diverse climates.",
  },
  {
    title: "Real-time Predictions",
    desc: "Get instant crop recommendations by entering your field's N, P, K values alongside temperature and rainfall data.",
  },
];

const steps = [
  { num: "01", title: "Create an Account", desc: "Register with your email to access the prediction dashboard." },
  { num: "02", title: "Enter Field Data",  desc: "Input 7 soil and climate parameters — nitrogen, phosphorus, potassium, pH, temperature, humidity, and rainfall." },
  { num: "03", title: "Get Recommendation", desc: "Receive an AI-powered crop recommendation with confidence score and feature contribution analysis." },
];

const SHOWCASE_CROPS = [
  { name: "rice",        wiki: "Rice",            label: "Rice" },
  { name: "wheat",       wiki: "Wheat",           label: "Wheat" },
  { name: "maize",       wiki: "Maize",           label: "Maize" },
  { name: "apple",       wiki: "Apple",           label: "Apple" },
  { name: "mango",       wiki: "Mango",           label: "Mango" },
  { name: "grapes",      wiki: "Grape",           label: "Grapes" },
  { name: "banana",      wiki: "Banana",          label: "Banana" },
  { name: "watermelon",  wiki: "Watermelon",      label: "Watermelon" },
  { name: "coconut",     wiki: "Coconut",         label: "Coconut" },
  { name: "pomegranate", wiki: "Pomegranate",     label: "Pomegranate" },
  { name: "orange",      wiki: "Orange_(fruit)",  label: "Orange" },
  { name: "coffee",      wiki: "Coffee",          label: "Coffee" },
];

function CropCard({ wiki, label }) {
  const [src, setSrc] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${wiki}`)
      .then((r) => r.json())
      .then((d) => { if (d.thumbnail?.source) setSrc(d.thumbnail.source); })
      .catch(() => {});
  }, [wiki]);

  return (
    <div className="group rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-600 transition-all duration-200 bg-white dark:bg-slate-800">
      <div className="h-28 bg-emerald-50 dark:bg-slate-700 overflow-hidden relative">
        {!loaded && (
          <div className="absolute inset-0 bg-emerald-100 dark:bg-slate-600" />
        )}
        {src && (
          <img
            src={src}
            alt={label}
            onLoad={() => setLoaded(true)}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        )}
      </div>
      <div className="px-3 py-2.5 text-center">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <Navbar />

      {/* Hero */}
      <section className="relative text-white overflow-hidden">
        {/* Background crop field image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('https://plus.unsplash.com/premium_photo-1661811677567-6f14477aa1fa?w=1600&q=80')",
            filter: "blur(4px) brightness(0.55)",
            transform: "scale(1.05)",
          }}
        />
        {/* Dark green tint overlay */}
        <div className="absolute inset-0 bg-emerald-900/50" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
          <span className="inline-block bg-white/15 backdrop-blur-sm border border-white/25 text-white text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            Final Year Project — AI Crop Recommendation
          </span>
          <h1 className="text-4xl sm:text-6xl font-bold leading-tight mb-6 tracking-tight">
            Crop Recommendation System<br />
            <span className="text-emerald-200">Using LLM and XAI</span>
          </h1>
          <p className="text-lg sm:text-xl text-emerald-100 max-w-2xl mx-auto mb-10 leading-relaxed">
            Enter your soil and climate data to instantly receive an AI-driven crop recommendation
            backed by BERT/DistilBERT models and explained with SHAP feature importance.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-14">
            <Link
              to="/register"
              className="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold px-8 py-3.5 rounded-xl transition-all shadow-lg hover:shadow-xl text-base"
            >
              Register Now
            </Link>
            <Link
              to="/login"
              className="bg-white/10 backdrop-blur-sm border border-white/40 hover:bg-white/20 hover:border-white/70 text-white font-semibold px-8 py-3.5 rounded-xl transition-all text-base"
            >
              Sign In
            </Link>
          </div>

          {/* Frosted glass stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto">
            {[
              { val: "22",   label: "Crop Classes" },
              { val: "2",    label: "AI Models" },
              { val: "7",    label: "Input Features" },
              { val: "90%+", label: "Accuracy" },
            ].map((s) => (
              <div key={s.label} className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl py-4 px-2 text-center">
                <div className="text-2xl font-bold tracking-tight">{s.val}</div>
                <div className="text-emerald-200 text-xs mt-0.5 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Crop showcase */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-tight">
            22 Crops Covered
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            From staple grains to tropical fruits — our model recommends across the full spectrum of common crops.
          </p>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {SHOWCASE_CROPS.map((c) => (
            <CropCard key={c.name} wiki={c.wiki} label={c.label} />
          ))}
        </div>
        <p className="text-center text-sm text-slate-400 dark:text-slate-500 mt-5">
          + 10 more including legumes, fibres, and spice crops
        </p>
      </section>

      {/* Features */}
      <section className="bg-slate-50 dark:bg-slate-900 border-y border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-tight">Why SmartCrop?</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm hover:shadow-lg hover:border-emerald-200 dark:hover:border-emerald-700 transition-all duration-200"
              >
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{f.title}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-tight">How It Works</h2>
          <p className="text-slate-500 dark:text-slate-400">Three simple steps to your crop recommendation.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {steps.map((s) => (
            <div key={s.num} className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center text-xl font-bold mx-auto mb-4 shadow-sm">
                {s.num}
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{s.title}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 text-center">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-3xl p-12 text-white shadow-md">
          <h2 className="text-3xl font-bold mb-4 tracking-tight">Ready to find your ideal crop?</h2>
          <p className="text-emerald-100 mb-8 max-w-lg mx-auto">
            Create a free account and start getting AI-powered recommendations in seconds.
          </p>
          <Link
            to="/register"
            className="inline-block bg-white text-emerald-700 hover:bg-emerald-50 font-semibold px-8 py-3.5 rounded-xl transition-all shadow-lg hover:shadow-xl"
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-700 text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
        MIRZA HAQIMI BIN SUZANI &nbsp;·&nbsp; 2023414766 &nbsp;·&nbsp; CSP650 &nbsp;·&nbsp; UiTM
      </footer>
    </div>
  );
}
