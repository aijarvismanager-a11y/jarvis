import { Modal } from "./Modal";

type Props = {
  stepRole: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDeleteModal({ stepRole, onCancel, onConfirm }: Props) {
  return (
    <Modal title="ステップを削除" onClose={onCancel}>
      <p className="text-[13.5px] leading-relaxed">
        「{stepRole}」を削除します。この操作は元に戻せません。よろしいですか？
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-[9px] border border-border text-[13px] font-semibold">
          キャンセル
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 rounded-[9px] bg-[#8A3A2A] text-white text-[13px] font-semibold"
        >
          削除する
        </button>
      </div>
    </Modal>
  );
}
