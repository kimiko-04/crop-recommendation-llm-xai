import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

const features = [
  {
    icon: "🤖",
    title: "BERT & DistilBERT Models",
    desc: "State-of-the-art transformer models fine-tuned on soil and climate data for highly accurate crop predictions.",
  },
  {
    icon: "🔍",
    title: "SHAP Explainability",
    desc: "Understand exactly which soil and weather factors drove each recommendation with SHAP feature importance charts.",
  },
  {
    icon: "🌱",
    title: "22 Crop Classes",
    desc: "Covers a wide variety of crops including rice, wheat, maize, fruits, and legumes suitable for diverse climates.",
  },
  {
    icon: "⚡",
    title: "Real-time Predictions",
    desc: "Get instant crop recommendations by entering your field's N, P, K values alongside temperature and rainfall data.",
  },
];

const steps = [
  { num: "01", title: "Create an Account", desc: "Register with your email to access the prediction dashboard." },
  { num: "02", title: "Enter Field Data",  desc: "Input 7 soil and climate parameters — nitrogen, phosphorus, potassium, pH, temperature, humidity, and rainfall." },
  { num: "03", title: "Get Recommendation", desc: "Receive an AI-powered crop recommendation with confidence score and feature contribution analysis." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <Navbar />

      {/* Hero */}
      <section className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-700 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24 text-center">
          <span className="inline-block bg-white/20 text-white text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            Final Year Project — AI Crop Recommendation
          </span>
          <h1 className="text-4xl sm:text-6xl font-bold leading-tight mb-6">
            Smart Crop Recommendation<br />
            <span className="text-emerald-200">Powered by AI</span>
          </h1>
          <p className="text-lg sm:text-xl text-emerald-100 max-w-2xl mx-auto mb-10 leading-relaxed">
            Enter your soil and climate data to instantly receive an AI-driven crop recommendation
            backed by BERT/DistilBERT models and explained with SHAP feature importance.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/register"
              className="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              Get Started Free
            </Link>
            <Link
              to="/login"
              className="border-2 border-white/60 hover:border-white text-white font-semibold px-8 py-3.5 rounded-xl transition-colors text-base"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-slate-50 dark:bg-slate-900 border-y border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { val: "22",   label: "Crop Classes" },
            { val: "2",    label: "AI Models" },
            { val: "7",    label: "Input Features" },
            { val: "99%+", label: "Model Accuracy" },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-3xl font-bold text-emerald-600">{s.val}</div>
              <div className="text-slate-500 dark:text-slate-400 text-sm mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">Why CropAI?</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Built on modern NLP research and deployed with transparency at its core.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-700 transition-all"
            >
              <div className="text-4xl mb-4">{f.icon}</div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{f.title}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 dark:bg-slate-900 border-y border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-3">How It Works</h2>
            <p className="text-slate-500 dark:text-slate-400">Three simple steps to your crop recommendation.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {s.num}
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{s.title}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-3xl p-12 text-white">
          <h2 className="text-3xl font-bold mb-4">Ready to find your ideal crop?</h2>
          <p className="text-emerald-100 mb-8 max-w-lg mx-auto">
            Create a free account and start getting AI-powered recommendations in seconds.
          </p>
          <Link
            to="/register"
            className="inline-block bg-white text-emerald-700 hover:bg-emerald-50 font-semibold px-8 py-3.5 rounded-xl transition-colors"
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-700 text-center py-8 text-slate-400 dark:text-slate-500 text-sm">
        CropAI — Final Year Project &nbsp;·&nbsp; BERT + DistilBERT + SHAP
      </footer>
    </div>
  );
}
