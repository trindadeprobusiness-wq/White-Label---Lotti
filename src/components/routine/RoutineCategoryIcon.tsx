import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck, BriefcaseBusiness, Camera, CircleEllipsis, ClipboardCheck,
  FileClock, FolderOpen, Handshake, Home, KeyRound, ListTodo, Lock,
  MapPin, Megaphone, MessageCircle, PenLine, Phone, ReceiptText, RefreshCw,
  Scale, ScanLine, Search, Send, Users, WalletCards, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getRoutineCategory } from '@/lib/routine/categories';

const ICONS: Record<string, LucideIcon> = {
  Search, MessageCircle, RefreshCw, BadgeCheck, Phone, Users, MapPin, Home,
  ClipboardCheck, Camera, Megaphone, Send, Handshake, FolderOpen, Scale,
  PenLine, ScanLine, KeyRound, ReceiptText, WalletCards, FileClock, Wrench,
  BriefcaseBusiness, ListTodo, Lock, CircleEllipsis,
};

export function RoutineCategoryIcon({
  categoryId,
  className,
  withSurface = false,
}: {
  categoryId: string;
  className?: string;
  withSurface?: boolean;
}) {
  const category = getRoutineCategory(categoryId);
  const Icon = ICONS[category.icon] ?? CircleEllipsis;
  if (!withSurface) return <Icon className={cn('h-4 w-4', className)} aria-hidden />;
  return (
    <span
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
      style={{ color: category.color, backgroundColor: category.surface }}
    >
      <Icon className={cn('h-[18px] w-[18px]', className)} aria-hidden />
    </span>
  );
}
