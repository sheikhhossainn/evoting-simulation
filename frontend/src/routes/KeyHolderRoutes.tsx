/**
 * keyholderRoutes.tsx
 *
 * Route definitions for the Key Holder portal.
 * Mount this in your top-level Routes (Sheikh / integration phase).
 *
 * Usage in App.tsx:
 *   import { keyholderRoutes } from "./routes/keyholderRoutes";
 *   <Routes>
 *     {keyholderRoutes}
 *   </Routes>
 */

import { Route } from "react-router-dom";
import KeyHolderLogin from "../pages/KeyHolderLogin";
import KeyShareSubmit from "../pages/KeyShareSubmit";
import KeyShareStatus from "../pages/KeyShareStatus";

export const keyholderRoutes = (
  <>
    <Route path="/keyholder" element={<KeyHolderLogin />} />
    <Route path="/keyholder/submit" element={<KeyShareSubmit />} />
    <Route path="/keyholder/status" element={<KeyShareStatus />} />
  </>
);
