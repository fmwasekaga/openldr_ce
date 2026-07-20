import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Notification } from "@/api";
import { listNotifications, markNotificationsRead, markAllNotificationsRead } from "@/api";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotificationsStore } from "./notifications-store";
import { cn } from "@/lib/cn";

function priorityTone(priority: Notification["priority"]): string {
  switch (priority) {
    case "critical":
      return "border-l-destructive";
    case "warning":
      return "border-l-warning";
    default:
      return "border-l-primary";
  }
}

export function NotificationBell(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    setAll,
    markRead,
    markAllRead,
  } = useNotificationsStore();

  // Initial load + polling. Electron's IPC push (window.api.notifications.onNew)
  // has no HTTP equivalent, so we poll on an interval and refresh on focus/visibility.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void listNotifications({ limit: 50, unreadOnly: true }).then((res) => {
        if (!cancelled) setAll(res.notifications ?? [], res.unreadCount ?? 0);
      }).catch(() => { /* keep last-known feed */ });
    };
    load();
    const interval = setInterval(load, 45_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', onVis); };
  }, [setAll]);

  const handleOpen = async (n: Notification): Promise<void> => {
    if (!n.readAt) {
      markRead([n.id]);
      void markNotificationsRead([n.id]);
    }
    setOpen(false);
    if (n.linkTo) {
      const route = n.linkTo.startsWith("#") ? n.linkTo.slice(1) : n.linkTo;
      navigate(route);
    }
  };

  const handleMarkAll = async (): Promise<void> => {
    markAllRead();
    void markAllNotificationsRead();
  };

  const handleViewAll = (): void => {
    setOpen(false);
    navigate("/notifications");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={t("notifications.ariaOpen")}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <Badge
              className={cn(
                "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium",
                "bg-destructive text-destructive-foreground",
              )}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-95 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">
            {t("notifications.title")}
            {unreadCount > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                ({unreadCount} {t("notifications.unread")})
              </span>
            )}
          </span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleMarkAll()}
            >
              {t("notifications.markAllRead")}
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-muted-foreground">
            {t("notifications.empty")}
          </div>
        ) : (
          <div className="max-h-105 overflow-y-auto">
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "cursor-pointer border-l-2 px-3 py-2.5 transition-colors hover:bg-muted/40",
                    priorityTone(n.priority),
                    !n.readAt && "bg-muted/20",
                  )}
                  onClick={() => void handleOpen(n)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        "text-sm text-foreground",
                        !n.readAt && "font-medium",
                      )}
                    >
                      {n.title}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {n.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-border px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-center text-xs"
            onClick={handleViewAll}
          >
            {t("notifications.history.viewAll")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
