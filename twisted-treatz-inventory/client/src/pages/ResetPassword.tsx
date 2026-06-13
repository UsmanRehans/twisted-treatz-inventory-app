import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api/adminClient";

const MIN_PASSWORD_LENGTH = 10;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err) {
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
            <p className="text-sm text-gray-500 mt-1">Choose a New Password</p>
          </div>

          {!token ? (
            <div className="space-y-5">
              <div className="bg-red-50 text-red-700 text-sm px-3 py-3 rounded-md border border-red-200">
                This reset link is missing its token. Use the link from your
                email, or request a new one.
              </div>
              <Link
                to="/admin/forgot-password"
                className="block text-center text-sm text-indigo-600 hover:underline"
              >
                Request a new link
              </Link>
            </div>
          ) : success ? (
            <div className="space-y-5">
              <div className="bg-green-50 text-green-800 text-sm px-3 py-3 rounded-md border border-green-200">
                Password updated. You can now sign in with your new password.
              </div>
              <Link
                to="/admin/login"
                className="block w-full py-2.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 text-center transition-colors"
              >
                Go to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="newPassword"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  New Password
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Confirm New Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Re-enter new password"
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md border border-red-200">
                  {error}
                  {error === "Invalid or expired reset link" && (
                    <Link
                      to="/admin/forgot-password"
                      className="block mt-1 text-indigo-600 hover:underline"
                    >
                      Request a new link
                    </Link>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Updating..." : "Update Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
