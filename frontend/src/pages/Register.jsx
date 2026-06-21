import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Register() {
  const navigate = useNavigate();

  const [form, setForm]       = useState({ username: "", email: "", password: "", confirm: "" });
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      await api.register(form.username, form.email, form.password);
      setSuccess(true);
      setTimeout(() => navigate("/login"), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const bgStyle = (
    <>
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1600&q=80')",
          filter: "blur(4px) brightness(0.45)",
          transform: "scale(1.05)",
        }}
      />
      <div className="absolute inset-0 bg-black/40" />
    </>
  );

  if (success) {
    return (
      <div className="min-h-screen relative flex items-center justify-center px-4 overflow-hidden">
        {bgStyle}
        <div className="relative text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-white mb-2">Account created!</h2>
          <p className="text-white/70">Redirecting you to login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 overflow-hidden">
      {bgStyle}
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center text-emerald-400 font-bold text-2xl">
            <span>SmartCrop</span>
          </Link>
          <p className="text-white/70 mt-2">Create your free account</p>
        </div>

        <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-2xl shadow-md border border-slate-200 dark:border-slate-700 p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Get started</h1>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 mb-5 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            {[
              { key: "username", label: "Username",        type: "text",     ph: "johndoe"           },
              { key: "email",    label: "Email address",   type: "email",    ph: "you@example.com"   },
              { key: "password", label: "Password",        type: "password", ph: "Min. 6 characters" },
              { key: "confirm",  label: "Confirm password",type: "password", ph: "Repeat your password" },
            ].map(({ key, label, type, ph }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {label}
                </label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={set(key)}
                  required
                  placeholder={ph}
                  className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                />
              </div>
            ))}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <p className="text-center text-slate-500 dark:text-slate-400 text-sm mt-6">
            Already have an account?{" "}
            <Link to="/login" className="text-emerald-600 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center mt-6">
          <Link to="/" className="text-white/50 hover:text-white/80 text-sm transition-colors">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
