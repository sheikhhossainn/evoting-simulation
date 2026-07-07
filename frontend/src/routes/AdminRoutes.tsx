/**
 * AdminRoutes.tsx
 *
 * Route definitions for the EC Admin portal.
 * These are standalone routes (no Layout wrapper)
 * for a focused administrative experience.
 */

import { Route } from "react-router-dom";
import AdminLogin from "../pages/AdminLogin";
import AdminDashboard from "../pages/AdminDashboard";

export const adminRoutes = (
  <>
    <Route path="/admin/login" element={<AdminLogin />} />
    <Route path="/admin/dashboard" element={<AdminDashboard />} />
  </>
);
