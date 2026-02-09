const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");

admin.initializeApp();

const db = admin.firestore();
const TIME_ZONE = process.env.TO_DAY_TIME_ZONE || "Asia/Seoul";

const getDateKey = (date) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
};

const getTimeHHMM = (date) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
};

const shouldDeleteToken = (error) => {
  const code = error?.errorInfo?.code || error?.code;
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
};

exports.sendWakeNotifications = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: TIME_ZONE,
  },
  async () => {
    const now = new Date();
    const nowTime = getTimeHHMM(now);
    const todayKey = getDateKey(now);

    const indexSnapshot = await db
      .collection("wakeTimeIndex")
      .doc(nowTime)
      .collection("users")
      .get();

    if (indexSnapshot.empty) {
      logger.info("No wake index users for this minute.");
      return;
    }

    const tasks = indexSnapshot.docs.map(async (indexDoc) => {
      const userId = indexDoc.id;
      if (!userId) return;

      const settingsRef = db
        .collection("users")
        .doc(userId)
        .collection("settings")
        .doc("main");
      const settingsSnap = await settingsRef.get();
      const data = settingsSnap.data() || {};
      const wakeTimes = Array.isArray(data.wakeTimes)
        ? data.wakeTimes
            .map((item) => {
              if (typeof item === "string") return item;
              if (typeof item?.time === "string") {
                const enabled =
                  typeof item?.enabled === "boolean" ? item.enabled : true;
                return enabled ? item.time : null;
              }
              return null;
            })
            .filter(Boolean)
        : [];
      const legacyWakeTime =
        typeof data.wakeTime === "string" ? data.wakeTime : null;
      if (wakeTimes.length === 0 && legacyWakeTime) {
        wakeTimes.push(legacyWakeTime);
      }
      const wakeEnabled =
        typeof data.wakeEnabled === "boolean" ? data.wakeEnabled : true;
      if (!wakeEnabled) return;
      if (!wakeTimes.includes(nowTime)) return;
      const wakeKey = `${todayKey}-${nowTime}`;
      if (data.lastWakeNotifiedKey === wakeKey) return;

      const tokensSnapshot = await db
        .collection("users")
        .doc(userId)
        .collection("pushTokens")
        .get();

      const tokens = tokensSnapshot.docs
        .map((tokenDoc) => tokenDoc.data()?.token)
        .filter(Boolean);

      if (tokens.length > 0) {
        const response = await admin.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: "기상 알림",
            body: `설정한 기상 시간(${nowTime})이에요.`,
          },
          data: {
            type: "wake",
            wakeTime: nowTime,
            dateKey: todayKey,
          },
        });

        const deletes = response.responses.map((item, index) => {
          if (!item.success && shouldDeleteToken(item.error)) {
            const tokenDoc = tokensSnapshot.docs[index];
            return tokenDoc.ref.delete();
          }
          return null;
        });

        await Promise.all(deletes.filter(Boolean));
        logger.info(`Wake notification sent: ${userId}`, {
          success: response.successCount,
          failure: response.failureCount,
        });
      }

      await settingsRef.set(
        {
          lastWakeNotifiedKey: wakeKey,
          wakeNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await Promise.all(tasks);
  }
);
