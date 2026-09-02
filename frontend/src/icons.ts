// Centralised Lucide icon re-exports.
//
// Why this file exists:
//   Vite 8's Rolldown bundler mis-tree-shakes Lucide's top-level re-export chain
//   (`import { Home } from 'lucide-react'`), dropping the icon path data and
//   leaving empty <svg> elements at runtime. Importing each icon from its
//   direct module path bypasses the broken re-export graph. The per-icon files
//   ship no type declarations (lucide's .d.ts is at the root entry), so each
//   import is @ts-ignore — each one is a LucideIcon at runtime, as asserted
//   by the re-exports below.
//
// If you need a new icon, add it here once using the same pattern rather than
// importing from 'lucide-react' directly.

import type { LucideIcon } from 'lucide-react'

// @ts-ignore — subpath has no types; runtime default is LucideIcon.
import _Home from 'lucide-react/dist/esm/icons/home.mjs'
// @ts-ignore
import _Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-ignore
import _Users from 'lucide-react/dist/esm/icons/users.mjs'
// @ts-ignore
import _Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
// @ts-ignore
import _Settings from 'lucide-react/dist/esm/icons/settings.mjs'
// @ts-ignore
import _MessageSquare from 'lucide-react/dist/esm/icons/message-square.mjs'
// @ts-ignore
import _LogOut from 'lucide-react/dist/esm/icons/log-out.mjs'
// @ts-ignore
import _Shield from 'lucide-react/dist/esm/icons/shield.mjs'
// @ts-ignore
import _Bell from 'lucide-react/dist/esm/icons/bell.mjs'
// @ts-ignore
import _Star from 'lucide-react/dist/esm/icons/star.mjs'
// @ts-ignore
import _MapPin from 'lucide-react/dist/esm/icons/map-pin.mjs'
// @ts-ignore
import _Archive from 'lucide-react/dist/esm/icons/archive.mjs'
// @ts-ignore
import _Copy from 'lucide-react/dist/esm/icons/copy.mjs'
// @ts-ignore
import _GitFork from 'lucide-react/dist/esm/icons/git-fork.mjs'
// @ts-ignore
import _Move from 'lucide-react/dist/esm/icons/move.mjs'
// @ts-ignore
import _Share2 from 'lucide-react/dist/esm/icons/share-2.mjs'
// @ts-ignore
import _Upload from 'lucide-react/dist/esm/icons/upload.mjs'
// @ts-ignore
import _BookOpen from 'lucide-react/dist/esm/icons/book-open.mjs'
// @ts-ignore
import _Folder from 'lucide-react/dist/esm/icons/folder.mjs'
// @ts-ignore
import _Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-ignore
import _ListTree from 'lucide-react/dist/esm/icons/list-tree.mjs'
// @ts-ignore
import _List from 'lucide-react/dist/esm/icons/list.mjs'
// @ts-ignore
import _LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.mjs'
// @ts-ignore
import _Wrench from 'lucide-react/dist/esm/icons/wrench.mjs'
// @ts-ignore
import _BarChart2 from 'lucide-react/dist/esm/icons/bar-chart-2.mjs'
// @ts-ignore
import _History from 'lucide-react/dist/esm/icons/history.mjs'
// @ts-ignore
import _Leaf from 'lucide-react/dist/esm/icons/leaf.mjs'
// @ts-ignore
import _Sparkles from 'lucide-react/dist/esm/icons/sparkles.mjs'
// @ts-ignore
import _Terminal from 'lucide-react/dist/esm/icons/terminal.mjs'
// @ts-ignore
import _GraduationCap from 'lucide-react/dist/esm/icons/graduation-cap.mjs'
// @ts-ignore
import _File from 'lucide-react/dist/esm/icons/file.mjs'
// @ts-ignore
import _FilePlus from 'lucide-react/dist/esm/icons/file-plus.mjs'
// @ts-ignore
import _FolderPlus from 'lucide-react/dist/esm/icons/folder-plus.mjs'
// @ts-ignore
import _Download from 'lucide-react/dist/esm/icons/download.mjs'
// @ts-ignore
import _Check from 'lucide-react/dist/esm/icons/check.mjs'
// @ts-ignore
import _X from 'lucide-react/dist/esm/icons/x.mjs'
// @ts-ignore
import _RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-ignore
import _Loader2 from 'lucide-react/dist/esm/icons/loader-2.mjs'
// @ts-ignore
import _Play from 'lucide-react/dist/esm/icons/play.mjs'
// @ts-ignore
import _Globe from 'lucide-react/dist/esm/icons/globe.mjs'
// @ts-ignore
import _FileText from 'lucide-react/dist/esm/icons/file-text.mjs'
// @ts-ignore
import _ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs'
// @ts-ignore
import _ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.mjs'
// @ts-ignore
import _ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs'
// @ts-ignore
import _ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.mjs'
// @ts-ignore
import _SquareCheckBig from 'lucide-react/dist/esm/icons/square-check-big.mjs'
// @ts-ignore
import _Save from 'lucide-react/dist/esm/icons/save.mjs'
// @ts-ignore
import _Camera from 'lucide-react/dist/esm/icons/camera.mjs'
// @ts-ignore
import _FileOutput from 'lucide-react/dist/esm/icons/file-output.mjs'
// @ts-ignore
import _ExternalLink from 'lucide-react/dist/esm/icons/external-link.mjs'
// @ts-ignore
import _PackageCheck from 'lucide-react/dist/esm/icons/package-check.mjs'
// @ts-ignore
import _Database from 'lucide-react/dist/esm/icons/database.mjs'
// @ts-ignore
import _Eye from 'lucide-react/dist/esm/icons/eye.mjs'
// @ts-ignore
import _EyeOff from 'lucide-react/dist/esm/icons/eye-off.mjs'
// @ts-ignore
import _Focus from 'lucide-react/dist/esm/icons/focus.mjs'
// @ts-ignore
import _Minimize2 from 'lucide-react/dist/esm/icons/minimize-2.mjs'

export const Home: LucideIcon = _Home
export const Plus: LucideIcon = _Plus
export const Users: LucideIcon = _Users
export const Trash2: LucideIcon = _Trash2
export const Settings: LucideIcon = _Settings
export const MessageSquare: LucideIcon = _MessageSquare
export const LogOut: LucideIcon = _LogOut
export const Shield: LucideIcon = _Shield
export const Bell: LucideIcon = _Bell
export const Star: LucideIcon = _Star
export const MapPin: LucideIcon = _MapPin
export const Archive: LucideIcon = _Archive
export const Copy: LucideIcon = _Copy
export const GitFork: LucideIcon = _GitFork
export const Move: LucideIcon = _Move
export const Share2: LucideIcon = _Share2
export const Upload: LucideIcon = _Upload
export const BookOpen: LucideIcon = _BookOpen
export const Folder: LucideIcon = _Folder
export const Search: LucideIcon = _Search
export const ListTree: LucideIcon = _ListTree
export const List: LucideIcon = _List
export const LayoutGrid: LucideIcon = _LayoutGrid
export const Wrench: LucideIcon = _Wrench
export const BarChart2: LucideIcon = _BarChart2
export const History: LucideIcon = _History
export const Leaf: LucideIcon = _Leaf
export const Sparkles: LucideIcon = _Sparkles
export const Terminal: LucideIcon = _Terminal
export const GraduationCap: LucideIcon = _GraduationCap
export const File: LucideIcon = _File
export const FilePlus: LucideIcon = _FilePlus
export const FolderPlus: LucideIcon = _FolderPlus
export const Download: LucideIcon = _Download
export const Check: LucideIcon = _Check
export const X: LucideIcon = _X
export const RefreshCw: LucideIcon = _RefreshCw
export const Loader2: LucideIcon = _Loader2
export const Play: LucideIcon = _Play
export const Globe: LucideIcon = _Globe
export const FileText: LucideIcon = _FileText
export const ChevronDown: LucideIcon = _ChevronDown
export const ChevronUp: LucideIcon = _ChevronUp
export const ChevronRight: LucideIcon = _ChevronRight
export const ClipboardList: LucideIcon = _ClipboardList
export const SquareCheckBig: LucideIcon = _SquareCheckBig
export const Save: LucideIcon = _Save
export const Camera: LucideIcon = _Camera
export const FileOutput: LucideIcon = _FileOutput
export const ExternalLink: LucideIcon = _ExternalLink
export const PackageCheck: LucideIcon = _PackageCheck
export const Database: LucideIcon = _Database
export const Eye: LucideIcon = _Eye
export const EyeOff: LucideIcon = _EyeOff
export const Focus: LucideIcon = _Focus
export const Minimize2: LucideIcon = _Minimize2
// @ts-ignore
import _Brain from 'lucide-react/dist/esm/icons/brain.mjs'
// @ts-ignore
import _Bot from 'lucide-react/dist/esm/icons/bot.mjs'
// @ts-ignore
import _TriangleAlert from 'lucide-react/dist/esm/icons/triangle-alert.mjs'

export const Brain: LucideIcon = _Brain
export const Bot: LucideIcon = _Bot
export const AlertTriangle: LucideIcon = _TriangleAlert

// @ts-ignore
import _Zap from 'lucide-react/dist/esm/icons/zap.mjs'
// @ts-ignore
import _Code from 'lucide-react/dist/esm/icons/code.mjs'
// @ts-ignore
import _Lock from 'lucide-react/dist/esm/icons/lock.mjs'
// @ts-ignore
import _Layers from 'lucide-react/dist/esm/icons/layers.mjs'

export const Zap: LucideIcon = _Zap
export const Code: LucideIcon = _Code
export const Lock: LucideIcon = _Lock
export const Layers: LucideIcon = _Layers

