import { useState } from "react";
import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell.jsx";
import AuthField from "../../components/auth/AuthField.jsx";
import api from "../../api/client.js";

function mapForgotPasswordError(err) {
  const status = err.response?.status;
  const message = err.response?.data?.message;

  if (status === 400) {
    return message || "Please enter a valid email address.";
  }
  if (!err.response) {
    return "Unable to reach the server. Check your connection and try again.";
  }
  return "Unable to send the reset link right now. Please try again.";
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSuccess(true);
    } catch (err) {
      setError(mapForgotPasswordError(err));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <AuthShell
        title="Forgot password?"
        subtitle="Enter your email address and we'll send you a link to reset your password."
        footer={
          <Link to="/login" className="font-medium text-accentblue hover:underline">
            &larr; Back to Sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center rounded-lg border border-hair bg-surface-1 px-4 py-6 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accentblue/15 text-accentblue">
            <MailCheck size={22} />
          </span>
          <p className="text-sm font-medium text-txt-primary">Check your email</p>
          <p className="mt-1 text-sm text-txt-muted">
            We&apos;ve sent password reset instructions to your email address if an
            account exists.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot password?"
      subtitle="Enter your email address and we'll send you a link to reset your password."
      footer={
        <Link to="/login" className="font-medium text-accentblue hover:underline">
          &larr; Back to Sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <AuthField
          label="Email address"
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="email"
          required
        />

        {error && (
          <p
            className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-accentblue py-2.5 text-sm font-medium text-white transition-colors hover:bg-accentblue-hover disabled:opacity-60"
        >
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}
