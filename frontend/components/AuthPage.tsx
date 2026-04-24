"use client";

import React, { useState } from "react";
import { supabase } from "../lib/supabase";

type AuthMode = "signin" | "signup";

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "github" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        // Email confirmation is disabled, so user is logged in immediately
        setSuccessMsg("Account created! You're now logged in.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        // onAuthStateChange in AuthContext will update state automatically
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "github") => {
    setSocialLoading(provider);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setSocialLoading(null);
    }
    // On success, browser redirects — no further action needed
  };

  return (
    <div style={styles.root}>
      {/* Background gradient blobs */}
      <div style={styles.blob1} />
      <div style={styles.blob2} />
      <div style={styles.blob3} />

      <div style={styles.card}>
        {/* Logo / Brand */}
        <div style={styles.brand}>
          <div style={styles.logoIcon}>✦</div>
          <div style={styles.logoText}>Life Agent</div>
        </div>

        <h1 style={styles.heading}>
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p style={styles.subheading}>
          {mode === "signin"
            ? "Sign in to access your plans and conversations."
            : "Start building your personal plan to success."}
        </p>

        {/* Social login buttons */}
        <div style={styles.socialRow}>
          <button
            type="button"
            style={{
              ...styles.socialBtn,
              opacity: socialLoading === "github" ? 0.7 : 1,
            }}
            onClick={() => handleSocialLogin("github")}
            disabled={!!socialLoading || loading}
            id="auth-github-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            {socialLoading === "github" ? "Connecting…" : "GitHub"}
          </button>

          <button
            type="button"
            style={{
              ...styles.socialBtn,
              opacity: socialLoading === "google" ? 0.7 : 1,
            }}
            onClick={() => handleSocialLogin("google")}
            disabled={!!socialLoading || loading}
            id="auth-google-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {socialLoading === "google" ? "Connecting…" : "Google"}
          </button>
        </div>

        {/* Divider */}
        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or continue with email</span>
          <div style={styles.dividerLine} />
        </div>

        {/* Email/Password form */}
        <form onSubmit={handleEmailAuth} style={styles.form}>
          <label style={styles.label} htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={styles.input}
            autoComplete="email"
          />

          <label style={styles.label} htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
            required
            minLength={6}
            style={styles.input}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />

          {error && <div style={styles.errorBox}>{error}</div>}
          {successMsg && <div style={styles.successBox}>{successMsg}</div>}

          <button
            type="submit"
            disabled={loading || !!socialLoading}
            style={{
              ...styles.submitBtn,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            id="auth-submit-btn"
          >
            {loading
              ? mode === "signin" ? "Signing in…" : "Creating account…"
              : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>

        {/* Toggle mode */}
        <p style={styles.toggleText}>
          {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            style={styles.toggleBtn}
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setSuccessMsg(null);
            }}
            id="auth-toggle-mode-btn"
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Inline styles ──────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0a0a12 0%, #0d1117 50%, #0a0a12 100%)",
    fontFamily: "'Inter', system-ui, sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  blob1: {
    position: "absolute",
    width: 500,
    height: 500,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)",
    top: "-100px",
    left: "-100px",
    pointerEvents: "none",
  },
  blob2: {
    position: "absolute",
    width: 400,
    height: 400,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)",
    bottom: "-50px",
    right: "100px",
    pointerEvents: "none",
  },
  blob3: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)",
    top: "40%",
    right: "-50px",
    pointerEvents: "none",
  },
  card: {
    position: "relative",
    zIndex: 10,
    background: "rgba(15, 17, 26, 0.85)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: "44px 40px",
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  logoIcon: {
    fontSize: 22,
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    fontWeight: 900,
  },
  logoText: {
    fontSize: 17,
    fontWeight: 700,
    color: "#e2e8f0",
    letterSpacing: "-0.3px",
  },
  heading: {
    fontSize: 26,
    fontWeight: 800,
    color: "#f1f5f9",
    margin: "0 0 8px",
    letterSpacing: "-0.5px",
    lineHeight: 1.2,
  },
  subheading: {
    fontSize: 14,
    color: "#64748b",
    margin: "0 0 28px",
    lineHeight: 1.5,
  },
  socialRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginBottom: 22,
  },
  socialBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "11px 16px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s",
    fontFamily: "inherit",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 22,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "rgba(255,255,255,0.07)",
  },
  dividerText: {
    fontSize: 12,
    color: "#475569",
    whiteSpace: "nowrap",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: "#94a3b8",
    marginBottom: 4,
    marginTop: 10,
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    color: "#f1f5f9",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  },
  errorBox: {
    marginTop: 8,
    padding: "10px 14px",
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 8,
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 1.4,
  },
  successBox: {
    marginTop: 8,
    padding: "10px 14px",
    background: "rgba(16,185,129,0.1)",
    border: "1px solid rgba(16,185,129,0.25)",
    borderRadius: 8,
    color: "#6ee7b7",
    fontSize: 13,
  },
  submitBtn: {
    marginTop: 18,
    padding: "13px",
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    border: "none",
    borderRadius: 10,
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "inherit",
    letterSpacing: "-0.2px",
    cursor: "pointer",
    transition: "opacity 0.2s, transform 0.1s",
    boxShadow: "0 4px 20px rgba(99,102,241,0.35)",
  },
  toggleText: {
    marginTop: 20,
    textAlign: "center",
    fontSize: 13,
    color: "#64748b",
  },
  toggleBtn: {
    background: "none",
    border: "none",
    color: "#818cf8",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
};
