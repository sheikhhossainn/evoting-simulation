/**
 * KeyHolderRoutes.tsx
 *
 * Route definitions for the Key Holder portal.
 * These are standalone routes (no Layout wrapper)
 * for a focused key management experience.
 */

import { Route } from "react-router-dom";
import KeyHolderLogin from "../pages/KeyHolderLogin";
import KeyShareSubmit from "../pages/KeyShareSubmit";
import KeyShareStatus from "../pages/KeyShareStatus";

export const keyholderRoutes = (
  <>
    <Route path="/keyholder/login" element={<KeyHolderLogin />} />
    <Route path="/keyholder/submit" element={<KeyShareSubmit />} />
    <Route path="/keyholder/status" element={<KeyShareStatus />} />
  </>
);
