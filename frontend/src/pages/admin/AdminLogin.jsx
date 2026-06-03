import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";

function decodeToken(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export default function AdminLogin() {
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
      const data    = await api.login(form.email, form.password);
      const decoded = decodeToken(data.access_token);

      if (decoded?.role !== "admin") {
        setError("This account does not have administrator privileges.");
        return;
      }

      saveToken(data.access_token);
      navigate("/admin/users");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-amber-400 font-bold text-2xl">
            <span className="text-3xl">🌾</span>
            <span>CropAI</span>
          </Link>
          <p className="text-slate-400 mt-2 text-sm">Administrator Portal</p>
        </div>

        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 p-8">
          {/* Shield icon + heading */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-xl">
              🛡️
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Admin Sign In</h1>
              <p className="text-slate-400 text-xs">Restricted access — authorised personnel only</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-lg px-4 py-3 mb-5 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Admin email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                required
                placeholder="admin@cropai.com"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={set("password")}
                required
                placeholder="••••••••"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-900 font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? "Signing in…" : "Sign In as Admin"}
            </button>
          </form>

          <p className="text-center text-slate-500 text-sm mt-6">
            Not an admin?{" "}
            <Link to="/login" className="text-amber-400 hover:underline font-medium">
              User login
            </Link>
          </p>
        </div>

        <p className="text-center mt-6">
          <Link
            to="/"
            className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
          >
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
