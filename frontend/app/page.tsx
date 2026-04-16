"use client";

import { AuthPage } from "../components/AuthPage";
import { ChatWindow } from "../components/chat-window";
import { useAuth } from "../lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a12",
          color: "#64748b",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 15,
          gap: 12,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ animation: "spin 1s linear infinite" }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Loading…
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return <ChatWindow />;
}
