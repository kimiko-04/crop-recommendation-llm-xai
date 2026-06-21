import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AdminRoute({ children }) {
  const { token, user } = useAuth();
  // Redirect to admin login (not home) so the admin can re-authenticate directly.
  if (!token || user?.role !== "admin") return <Navigate to="/admin/login" replace />;
  return children;
}
