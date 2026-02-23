import type { LucideIcon } from "lucide-react";
import {
  Atom,
  Bot,
  Calculator,
  Code2,
  FlaskConical,
  Globe2,
  GraduationCap,
  Landmark,
  Languages,
  Palette,
  PenTool,
  Sigma,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  Atom,
  Bot,
  Calculator,
  Code2,
  FlaskConical,
  Globe2,
  GraduationCap,
  Landmark,
  Languages,
  Palette,
  PenTool,
  Sigma,
} satisfies Record<string, LucideIcon>;

type IconName = keyof typeof ICONS;

export function defaultAvatarIconForCategory(category?: string): IconName {
  const value = (category ?? "").trim().toLowerCase();

  if (/math|calculus|algebra|statistics/.test(value)) return "Calculator";
  if (/science|chemistry|biology|physics/.test(value)) return "FlaskConical";
  if (/writing|english|language arts|essay/.test(value)) return "PenTool";
  if (/history|politics|social studies/.test(value)) return "Landmark";
  if (/coding|programming|cs|computer/.test(value)) return "Code2";
  if (/language|linguistics/.test(value)) return "Languages";
  if (/art|music|design/.test(value)) return "Palette";
  if (/philosophy|logic/.test(value)) return "Sigma";
  if (/geography|global|world/.test(value)) return "Globe2";

  return "Bot";
}

function resolveIcon(iconName?: string, category?: string): LucideIcon {
  if (iconName && iconName in ICONS) {
    return ICONS[iconName as IconName];
  }
  return ICONS[defaultAvatarIconForCategory(category)];
}

function iconNode(iconName: string, className?: string) {
  if (iconName === "Atom") return <Atom className={className} />;
  if (iconName === "Calculator") return <Calculator className={className} />;
  if (iconName === "Code2") return <Code2 className={className} />;
  if (iconName === "FlaskConical") return <FlaskConical className={className} />;
  if (iconName === "Globe2") return <Globe2 className={className} />;
  if (iconName === "GraduationCap") return <GraduationCap className={className} />;
  if (iconName === "Landmark") return <Landmark className={className} />;
  if (iconName === "Languages") return <Languages className={className} />;
  if (iconName === "Palette") return <Palette className={className} />;
  if (iconName === "PenTool") return <PenTool className={className} />;
  if (iconName === "Sigma") return <Sigma className={className} />;
  return <Bot className={className} />;
}

type AgentAvatarProps = {
  avatarIcon?: string;
  avatarEmoji?: string;
  category?: string;
  className?: string;
  iconClassName?: string;
};

export function AgentAvatar({ avatarIcon, avatarEmoji, category, className, iconClassName }: AgentAvatarProps) {
  if (!avatarIcon && avatarEmoji?.trim()) {
    return (
      <span
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-base",
          className,
        )}
        aria-hidden="true"
      >
        {avatarEmoji.trim()}
      </span>
    );
  }

  const resolved = resolveIcon(avatarIcon, category);
  const resolvedName = (Object.entries(ICONS).find(([, value]) => value === resolved)?.[0] ?? "Bot") as string;
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)]",
        className,
      )}
      aria-hidden="true"
    >
      {iconNode(resolvedName, cn("h-4 w-4", iconClassName))}
    </span>
  );
}
