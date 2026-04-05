interface SuccessAnimationProps {
  qty: number;
  productName: string;
}

export default function SuccessAnimation({
  qty,
  productName,
}: SuccessAnimationProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-green-600 fade-in">
      <div className="flex flex-col items-center text-white">
        {/* Checkmark circle */}
        <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center mb-6 scale-in">
          <svg
            className="w-14 h-14 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <h2 className="text-[28px] font-bold mb-2 scale-in">
          Removal Confirmed
        </h2>
        <p className="text-[20px] text-white/90 scale-in">
          Removed {qty} unit{qty !== 1 ? "s" : ""} of {productName}
        </p>
      </div>
    </div>
  );
}
