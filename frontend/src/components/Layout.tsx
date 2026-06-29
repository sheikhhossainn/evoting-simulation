import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";

/**
 * Layout wrapper for public pages (Home, How to Vote, About).
 * Renders a shared Navbar above the page content.
 *
 * Login and functional pages (voter, keyholder, admin portals)
 * intentionally bypass this layout for a distraction-free experience.
 */
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
