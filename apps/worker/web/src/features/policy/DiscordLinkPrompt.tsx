import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

export interface DiscordPromptTarget {
  projectTitle: string;
  threadUrl: string;
}

export function DiscordLinkPrompt({
  target,
  communityInviteUrl,
  onClose,
}: {
  target: DiscordPromptTarget | null;
  communityInviteUrl: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="discord-prompt-dialog max-w-[440px]">
        <DialogHeader>
          <DialogTitle>前往作品讨论帖</DialogTitle>
          <DialogDescription>
            {target ? `即将打开《${target.projectTitle}》在 Discord 社区中的讨论串。` : ""}
          </DialogDescription>
        </DialogHeader>
        {target ? (
          <div className="discord-prompt-body">
            <a
              className="discord-prompt-primary"
              href={target.threadUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
            >
              <ExternalLink aria-hidden="true" />
              <span>打开 Discord 讨论帖</span>
            </a>
            <div className="discord-prompt-subtle">
              <p>若打开后显示「无权查看频道」或空白，说明你的账号尚未加入社区服务器或未完成频道身份验证：</p>
              <a href={communityInviteUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                先加入社区服务器 →
              </a>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
