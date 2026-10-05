import type { LucideIcon, LucideProps } from "lucide-react";
import { Icon } from "./icon";
import type { IconName } from "./glyphs";

/*
 * Spectra's glyphs in the shape of icon components, so anything typed for an
 * icon component (a menu item, a command, an action) draws our own set. Only
 * editor workbars keep the generic set (docs/design/ICONS.md).
 */

const TAILWIND_SIZE = /(?:^|\s)(?:size|h)-(\d+(?:\.5)?)(?:\s|$)/;

function sizeOf(size: LucideProps["size"], className: string | undefined) {
  if (typeof size === "number") return size;
  if (typeof size === "string" && /^\d+$/.test(size)) return Number(size);
  const match = className?.match(TAILWIND_SIZE);
  return match ? Number(match[1]) * 4 : 16;
}

function glyph(name: IconName, displayName: string): LucideIcon {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function GlyphIcon({ size, strokeWidth, absoluteStrokeWidth, color, className, ...props }: LucideProps) {
    return (
      <Icon
        {...(props as Omit<LucideProps, "ref">)}
        name={name}
        size={sizeOf(size, className)}
        className={className}
        style={color ? { ...props.style, color } : props.style}
      />
    );
  }
  GlyphIcon.displayName = displayName;
  return GlyphIcon as unknown as LucideIcon;
}

export const X = glyph("close", "X");
export const Check = glyph("check", "Check");
export const Search = glyph("search", "Search");
export const ExternalLink = glyph("external", "ExternalLink");
export const ChevronDown = glyph("chevronDown", "ChevronDown");
export const ChevronRight = glyph("chevronRight", "ChevronRight");
export const Plus = glyph("add", "Plus");
export const MessageSquare = glyph("conversations", "MessageSquare");
export const MessagesSquare = glyph("conversations", "MessagesSquare");
export const Link2 = glyph("link", "Link2");
export const FileText = glyph("document", "FileText");
export const AlertCircle = glyph("problem", "AlertCircle");
export const AlertTriangle = glyph("problem", "AlertTriangle");
export const Info = glyph("info", "Info");
export const School = glyph("school", "School");
export const GraduationCap = glyph("school", "GraduationCap");
export const Bot = glyph("agent", "Bot");
export const Maximize2 = glyph("expand", "Maximize2");
export const Minimize2 = glyph("collapse", "Minimize2");
export const Trash2 = glyph("trash", "Trash2");
export const Users = glyph("people", "Users");
export const Star = glyph("star", "Star");
export const Share2 = glyph("share", "Share2");
export const Mail = glyph("mail", "Mail");
export const LockKeyhole = glyph("locked", "LockKeyhole");
export const ImageIcon = glyph("image", "ImageIcon");
export const Home = glyph("home", "Home");
export const FolderOpen = glyph("folder", "FolderOpen");
export const FolderPlus = glyph("folder", "FolderPlus");
export const FolderInput = glyph("folder", "FolderInput");
export const CalendarDays = glyph("calendar", "CalendarDays");
export const Code = glyph("code", "Code");
export const CheckCircle2 = glyph("done", "CheckCircle2");
export const CheckSquare = glyph("task", "CheckSquare");
export const PanelLeft = glyph("sidebar", "PanelLeft");
export const PanelRightOpen = glyph("openSide", "PanelRightOpen");
export const Table = glyph("sheet", "Table");
export const SlidersHorizontal = glyph("filter", "SlidersHorizontal");
export const Palette = glyph("theme", "Palette");
export const Cable = glyph("devices", "Cable");
export const Bell = glyph("bell", "Bell");
export const Ellipsis = glyph("more", "Ellipsis");
export const MoreHorizontal = glyph("more", "MoreHorizontal");
export const Pin = glyph("pin", "Pin");
export const Send = glyph("send", "Send");
export const Paperclip = glyph("attach", "Paperclip");
export const Filter = glyph("filter", "Filter");
export const ArrowUpDown = glyph("sort", "ArrowUpDown");
export const Settings = glyph("settings", "Settings");
export const LogOut = glyph("signOut", "LogOut");
export const Keyboard = glyph("keyboard", "Keyboard");
export const BarChart3 = glyph("analytics", "BarChart3");
export const History = glyph("versions", "History");
export const Lock = glyph("locked", "Lock");
export const Eye = glyph("readOnly", "Eye");
export const WifiOff = glyph("offline", "WifiOff");
export const RefreshCw = glyph("syncing", "RefreshCw");
export const Presentation = glyph("slides", "Presentation");
export const Folder = glyph("folder", "Folder");
export const FileQuestion = glyph("quiz", "FileQuestion");
export const Layers = glyph("flashcards", "Layers");
export const PenTool = glyph("whiteboard", "PenTool");
export const Calendar = glyph("calendar", "Calendar");
export const Library = glyph("library", "Library");
export const BookOpen = glyph("library", "BookOpen");
export const Loader2 = glyph("working", "Loader2");
export const LoaderCircle = glyph("working", "LoaderCircle");
export const ShieldCheck = glyph("shield", "ShieldCheck");
export const ShieldAlert = glyph("shield", "ShieldAlert");
export const Code2 = glyph("code", "Code2");
export const Clock3 = glyph("clock", "Clock3");
export const RotateCcw = glyph("retry", "RotateCcw");
export const RotateCw = glyph("retry", "RotateCw");
export const Play = glyph("play", "Play");
export const Square = glyph("stop", "Square");
export const Table2 = glyph("sheet", "Table2");
export const ChevronLeft = glyph("chevronLeft", "ChevronLeft");
export const ChevronUp = glyph("chevronUp", "ChevronUp");
export const UserPlus = glyph("people", "UserPlus");
export const UserCheck = glyph("people", "UserCheck");
export const CalendarCheck2 = glyph("calendar", "CalendarCheck2");
export const HelpCircle = glyph("help", "HelpCircle");
export const CircleHelp = glyph("help", "CircleHelp");
export const ArrowRight = glyph("arrowRight", "ArrowRight");
export const ArrowUpRight = glyph("external", "ArrowUpRight");
export const SquareArrowOutUpRight = glyph("external", "SquareArrowOutUpRight");
export const MessageSquarePlus = glyph("conversations", "MessageSquarePlus");
export const MessageCircle = glyph("conversations", "MessageCircle");
export const FileClock = glyph("versions", "FileClock");
export const KeyRound = glyph("locked", "KeyRound");
export const Settings2 = glyph("settings", "Settings2");
export const Download = glyph("download", "Download");
export const GripVertical = glyph("grip", "GripVertical");
export const PanelRightClose = glyph("openSide", "PanelRightClose");
export const Files = glyph("document", "Files");
export const File = glyph("document", "File");
export const Pencil = glyph("edit", "Pencil");
export const Save = glyph("saved", "Save");
export const Copy = glyph("copy", "Copy");
export const Image = glyph("image", "Image");
