import { useState, useCallback, useEffect } from "react";

interface PinPadProps {
  memberName: string;
  onSubmit: (pin: string) => Promise<void>;
  onBack: () => void;
  error: string | null;
}

export default function PinPad({
  memberName,
  onSubmit,
  onBack,
  error,
}: PinPadProps) {
  const [digits, setDigits] = useState<string>("");
  const [shaking, setShaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Trigger shake animation when error changes
  useEffect(() => {
    if (error) {
      setShaking(true);
      setDigits("");
      const timer = setTimeout(() => setShaking(false), 400);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleDigit = useCallback(
    (digit: string) => {
      if (submitting) return;
      const next = digits + digit;
      if (next.length > 4) return;

      setDigits(next);

      // Auto-submit on 4 digits
      if (next.length === 4) {
        setSubmitting(true);
        onSubmit(next).finally(() => setSubmitting(false));
      }
    },
    [digits, onSubmit, submitting]
  );

  const handleBackspace = useCallback(() => {
    if (submitting) return;
    setDigits((d) => d.slice(0, -1));
  }, [submitting]);

  const handleClear = useCallback(() => {
    if (submitting) return;
    setDigits("");
  }, [submitting]);

  const buttons = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    "clear", "0", "back",
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      {/* Back button */}
      <button
        onClick={onBack}
        className="absolute top-20 left-6 min-h-[64px] px-6 text-[18px] text-gray-500 font-medium active:text-gray-800"
      >
        &larr; Back
      </button>

      {/* Member name */}
      <h2 className="text-[24px] font-semibold text-gray-700 mb-2">
        {memberName}
      </h2>
      <p className="text-[18px] text-gray-400 mb-8">Enter your 4-digit PIN</p>

      {/* PIN dots */}
      <div className={`flex gap-4 mb-4 ${shaking ? "shake" : ""}`}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-5 h-5 rounded-full border-2 transition-colors ${
              i < digits.length
                ? "bg-blue-600 border-blue-600"
                : "bg-transparent border-gray-300"
            }`}
          />
        ))}
      </div>

      {/* Error message */}
      <div className="h-8 flex items-center justify-center mb-4">
        {error && (
          <span className="text-red-500 text-[16px] font-medium">{error}</span>
        )}
        {submitting && (
          <span className="text-gray-400 text-[16px]">Verifying...</span>
        )}
      </div>

      {/* Number pad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[320px]">
        {buttons.map((btn) => {
          if (btn === "clear") {
            return (
              <button
                key={btn}
                onClick={handleClear}
                className="min-h-[64px] rounded-xl bg-gray-100 text-[18px] font-medium text-gray-500 active:bg-gray-200 transition-colors"
              >
                Clear
              </button>
            );
          }
          if (btn === "back") {
            return (
              <button
                key={btn}
                onClick={handleBackspace}
                className="min-h-[64px] rounded-xl bg-gray-100 text-[24px] font-medium text-gray-500 active:bg-gray-200 transition-colors"
              >
                &#9003;
              </button>
            );
          }
          return (
            <button
              key={btn}
              onClick={() => handleDigit(btn)}
              className="min-h-[64px] rounded-xl bg-white border border-gray-200 text-[24px] font-semibold text-gray-800 active:bg-blue-50 active:border-blue-400 transition-colors shadow-sm"
            >
              {btn}
            </button>
          );
        })}
      </div>
    </div>
  );
}
