"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Bell,
  LayoutDashboard,
  Menu,
  MessageSquare,
  ShieldAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useChatOpen } from "@/hooks/use-chat-open";

interface MobileBottomNavProps {
  /** Opens the full navigation drawer (everything that doesn't fit the bar). */
  onOpenMenu: () => void;
  /** Counts come from the shell, which owns the single realtime subscription. */
  totalUnread: number;
  unreadNotifications: number;
}

/**
 * Thumb-reach tab bar for phones (hidden on lg+, where the sidebar is
 * always visible). Holds the five most-used destinations; the last tab
 * opens the full drawer. Steps aside while a conversation is open so the
 * composer gets the whole screen.
 */
export function MobileBottomNav({
  onOpenMenu,
  totalUnread,
  unreadNotifications,
}: MobileBottomNavProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const chatOpen = useChatOpen();
  const { canManageMembers } = useAuth();

  if (chatOpen) return null;

  const items = [
    { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, badge: 0 },
    { href: "/inbox", labelKey: "inbox", icon: MessageSquare, badge: totalUnread },
    canManageMembers
      ? { href: "/alerts", labelKey: "alerts", icon: ShieldAlert, badge: 0 }
      : { href: "/contacts", labelKey: "contacts", icon: Users, badge: 0 },
    {
      href: "/notifications",
      labelKey: "notifications",
      icon: Bell,
      badge: unreadNotifications,
    },
  ];

  const tabClass =
    "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2";

  return (
    <nav
      aria-label={t("mobileNav")}
      className="flex shrink-0 border-t border-border/60 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              tabClass,
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="relative">
              <item.icon className={cn("h-5 w-5", active && "text-primary")} />
              {item.badge > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-lime px-1 text-[10px] font-semibold text-lime-foreground"
                >
                  {item.badge > 9 ? "9+" : item.badge}
                </span>
              )}
            </span>
            <span className="max-w-full truncate">{t(item.labelKey)}</span>
            {active && (
              <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-lime" />
            )}
          </Link>
        );
      })}
      <button type="button" onClick={onOpenMenu} className={cn(tabClass, "text-muted-foreground")}>
        <Menu className="h-5 w-5" />
        <span>{t("more")}</span>
      </button>
    </nav>
  );
}
