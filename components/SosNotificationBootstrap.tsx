import { useDriver } from '@/context/DriverContext';
import { parseIncomingSosAlert } from '@/lib/sosAlert';
import { loadNotifications } from '@/services/notificationService';
import { useSafeEffect } from '@/hooks/useSafeEffect';

/** Wires SOS push notification taps / cold-start opens to the SOS map screen. */
export function SosNotificationBootstrap() {
  const { handleSosNotificationOpen } = useDriver();

  useSafeEffect(() => {
    const Notifications = loadNotifications();
    if (!Notifications) return;

    const openFromData = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      const alert = parseIncomingSosAlert(data);
      if (!alert) return;
      handleSosNotificationOpen(alert);
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromData(response.notification.request.content.data as Record<string, unknown>);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      openFromData(response.notification.request.content.data as Record<string, unknown>);
    });

    return () => sub.remove();
  }, [handleSosNotificationOpen], 'SosNotificationBootstrap');

  return null;
}
