/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js");
importScripts(
  "https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js"
);

let firebaseInitialized = false;

const initFirebase = (config) => {
  if (firebaseInitialized) return;
  if (!config) return;
  firebase.initializeApp(config);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload?.notification?.title || "to day 알림";
    const body =
      payload?.notification?.body ||
      payload?.data?.body ||
      "기상 알림이 도착했어요.";
    self.registration.showNotification(title, { body });
  });
  firebaseInitialized = true;
};

self.addEventListener("message", (event) => {
  if (event?.data?.type === "FIREBASE_CONFIG") {
    initFirebase(event.data.config);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
