import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api";

export default function AdminUsers() {
  const { token } = useAuth();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [busy, setBusy]       = useState({});
  const [clearingAll, setClearingAll] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const data = await api.adminUsers(token);
      setUsers(data.users);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleStatus(email) {
    setBusy((b) => ({ ...b, [email]: true }));
    try {
      const res = await api.adminToggleUser(token, email);
      setUsers((u) =>
        u.map((user) =>
          user.email === email ? { ...user, is_active: res.is_active } : user
        )
      );
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy((b) => ({ ...b, [email]: false }));
    }
  }

  async function deleteUser(email) {
    if (!confirm(`Delete user ${email} and all their predictions?`)) return;
    setBusy((b) => ({ ...b, [email]: true }));
    try {
      await api.adminDeleteUser(token, email);
      setUsers((u) => u.filter((user) => user.email !== email));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy((b) => ({ ...b, [email]: false }));
    }
  }

  async function clearUserHistory(email) {
    if (!confirm(`Clear all recommendation history for ${email}? This cannot be undone.`)) return;
    setBusy((b) => ({ ...b, [`hist_${email}`]: true }));
    try {
      const res = await api.adminClearUserHistory(token, email);
      setUsers((u) =>
        u.map((user) =>
          user.email === email
            ? { ...user, prediction_count: 0, last_prediction: null }
            : user
        )
      );
      alert(res.message);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy((b) => ({ ...b, [`hist_${email}`]: false }));
    }
  }

  async function clearAllHistory() {
    if (!confirm("Clear ALL recommendation history for every user? This cannot be undone.")) return;
    setClearingAll(true);
    try {
      const res = await api.adminClearAllHistory(token);
      setUsers((u) => u.map((user) => ({ ...user, prediction_count: 0, last_prediction: null })));
      alert(res.message);
    } catch (e) {
      alert(e.message);
    } finally {
      setClearingAll(false);
    }
  }

  const totalPredictions = users.reduce((sum, u) => sum + (u.prediction_count ?? 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">User Management</h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              {users.length} user{users.length !== 1 ? "s" : ""} · {totalPredictions} total predictions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearAllHistory}
              disabled={clearingAll || totalPredictions === 0}
              className="px-4 py-2 rounded-lg font-medium text-sm bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-400 transition-colors disabled:opacity-40"
            >
              {clearingAll ? "Clearing..." : "Clear All History"}
            </button>
            <Link
              to="/admin/drift"
              className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/60 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              Drift Monitor
            </Link>
            <Link
              to="/admin/models"
              className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/60 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              Model Management
            </Link>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading users...</div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    {["Username", "Email", "Role", "Status", "Predictions", "Last Active", "Joined", "Actions"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((u) => (
                    <tr key={u.email} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {u.username}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          u.is_active
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                        }`}>
                          {u.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-center">
                        {u.prediction_count ?? 0}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-500 whitespace-nowrap text-xs">
                        {u.last_prediction
                          ? new Date(u.last_prediction).toLocaleString()
                          : "Never"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-500 whitespace-nowrap text-xs">
                        {u.joined_at ? new Date(u.joined_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {u.role !== "admin" && (
                            <>
                              <button
                                onClick={() => toggleStatus(u.email)}
                                disabled={busy[u.email]}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                                  u.is_active
                                    ? "bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 dark:text-amber-400"
                                    : "bg-emerald-100 hover:bg-emerald-200 text-emerald-700 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 dark:text-emerald-400"
                                }`}
                              >
                                {busy[u.email] ? "..." : u.is_active ? "Disable" : "Enable"}
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => clearUserHistory(u.email)}
                            disabled={busy[`hist_${u.email}`] || (u.prediction_count ?? 0) === 0}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40"
                          >
                            {busy[`hist_${u.email}`] ? "..." : "Clear History"}
                          </button>
                          {u.role !== "admin" && (
                            <button
                              onClick={() => deleteUser(u.email)}
                              disabled={busy[u.email]}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-400 transition-colors disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
