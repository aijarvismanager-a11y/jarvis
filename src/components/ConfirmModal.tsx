import type { ReactNode } from "react";
import { Modal } from "./Modal";

type Props = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({ title, message, confirmLabel, danger, onCancel, onConfirm }: Props) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-[13.5px] leading-relaxed">{message}</div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 rounded-[9px] text-white text-[13px] font-semibold"
          style={{ background: danger ? "#8A3A2A" : "#B5563A" }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
