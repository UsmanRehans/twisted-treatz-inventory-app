import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import FloorApp from "./pages/FloorApp";
import Admin from "./pages/Admin";
import AdminLogin from "./pages/AdminLogin";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Receive from "./pages/Receive";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/app" element={<FloorApp />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/forgot-password" element={<ForgotPassword />} />
        <Route path="/admin/reset-password" element={<ResetPassword />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/receive" element={<Receive />} />
      </Routes>
    </BrowserRouter>
  );
}
