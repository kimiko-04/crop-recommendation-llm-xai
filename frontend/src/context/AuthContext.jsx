import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

function decodeToken(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// Returns false if the token is missing, malformed, or past its exp claim.
// This prevents an expired token sitting in localStorage from bypassing
// ProtectedRoute and AdminRoute until the first API call returns a 401.
function isTokenValid(token) {
  if (!token) return false;
  const payload = decodeToken(token);
  if (!payload || !payload.exp) return false;
  return payload.exp * 1000 > Date.now();
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem("token");
    if (!isTokenValid(t)) {
      // Clear stale/expired tokens immediately so routes redirect to login.
      localStorage.removeItem("token");
      return null;
    }
    return t;
  });

  const [user, setUser] = useState(() => {
    const t = localStorage.getItem("token");
    return isTokenValid(t) ? decodeToken(t) : null;
  });

  const saveToken = (t) => {
    localStorage.setItem("token", t);
    setToken(t);
    setUser(decodeToken(t));
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, saveToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
