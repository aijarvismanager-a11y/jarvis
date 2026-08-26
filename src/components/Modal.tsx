import type { ReactNode } from "react";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ title, onClose, children }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(43, 42, 38, 0.35)" }}
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-2xl shadow-xl w-[480px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-borderSoft">
          <span className="font-serif text-lg font-semibold">{title}</span>
          <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2B2A26" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
