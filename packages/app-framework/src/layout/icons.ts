/**
 * Re-exported lucide-react icons. Lives in a plain (non-`'use client'`)
 * module so both server and client components can import and render
 * these directly.
 *
 * Apps that want extra icons import from lucide-react themselves.
 */
export {
  Activity,
  AlertCircle,
  BadgeCheck,
  Bell,
  ChevronDown,
  CircleHelp,
  Clock,
  Database,
  FileLock2,
  Filter,
  Home,
  KeyRound,
  LineChart,
  Network,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

/**
 * Grouped namespace export — convenience for the common sidebar items.
 * Both `<SidebarIcons.Home />` and `import { Home } from '.../layout'`
 * work.
 */
import {
  Activity,
  FileLock2,
  Home,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';
export const SidebarIcons = {
  Activity,
  FileLock2,
  Home,
  Settings,
  ShieldAlert,
  Users,
};
