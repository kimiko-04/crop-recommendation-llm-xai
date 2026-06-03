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

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/"          element={<Home />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/register"  element={<Register />} />
            <Route path="/dashboard" element={
              <ProtectedRoute><Dashboard /></ProtectedRoute>
            } />
            <Route path="/models" element={
              <ProtectedRoute><Models /></ProtectedRoute>
            } />
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
