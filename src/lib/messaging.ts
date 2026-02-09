import { getMessaging, getToken, onMessage, type MessagePayload } from "firebase/messaging";
import { firebaseApp, firebaseConfig } from "@/lib/firebase";

const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";

export const firebaseMessagingMissingKeys = vapidKey
  ? []
  : ["NEXT_PUBLIC_FIREBASE_VAPID_KEY"];

export const messagingReady = Boolean(firebaseApp && vapidKey);

export const registerMessaging = async () => {
  if (!firebaseApp || !vapidKey) return null;
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;

  const registration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js"
  );
  const readyRegistration = await navigator.serviceWorker.ready;
  readyRegistration.active?.postMessage({
    type: "FIREBASE_CONFIG",
    config: firebaseConfig,
  });

  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  return token ?? null;
};

export const listenForForegroundMessages = (
  handler: (payload: MessagePayload) => void
) => {
  if (!firebaseApp || typeof window === "undefined") return () => {};
  const messaging = getMessaging(firebaseApp);
  return onMessage(messaging, handler);
};
