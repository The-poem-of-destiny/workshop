import type { ReactNode, RefObject } from "react";
import type { AdminSubmissionDetail } from "../../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export function ReviewTaskDialog({
  selectedId,
  detail,
  busy,
  decision,
  clearSelection,
  returnFocus,
  taskScroll,
  children,
  footer,
}: {
  selectedId: string | null;
  detail: AdminSubmissionDetail | null;
  busy: boolean;
  decision: "approve" | "reject" | null;
  clearSelection: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  taskScroll: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog
      open={selectedId !== null}
      onOpenChange={(open) => {
        if (!open && !busy && !decision) clearSelection();
      }}
    >
      <DialogContent
        className="review-task-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
          document.getElementById("review-queue-search")?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => {
          if (busy || decision) event.preventDefault();
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="review-task-header">
          <DialogTitle>
            {detail ? `审核 · ${detail.revision.title} · #${detail.revision.revisionNo}` : "审核任务"}
          </DialogTitle>
          <DialogDescription>队列与搜索保持原位；关闭后返回。决定完成后自动接续下一条。</DialogDescription>
        </DialogHeader>
        <div className="review-task-scroll" ref={taskScroll}>
          {children}
        </div>
        {detail ? footer : null}
      </DialogContent>
    </Dialog>
  );
}
