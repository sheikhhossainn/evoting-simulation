/**
 * VoterRoutes.tsx
 *
 * Route definitions for the Voter portal.
 * These are standalone routes (no Layout wrapper)
 * for a distraction-free voting experience.
 */

import { Route } from "react-router-dom";
import VoterLogin from "../pages/VoterLogin";
import VotingPage from "../pages/VotingPage";
import VoteConfirmation from "../pages/VoteConfirmation";

export const voterRoutes = (
  <>
    <Route path="/voter/login" element={<VoterLogin />} />
    <Route path="/voter/vote" element={<VotingPage />} />
    <Route path="/voter/confirmation" element={<VoteConfirmation />} />
  </>
);
