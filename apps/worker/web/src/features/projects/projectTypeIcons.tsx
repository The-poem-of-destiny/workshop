import { BookOpen, Cpu, ScrollText, Sparkles, UserRound, Wand2 } from "lucide-react";

export function ProjectTypeIcon({ type, className }: { type: string | null | undefined; className?: string }) {
  const props = { className, "aria-hidden": true as const };
  switch (type) {
    case "角色":
      return <UserRound {...props} />;
    case "内容扩展":
      return <Sparkles {...props} />;
    case "系统核心":
      return <Cpu {...props} />;
    case "规则扩展":
      return <ScrollText {...props} />;
    case "体验优化":
      return <Wand2 {...props} />;
    default:
      return <BookOpen {...props} />;
  }
}
