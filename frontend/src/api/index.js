const BASE = "http://localhost:8000";

async function request(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...extraHeaders },
    ...rest,
  });
  const data = await res.json();
  if (!res.ok) {
    const detail = data.detail;
    const msg = Array.isArray(detail)
      ? detail.map((e) => e.msg).join(", ")
      : detail || "Request failed";
    throw new Error(msg);
  }
  return data;
}

export const api = {
  register: (username, email, password) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),

  login: (email, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  predict: (token, fields) =>
    request("/predict", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(fields),
    }),

  explain: (token, fields) =>
    request("/predict/explain", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(fields),
    }),

  reason: (token, fields) =>
    request("/predict/reason", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(fields),
    }),

  // ── Admin ──────────────────────────────────────────────────────────────────
  adminUsers: (token) =>
    request("/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminToggleUser: (token, email) =>
    request(`/admin/users/${encodeURIComponent(email)}/status`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminDeleteUser: (token, email) =>
    request(`/admin/users/${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminModels: (token) =>
    request("/admin/models", {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminSetActive: (token, key) =>
    request("/admin/models/active", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ key }),
    }),

  adminRetrain: (token, key) =>
    request(`/admin/models/retrain/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminCancelRetrain: (token, key) =>
    request(`/admin/models/retrain/${key}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminRetrainStatus: (token) =>
    request("/admin/models/retrain/status", {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminPromote: (token, key) =>
    request(`/admin/models/promote/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminDiscard: (token, key) =>
    request(`/admin/models/candidate/${key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminAnalytics: (token) =>
    request("/admin/analytics", {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminDrift: (token) =>
    request("/admin/drift", {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminClearUserHistory: (token, email) =>
    request(`/admin/predictions/${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminClearAllHistory: (token) =>
    request("/admin/predictions", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
};
