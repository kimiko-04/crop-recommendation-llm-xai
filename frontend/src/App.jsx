/**
 * App — root router.
 *
 * Two levels of route protection:
 *   ProtectedRoute — redirects to /login if no JWT token is present (any logged-in user)
 *   AdminRoute     — redirects to /admin/login if the JWT role is not "admin"
 *
 * ThemeProvider (dark/light) wraps AuthProvider so theme is available everywhere,
 * including the login page before a token exists.
 */
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute    from "./components/AdminRoute";
import Home          from "./pages/Home";
import Login         from "./pages/Login";
import Register      from "./pages/Register";
import Dashboard     from "./pages/Dashboard";
import Models        from "./pages/Models";
import AdminUsers    from "./pages/admin/AdminUsers";
import AdminModels   from "./pages/admin/AdminModels";
import AdminLogin    from "./pages/admin/AdminLogin";
import AdminDrift    from "./pages/admin/AdminDrift";
import History       from "./pages/History";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/"          element={<Home />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/register"  element={<Register />} />

            {/* User-only routes (any valid JWT) */}
            <Route path="/dashboard" element={
              <ProtectedRoute><Dashboard /></ProtectedRoute>
            } />
            <Route path="/history" element={
              <ProtectedRoute><History /></ProtectedRoute>
            } />
            <Route path="/models" element={
              <ProtectedRoute><Models /></ProtectedRoute>
            } />

            {/* Admin-only routes (JWT with role=admin) */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/users" element={
              <AdminRoute><AdminUsers /></AdminRoute>
            } />
            <Route path="/admin/models" element={
              <AdminRoute><AdminModels /></AdminRoute>
            } />
            <Route path="/admin/drift" element={
              <AdminRoute><AdminDrift /></AdminRoute>
            } />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
