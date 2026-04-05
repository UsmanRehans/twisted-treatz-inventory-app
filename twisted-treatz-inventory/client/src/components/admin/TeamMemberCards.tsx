import { useState, useEffect, useCallback } from "react";
import {
  fetchAdminTeamMembers,
  updateTeamMember,
} from "../../api/adminClient";
import type { AdminTeamMember } from "../../api/adminClient";

interface TeamMemberCardsProps {
  token: string;
}

export default function TeamMemberCards({ token }: TeamMemberCardsProps) {
  const [members, setMembers] = useState<AdminTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // PIN reset modal state
  const [resetTarget, setResetTarget] = useState<AdminTeamMember | null>(null);
  const [newPin, setNewPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSaving, setPinSaving] = useState(false);

  // Toggle saving state
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const loadMembers = useCallback(() => {
    setLoading(true);
    fetchAdminTeamMembers(token)
      .then(setMembers)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load")
      )
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function handleToggleActive(member: AdminTeamMember) {
    setTogglingId(member.id);
    try {
      const updated = await updateTeamMember(token, member.id, {
        active: !member.active,
      });
      setMembers((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m))
      );
    } catch (err) {
      console.error("Toggle failed:", err);
    } finally {
      setTogglingId(null);
    }
  }

  async function handlePinReset() {
    if (!resetTarget) return;
    if (!/^\d{4}$/.test(newPin)) {
      setPinError("PIN must be exactly 4 digits");
      return;
    }

    setPinSaving(true);
    setPinError("");
    try {
      await updateTeamMember(token, resetTarget.id, { pin: newPin });
      setResetTarget(null);
      setNewPin("");
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Failed to reset PIN");
    } finally {
      setPinSaving(false);
    }
  }

  function closeModal() {
    setResetTarget(null);
    setNewPin("");
    setPinError("");
  }

  if (loading) {
    return (
      <div className="text-gray-500 py-8 text-center">
        Loading team members...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 px-4 py-3 rounded-md">
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        {members.map((member) => (
          <div
            key={member.id}
            className={`border rounded-lg p-5 ${
              member.active
                ? "bg-white border-gray-200"
                : "bg-gray-50 border-gray-200 opacity-60"
            }`}
          >
            <div className="flex items-center gap-4 mb-4">
              {/* Avatar */}
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                  member.active ? "bg-indigo-500" : "bg-gray-400"
                }`}
              >
                {member.initials}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">{member.name}</h3>
                <span
                  className={`inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                    member.active
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {member.active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setResetTarget(member);
                  setNewPin("");
                  setPinError("");
                }}
                className="flex-1 text-sm px-3 py-2 bg-indigo-50 text-indigo-700 rounded-md hover:bg-indigo-100 transition-colors font-medium"
              >
                Reset PIN
              </button>
              <button
                onClick={() => handleToggleActive(member)}
                disabled={togglingId === member.id}
                className={`flex-1 text-sm px-3 py-2 rounded-md font-medium transition-colors disabled:opacity-50 ${
                  member.active
                    ? "bg-red-50 text-red-700 hover:bg-red-100"
                    : "bg-green-50 text-green-700 hover:bg-green-100"
                }`}
              >
                {togglingId === member.id
                  ? "..."
                  : member.active
                    ? "Deactivate"
                    : "Activate"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* PIN Reset Modal */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Reset PIN
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Set a new 4-digit PIN for {resetTarget.name}
            </p>

            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              value={newPin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                setNewPin(val);
              }}
              placeholder="Enter 4-digit PIN"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
              autoFocus
            />

            {pinError && (
              <p className="text-red-600 text-sm mt-2">{pinError}</p>
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={closeModal}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePinReset}
                disabled={pinSaving || newPin.length !== 4}
                className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pinSaving ? "Saving..." : "Save PIN"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
