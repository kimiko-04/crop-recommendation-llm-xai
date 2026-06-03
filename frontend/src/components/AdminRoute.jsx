import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AdminRoute({ children }) {
  const { token, user } = useAuth();
  if (!token || user?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
