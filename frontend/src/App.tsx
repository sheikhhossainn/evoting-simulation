import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";

// ── Public pages (with Navbar via Layout) ──
import LandingPage from "./pages/LandingPage";
import HowToVote from "./pages/HowToVote";
import About from "./pages/About";

// ── Standalone portal pages (no Navbar — focused experience) ──
import VoterLogin from "./pages/VoterLogin";
import VotingPage from "./pages/VotingPage";
import VoteConfirmation from "./pages/VoteConfirmation";
import KeyHolderLogin from "./pages/KeyHolderLogin";
import KeyShareSubmit from "./pages/KeyShareSubmit";
import KeyShareStatus from "./pages/KeyShareStatus";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public pages with shared Navbar ── */}
        <Route element={<Layout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/how-to-vote" element={<HowToVote />} />
          <Route path="/about" element={<About />} />
        </Route>

        {/* ── Voter portal (standalone — no navbar) ── */}
        <Route path="/voter/login" element={<VoterLogin />} />
        <Route path="/voter/vote" element={<VotingPage />} />
        <Route path="/voter/confirmation" element={<VoteConfirmation />} />

        {/* ── Key Holder portal (standalone — no navbar) ── */}
        <Route path="/keyholder/login" element={<KeyHolderLogin />} />
        <Route path="/keyholder/submit" element={<KeyShareSubmit />} />
        <Route path="/keyholder/status" element={<KeyShareStatus />} />

        {/* ── EC Admin portal (standalone — no navbar) ── */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
