const LandingPage = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 md:p-12">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
          Welcome to E-Voting Simulation
        </h1>
        <p className="text-gray-600 text-lg leading-relaxed mb-8">
          This is a research simulation project exploring secure electronic
          voting protocols. It is intended for academic and experimental
          purposes only.
        </p>

        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Before You Start
        </h2>
        <ol className="list-decimal list-inside space-y-3 text-gray-700 mb-8">
          <li>Clone the repository from GitHub</li>
          <li>
            Read the{" "}
            <code className="bg-gray-100 text-sm px-1.5 py-0.5 rounded font-mono">
              CONTRIBUTING.md
            </code>{" "}
            file carefully before doing anything
          </li>
          <li>
            Always create your feature branch from{" "}
            <code className="bg-gray-100 text-sm px-1.5 py-0.5 rounded font-mono">
              dev
            </code>
            , never from{" "}
            <code className="bg-gray-100 text-sm px-1.5 py-0.5 rounded font-mono">
              main
            </code>
          </li>
          <li>
            Never push directly to{" "}
            <code className="bg-gray-100 text-sm px-1.5 py-0.5 rounded font-mono">
              main
            </code>{" "}
            or{" "}
            <code className="bg-gray-100 text-sm px-1.5 py-0.5 rounded font-mono">
              dev
            </code>
          </li>
          <li>All changes go through a pull request</li>
        </ol>

        <a
          href="https://github.com/sheikhhossainn/evoting-simulation/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-blue-600 hover:text-blue-800 font-medium underline underline-offset-4 transition-colors"
        >
          Read CONTRIBUTING.md on GitHub →
        </a>
      </div>
    </div>
  );
};

export default LandingPage;
