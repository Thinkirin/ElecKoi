/* ElecKoi Unified Icon System */
import { createElement } from "react";
import {
  Plus, X, Check, Trash, PencilSimple,
  FloppyDisk, Copy, Download, Upload,
  GearSix, MagnifyingGlass, Funnel, SortAscending,
  Eye, EyeSlash, LockSimple, LockSimpleOpen,
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  CaretDown, CaretUp, CaretLeft, CaretRight,
  DotsThree, DotsThreeVertical,
  Star, Heart, Bookmark,
  ChatCircle, User, Users, Bell,
  Image, File, Folder, Link,
  Play, Pause, Stop, SkipForward,
  Warning, Info, CheckCircle, XCircle,
  Lightning, Moon, Sun, Palette,
  Database, Cloud, CloudArrowUp, CloudArrowDown,
  Code, Terminal, Article, Books,
  Sparkle, Cube, Package, Gift,
  ArrowClockwise, ArrowCounterClockwise,
  ListBullets, Rows, Columns, SquaresFour as Grid
} from "@phosphor-icons/react";

// Export all icons with consistent naming
export const Icons = {
  // Actions
  Plus, X, Check, Trash, Edit: PencilSimple,
  Save: FloppyDisk, Copy, Download, Upload,

  // Navigation
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  CaretDown, CaretUp, CaretLeft, CaretRight,

  // UI Controls
  Settings: GearSix, Search: MagnifyingGlass,
  Filter: Funnel, Sort: SortAscending,

  // Visibility
  Eye, EyeSlash, Lock: LockSimple, Unlock: LockSimpleOpen,

  // More
  DotsThree, DotsThreeVertical,

  // Favorites
  Star, Heart, Bookmark,

  // Communication
  Chat: ChatCircle, User, Users, Bell,

  // Files
  Image, File, Folder, Link,

  // Media
  Play, Pause, Stop, SkipForward,

  // Status
  Warning, Info, Success: CheckCircle, Error: XCircle,

  // Theme
  Lightning, Moon, Sun, Palette,

  // Data
  Database, Cloud, CloudUpload: CloudArrowUp, CloudDownload: CloudArrowDown,

  // Code
  Code, Terminal, Article, Books,

  // Special
  Sparkle, Cube, Package, Gift,

  // Sync
  Refresh: ArrowClockwise, Undo: ArrowCounterClockwise,

  // Layout
  List: ListBullets, Rows, Columns, Grid
};

// Icon wrapper component for consistent sizing and styling
export function Icon({ name, size = 16, weight = "regular", className, ...props }) {
  const IconComponent = Icons[name];

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found in icon system`);
    return null;
  }

  return createElement(IconComponent, { size, weight, className, ...props });
}

// Preset icon sizes
export const IconSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24
};

// Preset icon weights
export const IconWeights = {
  thin: "thin",
  light: "light",
  regular: "regular",
  bold: "bold",
  fill: "fill",
  duotone: "duotone"
};
