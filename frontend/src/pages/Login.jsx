import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { saveToken } = useAuth();
  const navigate       = useNavigate();

  const [form, setForm]       = useState({ email: "", password: "" });
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.login(form.email, form.password);
      saveToken(data.access_token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1600&q=80')",
          filter: "blur(4px) brightness(0.45)",
          transform: "scale(1.05)",
        }}
      />
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center text-emerald-400 font-bold text-2xl">
            <span>SmartCrop</span>
          </Link>
          <p className="text-white/70 mt-2">Sign in to your account</p>
        </div>

        <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-2xl shadow-md border border-slate-200 dark:border-slate-700 p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Welcome back</h1>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 mb-5 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                required
                placeholder="you@example.com"
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={set("password")}
                required
                placeholder="••••••••"
                className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="text-center text-slate-500 dark:text-slate-400 text-sm mt-6">
            Don't have an account?{" "}
            <Link to="/register" className="text-emerald-600 hover:underline font-medium">
              Create one
            </Link>
          </p>
        </div>

        <p className="text-center mt-4 text-white/60 text-sm">
          Administrator?{" "}
          <Link to="/admin/login" className="text-amber-400 hover:underline font-medium">
            Sign in here
          </Link>
        </p>

        <p className="text-center mt-3">
          <Link to="/" className="text-white/50 hover:text-white/80 text-sm transition-colors">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

