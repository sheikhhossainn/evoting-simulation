import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import VoterLogin from "./pages/VoterLogin";
import VotingPage from "./pages/VotingPage";
import VoteConfirmation from "./pages/VoteConfirmation";
import KeyHolderLogin from "./pages/KeyHolderLogin";
import KeyShareSubmit from "./pages/KeyShareSubmit";
import KeyShareStatus from "./pages/KeyShareStatus";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/voter/login" element={<VoterLogin />} />
        <Route path="/voter/vote" element={<VotingPage />} />
        <Route path="/voter/confirmation" element={<VoteConfirmation />} />
        <Route path="/keyholder/login" element={<KeyHolderLogin />} />
        <Route path="/keyholder/submit" element={<KeyShareSubmit />} />
        <Route path="/keyholder/status" element={<KeyShareStatus />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
