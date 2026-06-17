import { useState } from "react";
import { changeAdminPassword } from "../../api/adminClient";

const MIN_LENGTH = 10;

interface ChangePasswordProps {
  token: string;
  // A successful change revokes all existing sessions and re-issues this
  // one — the parent must swap the new token in or the next request 401s.
  onTokenRefresh: (newToken: string) => void;
}

export default function ChangePassword({ token, onTokenRefresh }: ChangePasswordProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Client-side guards mirror the server: catch typos before the network.
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsCurrent = next.length > 0 && next === current;
  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_LENGTH &&
    next === confirm &&
    !sameAsCurrent &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await changeAdminPassword(token, current, next);
      onTokenRefresh(result.token);
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900">Change Password</h3>
        <p className="text-sm text-gray-500 mt-1">
          Updates your own admin login. Sessions on other devices are signed
          out immediately; this one stays signed in.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current password
            </label>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {tooShort && (
              <p className="text-xs text-amber-600 mt-1">
                At least {MIN_LENGTH} characters.
              </p>
            )}
            {sameAsCurrent && (
              <p className="text-xs text-amber-600 mt-1">
                Must be different from your current password.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {mismatch && (
              <p className="text-xs text-amber-600 mt-1">Passwords don't match.</p>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
              Password updated. Use it next time you log in.
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full px-4 py-2 rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
