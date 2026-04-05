import type { TeamMember } from "../../api/client";

// Assign a consistent color to each member based on their id
const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-purple-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-teal-600",
];

interface MemberSelectProps {
  members: TeamMember[];
  onSelect: (member: TeamMember) => void;
  loading: boolean;
  error: string | null;
}

export default function MemberSelect({
  members,
  onSelect,
  loading,
  error,
}: MemberSelectProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-[20px]">Loading team members...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-400 text-[20px]">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <h2 className="text-[28px] font-semibold text-gray-700 mb-8">
        Who is removing inventory?
      </h2>
      <div className="grid grid-cols-3 gap-6 w-full max-w-[800px]">
        {members.map((member) => (
          <button
            key={member.id}
            onClick={() => onSelect(member)}
            className={`flex flex-col items-center justify-center min-h-[120px] rounded-2xl bg-white border-2 border-gray-200 active:border-blue-500 active:bg-blue-50 transition-colors shadow-sm`}
          >
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-[22px] font-bold mb-3 ${AVATAR_COLORS[member.id % AVATAR_COLORS.length]}`}
            >
              {member.initials}
            </div>
            <span className="text-[20px] font-medium text-gray-800">
              {member.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
