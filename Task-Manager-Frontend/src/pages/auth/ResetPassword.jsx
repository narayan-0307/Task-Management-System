import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell.jsx";
import AuthField from "../../components/auth/AuthField.jsx";
import PasswordStrength, {
  isPasswordValid,
} from "../../components/auth/PasswordStrength.jsx";
import api from "../../api/client.js";

function mapResetError(err) {
  const status = err.response?.status;
  const message = err.response?.data?.message;

  if (status === 400 || status === 401) {
    return message || "This password reset link is invalid or has expired.";
  }
  if (!err.response) {
    return "Unable to reach the server. Check your connection and try again.";
  }
  return "Unable to reset your password right now. Please try again.";
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");

  const [form, setForm] = useState({ password: "", confirm_password: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  function validate() {
    const errs = {};
    if (!isPasswordValid(form.password))
      errs.password = "Password must be at least 8 characters.";
    if (form.confirm_password !== form.password)
      errs.confirm_password = "Passwords do not match.";
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("This password reset link is invalid or incomplete.");
      return;
    }

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", {
        token,
        password: form.password,
      });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 1800);
    } catch (err) {
      setError(mapResetError(err));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <AuthShell
        title="Reset password"
        subtitle="Create a new password for your account."
        footer={
          <>
            <Link to="/login" className="font-medium text-accentblue hover:underline">
              &larr; Back to Sign in
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center rounded-lg border border-hair bg-surface-1 px-4 py-6 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={22} />
          </span>
          <p className="text-sm font-medium text-txt-primary">
            Your password has been reset successfully.
          </p>
          <p className="mt-1 text-sm text-txt-muted">
            Redirecting you to sign in&hellip;
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset password"
      subtitle="Create a new password for your account."
      footer={
        <Link to="/login" className="font-medium text-accentblue hover:underline">
          &larr; Back to Sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <AuthField
          label="New password"
          type="password"
          name="password"
          value={form.password}
          onChange={handleChange}
          placeholder="8+ characters"
          autoComplete="new-password"
          error={fieldErrors.password}
          required
        />
        <PasswordStrength password={form.password} />

        <AuthField
          label="Confirm password"
          type="password"
          name="confirm_password"
          value={form.confirm_password}
          onChange={handleChange}
          placeholder="Re-enter your new password"
          autoComplete="new-password"
          error={fieldErrors.confirm_password}
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
          {loading ? "Resetting…" : "Reset password"}
        </button>
      </form>
    </AuthShell>
  );
}
