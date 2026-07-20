import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, AlertCircle, AlertTriangle, Bell } from "lucide-react";
import type { Notification } from "@/api";
import { useNotificationsStore } from "./notifications-store";
import { notifTitle, notifBody } from "./notif-text";
import { cn } from "@/lib/cn";

const TOAST_TIMEOUT_MS: Record<Notification["priority"], number> = {
  critical: 20_000,
  warning: 10_000,
  info: 6_000,
};

interface VisibleToast {
  notification: Notification;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Ephemeral corner toast for freshly-arrived notifications. Reads from
 * the same `latest` slot in `useNotificationsStore` that `prepend` sets,
 * so every IPC `notification:new` event yields one visible toast. The
 * NotificationBell owns the persistent inbox; this component is only
 * for the pop-and-fade affordance.
 */
export function NotificationToaster(): JSX.Element {
  const { t } = useTranslation();
  const [visible, setVisible] = useState<VisibleToast[]>([]);
  const latest = useNotificationsStore((s) => s.latest);
  const clearLatest = useNotificationsStore((s) => s.clearLatest);
  const navigate = useNavigate();

  const dismiss = useCallback((id: string) => {
    setVisible((prev) => {
      const match = prev.find((t) => t.notification.id === id);
      if (match) clearTimeout(match.timer);
      return prev.filter((t) => t.notification.id !== id);
    });
  }, []);

  useEffect(() => {
    if (!latest) return;
    const timer = setTimeout(() => dismiss(latest.id), TOAST_TIMEOUT_MS[latest.priority]);
    setVisible((prev) => [...prev, { notification: latest, timer }]);
    clearLatest();
  }, [latest, clearLatest, dismiss]);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      setVisible((prev) => {
        for (const t of prev) clearTimeout(t.timer);
        return [];
      });
    };
  }, []);

  const handleClick = (n: Notification): void => {
    if (n.linkTo) {
      const route = n.linkTo.startsWith("#") ? n.linkTo.slice(1) : n.linkTo;
      navigate(route);
    }
    dismiss(n.id);
  };

  if (visible.length === 0) return <></>;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-[340px] flex-col gap-2">
      {visible.map(({ notification: n }) => (
        <div
          key={n.id}
          role="alert"
          className={cn(
            "pointer-events-auto overflow-hidden rounded-md border bg-card shadow-lg",
            n.priority === "critical" && "border-destructive/60",
            n.priority === "warning" && "border-warning/60",
            n.priority === "info" && "border-border",
          )}
        >
          <div className="flex gap-2 p-3">
            <span className="shrink-0 pt-0.5">
              {n.priority === "critical" && (
                <AlertCircle size={16} className="text-destructive" />
              )}
              {n.priority === "warning" && (
                <AlertTriangle size={16} className="text-warning" />
              )}
              {n.priority === "info" && (
                <Bell size={16} className="text-primary" />
              )}
            </span>
            <button
              type="button"
              onClick={() => handleClick(n)}
              className="min-w-0 flex-1 cursor-pointer text-left"
            >
              <p className="text-sm font-medium text-foreground">{notifTitle(n, t)}</p>
              {notifBody(n, t) && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-3">
                  {notifBody(n, t)}
                </p>
              )}
            </button>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
