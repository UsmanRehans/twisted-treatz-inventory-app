import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "../api/adminClient";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await requestPasswordReset(email);
      setSubmitted(true);
    } catch (err) {
      // Only rate limiting or server errors reach here — the response is
      // intentionally identical whether or not the email exists
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              Twisted Treatz
            </h1>
            <p className="text-sm text-gray-500 mt-1">Reset Password</p>
          </div>

          {submitted ? (
            <div className="space-y-5">
              <div className="bg-green-50 text-green-800 text-sm px-3 py-3 rounded-md border border-green-200">
                If that email has an account, a reset link has been sent.
                Check your inbox — the link expires in 30 minutes.
              </div>
              <Link
                to="/admin/login"
                className="block text-center text-sm text-indigo-600 hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-sm text-gray-600">
                Enter your admin email and we&apos;ll send you a link to reset
                your password.
              </p>

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="admin@twistedtreatz.com"
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md border border-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </button>

              <Link
                to="/admin/login"
                className="block text-center text-sm text-indigo-600 hover:underline"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
