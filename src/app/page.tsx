"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db, firebaseConfigMissingKeys } from "@/lib/firebase";
import {
  firebaseMessagingMissingKeys,
  listenForForegroundMessages,
  messagingReady,
  registerMessaging,
} from "@/lib/messaging";
import {
  formatDateKey,
  getCalendarMatrix,
  getLocalDateKey,
  getMonthEndKey,
  getMonthKey,
  getMonthStartKey,
  getYesterdayKey,
  parseTimeToMinutes,
} from "@/lib/date";
import { getIconForRoutine } from "@/lib/routine-icons";
import { Effect, EffectType } from "@/types/effect";
import {
  applyEffectByUserType,
  effectReducer,
  initialEffectState,
} from "@/store/effectReducer";
import { MissedReasonType } from "@/types/missed-reason";

const USER_TYPES = ["neutral"] as const;
type UserType = (typeof USER_TYPES)[number];
const DEFAULT_USER_TYPE: UserType = "neutral";
const isUserType = (value: unknown): value is UserType =>
  USER_TYPES.includes(value as UserType);

type Settings = {
  userType: UserType;
  wakeTime: string;
  wakeEnabled?: boolean;
  wakeConsent?: boolean;
  wakeTimes?: WakeAlarm[];
  protectEnabled: boolean;
  protectStart: string;
  protectEnd: string;
  distractionApps?: DistractionApp[];
  wakeRoutine?: RoutineItem[];
};

type DayLog = {
  did: string;
  learned: string;
  reviewedAt?: unknown | null;
};

type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  effects?: Effect[];
  createdAt?: unknown;
  completedAt?: unknown;
  dueAt?: unknown;
  missedReasonType?: MissedReasonType;
};

type CalendarEvent = {
  id: string;
  title: string;
  dateKey: string;
  time: string;
  createdAt?: unknown;
};

type TabKey = "home" | "wake" | "shield" | "log" | "calendar" | "todos";

type DistractionApp = {
  id: string;
  label: string;
  minutes: number;
};

type RoutineItem = {
  id: string;
  text: string;
};

type WakeAlarm = {
  id: string;
  time: string;
  enabled: boolean;
};

const defaultSettings: Settings = {
  userType: DEFAULT_USER_TYPE,
  wakeTime: "07:00",
  wakeEnabled: true,
  wakeConsent: false,
  wakeTimes: [{ id: "default", time: "07:00", enabled: true }],
  protectEnabled: true,
  protectStart: "07:00",
  protectEnd: "12:00",
  wakeRoutine: [],
  distractionApps: [
    { id: "insta", label: "인스타그램", minutes: 5 },
    { id: "youtube", label: "유튜브", minutes: 5 },
    { id: "kakao", label: "카카오톡", minutes: 5 },
  ],
};

const EFFECT_OPTIONS: Array<{
  type: EffectType;
  label: string;
  description: string;
}> = [
  {
    type: EffectType.CLARITY,
    label: "정리됨",
    description: "머리가 정리되고 생각이 명확해짐",
  },
  {
    type: EffectType.MOMENTUM,
    label: "관성",
    description: "다음 행동이 쉬워지는 흐름",
  },
  {
    type: EffectType.RELIEF,
    label: "가벼움",
    description: "부담이 줄고 마음이 놓임",
  },
  {
    type: EffectType.DISCIPLINE,
    label: "통제감",
    description: "자기관리와 규칙감이 생김",
  },
  {
    type: EffectType.CONFIDENCE,
    label: "확신",
    description: "할 수 있다는 느낌이 커짐",
  },
  {
    type: EffectType.FOCUS,
    label: "몰입",
    description: "산만함이 줄고 집중됨",
  },
  {
    type: EffectType.ENERGY,
    label: "에너지",
    description: "힘이 회복되거나 올라감",
  },
  {
    type: EffectType.FAITH,
    label: "의미",
    description: "방향성과 가치가 선명해짐",
  },
];

const EFFECT_INTENSITIES = [1, 2, 3] as const;
const INTENSITY_LABELS: Record<Effect["intensity"], string> = {
  1: "약",
  2: "중",
  3: "강",
};
const MISSED_REASON_LABELS: Record<MissedReasonType, string> = {
  [MissedReasonType.FORGOT]: "잊어버림",
  [MissedReasonType.HARD_TO_START]: "시작이 어려움",
  [MissedReasonType.TOO_BIG]: "너무 큼",
  [MissedReasonType.EMOTIONALLY_HEAVY]: "감정적으로 부담",
  [MissedReasonType.TIME_MISMATCH]: "시간이 안 맞음",
  [MissedReasonType.JUST_SKIP]: "그냥 건너뜀",
};
const AI_ELIGIBLE_REASONS = new Set<MissedReasonType>([
  MissedReasonType.HARD_TO_START,
  MissedReasonType.TOO_BIG,
  MissedReasonType.EMOTIONALLY_HEAVY,
]);

const toMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTimestamp.toDate === "function") {
      return maybeTimestamp.toDate().getTime();
    }
    if (typeof maybeTimestamp.seconds === "number") {
      return maybeTimestamp.seconds * 1000;
    }
  }
  return null;
};

const getWakeTimes = (alarms: WakeAlarm[] | undefined) =>
  (Array.isArray(alarms) ? alarms : [])
    .filter((alarm) => alarm.enabled)
    .map((alarm) => (typeof alarm?.time === "string" ? alarm.time : ""))
    .map((time) => time.trim())
    .filter(Boolean);

const getUniqueWakeTimes = (alarms: WakeAlarm[] | undefined) =>
  Array.from(new Set(getWakeTimes(alarms)));

const normalizeWakeTimes = (alarms: WakeAlarm[] | undefined) => {
  const seen = new Set<string>();
  return (Array.isArray(alarms) ? alarms : [])
    .map((alarm) => ({
      id: alarm?.id ?? `${Date.now()}`,
      time: typeof alarm?.time === "string" ? alarm.time.trim() : "",
      enabled: typeof alarm?.enabled === "boolean" ? alarm.enabled : true,
    }))
    .filter((alarm) => alarm.time)
    .filter((alarm) => {
      if (seen.has(alarm.time)) return false;
      seen.add(alarm.time);
      return true;
    });
};

type HomeLogic = {
  greetingText: string;
  todayEvents: CalendarEvent[];
};

type TodoLogic = {
  pendingTodos: TodoItem[];
  todoCompletedCount: number;
  completionRate: number;
};

type LogLogic = {
  needsReview: boolean;
  hasTodayLog: boolean;
};

type ProtectLogic = {
  protectStartMinutes: number;
  protectEndMinutes: number;
  protectActive: boolean;
  protectRemainingMinutes: number | null;
  protectDetailText: string;
};

const formatMinutes = (minutes: number) => {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  if (hours === 0) return `${rest}분`;
  if (rest === 0) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
};

const getGreetingText = (nowMinutes: number) => {
  const hour = Math.floor(nowMinutes / 60);
  if (hour < 6) return "고요한 새벽이에요";
  if (hour < 12) return "좋은 아침이에요";
  if (hour < 18) return "좋은 오후예요";
  return "편안한 저녁이에요";
};

const getHomeLogic = (
  userType: UserType,
  args: { nowMinutes: number; todayEvents: CalendarEvent[] }
): HomeLogic => {
  switch (userType) {
    case "neutral":
    default:
      return {
        greetingText: getGreetingText(args.nowMinutes),
        todayEvents: args.todayEvents,
      };
  }
};

const getTodoLogic = (
  userType: UserType,
  args: { todos: TodoItem[] }
): TodoLogic => {
  switch (userType) {
    case "neutral":
    default: {
      const todoCompletedCount = args.todos.filter((todo) => todo.done).length;
      const completionRate = args.todos.length
        ? Math.round((todoCompletedCount / args.todos.length) * 100)
        : 0;
      const pendingTodos = args.todos.filter((todo) => !todo.done);
      return { pendingTodos, todoCompletedCount, completionRate };
    }
  }
};

const getLogLogic = (
  userType: UserType,
  args: { todayLog: DayLog; yesterdayLog: DayLog | null; yesterdayExists: boolean }
): LogLogic => {
  switch (userType) {
    case "neutral":
    default:
      return {
        needsReview: args.yesterdayExists && !args.yesterdayLog?.reviewedAt,
        hasTodayLog: Boolean(
          args.todayLog.did.trim() || args.todayLog.learned.trim()
        ),
      };
  }
};

const getProtectLogic = (
  userType: UserType,
  args: { settings: Settings; nowMinutes: number }
): ProtectLogic => {
  switch (userType) {
    case "neutral":
    default: {
      const protectStartMinutes =
        parseTimeToMinutes(args.settings.protectStart) ?? 0;
      const protectEndMinutes =
        parseTimeToMinutes(args.settings.protectEnd) ?? 12 * 60;
      const protectActive =
        args.settings.protectEnabled &&
        args.nowMinutes >= protectStartMinutes &&
        args.nowMinutes < protectEndMinutes;
      const protectRemainingMinutes = protectActive
        ? protectEndMinutes - args.nowMinutes
        : args.nowMinutes < protectStartMinutes
          ? protectStartMinutes - args.nowMinutes
          : null;
      const protectDetailText = protectActive
        ? `종료까지 ${formatMinutes(protectRemainingMinutes ?? 0)}`
        : protectRemainingMinutes !== null
          ? `시작까지 ${formatMinutes(protectRemainingMinutes)}`
          : "오늘 보호 시간이 끝났어요";
      return {
        protectStartMinutes,
        protectEndMinutes,
        protectActive,
        protectRemainingMinutes,
        protectDetailText,
      };
    }
  }
};

export default function Home() {
  const provider = useMemo(() => new GoogleAuthProvider(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState<Settings>(defaultSettings);
  const [todayLog, setTodayLog] = useState<DayLog>({ did: "", learned: "" });
  const [todayDraft, setTodayDraft] = useState<DayLog>({ did: "", learned: "" });
  const [yesterdayLog, setYesterdayLog] = useState<DayLog | null>(null);
  const [yesterdayExists, setYesterdayExists] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [newTodoDueAt, setNewTodoDueAt] = useState("");
  const [todayKey, setTodayKey] = useState(getLocalDateKey());
  const [yesterdayKey, setYesterdayKey] = useState(getYesterdayKey());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<Record<string, CalendarEvent[]>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<DayLog | null>(null);
  const [selectedLogExists, setSelectedLogExists] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventTime, setNewEventTime] = useState("09:00");
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [pendingAppId, setPendingAppId] = useState<string | null>(null);
  const [pendingMinutes, setPendingMinutes] = useState(5);
  const [distractionApps, setDistractionApps] = useState<DistractionApp[]>(
    defaultSettings.distractionApps ?? []
  );
  const [newAppLabel, setNewAppLabel] = useState("");
  const [newRoutineText, setNewRoutineText] = useState("");
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerApp, setTimerApp] = useState<string | null>(null);
  const [timerFinished, setTimerFinished] = useState(false);
  const bodyOverflowRef = useRef<string | null>(null);
  const timerNotifiedRef = useRef(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [wakeSaved, setWakeSaved] = useState(false);
  const [routineSaved, setRoutineSaved] = useState(false);
  const [wakeReminder, setWakeReminder] = useState<string | null>(null);
  const wakeSaveTimeoutRef = useRef<number | null>(null);
  const routineSaveTimeoutRef = useRef<number | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [wakeConsent, setWakeConsent] = useState(false);
  const [effectState, dispatchEffect] = useReducer(
    effectReducer,
    initialEffectState
  );
  const [effectModalTodo, setEffectModalTodo] = useState<TodoItem | null>(null);
  const [effectSelections, setEffectSelections] = useState<
    Record<EffectType, Effect["intensity"]>
  >({});
  const [todoAIResults, setTodoAIResults] = useState<
    Record<
      string,
      { reflectionQuestions: string[]; rewrittenTodo: string }
    >
  >({});
  const [todoAILoading, setTodoAILoading] = useState<Record<string, boolean>>(
    {}
  );
  const [todoAIError, setTodoAIError] = useState<Record<string, string>>({});

  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

  const userType = settings.userType ?? defaultSettings.userType;
  const firebaseReady = Boolean(auth && db);
  const isTimerActive = timerSeconds !== null;
  const monthKey = getMonthKey(currentMonth);
  const modalOpen = Boolean(
    pendingAppId || selectedDate || isTimerActive || effectModalTodo
  );
  const selectedEffectCount = Object.keys(effectSelections).length;
  const todayEffectCount = effectState.byDate[todayKey]?.length ?? 0;
  const todayEvents = events[todayKey] ?? [];
  const homeLogic = useMemo(
    () => getHomeLogic(userType, { nowMinutes, todayEvents }),
    [userType, nowMinutes, todayEvents]
  );
  const todoLogic = useMemo(
    () => getTodoLogic(userType, { todos }),
    [userType, todos]
  );
  const logLogic = useMemo(
    () => getLogLogic(userType, { todayLog, yesterdayLog, yesterdayExists }),
    [userType, todayLog, yesterdayLog, yesterdayExists]
  );
  const protectLogic = useMemo(
    () => getProtectLogic(userType, { settings, nowMinutes }),
    [userType, settings, nowMinutes]
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
      const latestToday = getLocalDateKey(now);
      if (latestToday !== todayKey) {
        setTodayKey(latestToday);
        setYesterdayKey(getYesterdayKey(now));
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [todayKey]);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      setUser(null);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setSettingsDraft(settings);
  }, [settings]);

  useEffect(() => {
    if (!wakeSaved) return;
    if (wakeSaveTimeoutRef.current) {
      window.clearTimeout(wakeSaveTimeoutRef.current);
    }
    wakeSaveTimeoutRef.current = window.setTimeout(() => {
      setWakeSaved(false);
    }, 2000);
    return () => {
      if (wakeSaveTimeoutRef.current) {
        window.clearTimeout(wakeSaveTimeoutRef.current);
      }
    };
  }, [wakeSaved]);

  useEffect(() => {
    if (!routineSaved) return;
    if (routineSaveTimeoutRef.current) {
      window.clearTimeout(routineSaveTimeoutRef.current);
    }
    routineSaveTimeoutRef.current = window.setTimeout(() => {
      setRoutineSaved(false);
    }, 2000);
    return () => {
      if (routineSaveTimeoutRef.current) {
        window.clearTimeout(routineSaveTimeoutRef.current);
      }
    };
  }, [routineSaved]);

  useEffect(() => {
    setTodayDraft(todayLog);
  }, [todayLog]);

  useEffect(() => {
    if (!user || !db) {
      setSettings(defaultSettings);
      setSettingsDraft(defaultSettings);
      setTodayLog({ did: "", learned: "" });
      setTodayDraft({ did: "", learned: "" });
      setYesterdayLog(null);
      setYesterdayExists(false);
      setTodos([]);
      return;
    }

    const settingsRef = doc(db, "users", user.uid, "settings", "main");
    const todayRef = doc(db, "users", user.uid, "days", todayKey);
    const yesterdayRef = doc(db, "users", user.uid, "days", yesterdayKey);
    const todosRef = collection(db, "users", user.uid, "days", todayKey, "todos");
    const todosQuery = query(todosRef, orderBy("createdAt", "asc"));

    const unsubscribeSettings = onSnapshot(settingsRef, (snapshot) => {
      if (!snapshot.exists()) {
        setDoc(settingsRef, defaultSettings, { merge: true });
        setSettings(defaultSettings);
        return;
      }
      const data = snapshot.data() as Partial<Settings>;
      const nextUserType = isUserType(data.userType)
        ? data.userType
        : defaultSettings.userType;
      const nextRoutine =
        Array.isArray(data.wakeRoutine) && data.wakeRoutine.length > 0
          ? data.wakeRoutine
              .map((item, index) => {
                if (typeof item === "string") {
                  return { id: `${Date.now()}-${index}`, text: item };
                }
                const text =
                  typeof item?.text === "string" ? item.text.trim() : "";
                if (!text) return null;
                const id =
                  typeof item?.id === "string" && item.id
                    ? item.id
                    : `${Date.now()}-${index}`;
                return { id, text };
              })
              .filter((item): item is RoutineItem => Boolean(item))
          : [];
      const nextApps =
        Array.isArray(data.distractionApps) && data.distractionApps.length > 0
          ? data.distractionApps.map((app) => ({
              id: app.id ?? `${Date.now()}`,
              label: app.label ?? "앱",
              minutes:
                typeof app.minutes === "number" && app.minutes > 0
                  ? app.minutes
                  : 5,
            }))
          : defaultSettings.distractionApps ?? [];
      const nextWakeTimes = (() => {
        if (Array.isArray(data.wakeTimes) && data.wakeTimes.length > 0) {
          const mapped = data.wakeTimes.map((item, index): WakeAlarm | null => {
            if (typeof item === "string") {
              return { id: `${Date.now()}-${index}`, time: item, enabled: true };
            }
            const time = typeof item?.time === "string" ? item.time.trim() : "";
            if (!time) return null;
            const id =
              typeof item?.id === "string" && item.id
                ? item.id
                : `${Date.now()}-${index}`;
            return {
              id,
              time,
              enabled: typeof item?.enabled === "boolean" ? item.enabled : true,
            };
          });
          const filtered = mapped.filter(
            (item): item is WakeAlarm => Boolean(item)
          );
          if (filtered.length > 0) {
            const seen = new Set<string>();
            return filtered.filter((item) => {
              if (seen.has(item.time)) return false;
              seen.add(item.time);
              return true;
            });
          }
        }
        const legacyWakeTime =
          typeof data.wakeTime === "string"
            ? data.wakeTime
            : defaultSettings.wakeTime;
        return [
          {
            id: `${Date.now()}-0`,
            time: legacyWakeTime,
            enabled: true,
          },
        ];
      })();
      const primaryWakeTime =
        nextWakeTimes[0]?.time ?? defaultSettings.wakeTime;
      setSettings({
        userType: nextUserType,
        wakeTime: primaryWakeTime,
        wakeEnabled:
          typeof data.wakeEnabled === "boolean"
            ? data.wakeEnabled
            : nextWakeTimes.length > 0,
        wakeConsent: data.wakeConsent ?? defaultSettings.wakeConsent,
        wakeTimes: nextWakeTimes,
        protectEnabled: data.protectEnabled ?? defaultSettings.protectEnabled,
        protectStart:
          data.protectStart ??
          primaryWakeTime ??
          defaultSettings.protectStart,
        protectEnd: data.protectEnd ?? defaultSettings.protectEnd,
        wakeRoutine: nextRoutine,
        distractionApps: nextApps,
      });
      setWakeConsent(
        Boolean(data.wakeConsent ?? defaultSettings.wakeConsent ?? false)
      );
      setSettingsDraft((prev) => ({
        ...prev,
        userType: nextUserType,
        wakeEnabled:
          typeof data.wakeEnabled === "boolean"
            ? data.wakeEnabled
            : nextWakeTimes.length > 0,
        wakeConsent: data.wakeConsent ?? defaultSettings.wakeConsent,
        wakeRoutine: nextRoutine,
        wakeTimes: nextWakeTimes,
        wakeTime: primaryWakeTime,
      }));
      setDistractionApps(nextApps);
    });

    const unsubscribeToday = onSnapshot(todayRef, (snapshot) => {
      if (!snapshot.exists()) {
        setTodayLog({ did: "", learned: "" });
        return;
      }
      const data = snapshot.data() as Partial<DayLog>;
      setTodayLog({
        did: data.did ?? "",
        learned: data.learned ?? "",
        reviewedAt: data.reviewedAt ?? null,
      });
    });

    const unsubscribeYesterday = onSnapshot(yesterdayRef, (snapshot) => {
      if (!snapshot.exists()) {
        setYesterdayLog(null);
        setYesterdayExists(false);
        return;
      }
      const data = snapshot.data() as Partial<DayLog>;
      setYesterdayLog({
        did: data.did ?? "",
        learned: data.learned ?? "",
        reviewedAt: data.reviewedAt ?? null,
      });
      setYesterdayExists(true);
    });

    const unsubscribeTodos = onSnapshot(todosQuery, (snapshot) => {
      const nextTodos = snapshot.docs.map((item) => {
        const data = item.data() as Omit<TodoItem, "id">;
        return {
          id: item.id,
          text: data.text ?? "",
          done: Boolean(data.done),
          effects: Array.isArray(data.effects) ? data.effects : [],
          createdAt: data.createdAt,
          completedAt: data.completedAt,
          dueAt: data.dueAt,
          missedReasonType: data.missedReasonType,
        };
      });
      setTodos(nextTodos);
    });

    return () => {
      unsubscribeSettings();
      unsubscribeToday();
      unsubscribeYesterday();
      unsubscribeTodos();
    };
  }, [user, todayKey, yesterdayKey]);

  useEffect(() => {
    if (!user || !db) {
      setEvents({});
      return;
    }
    const monthStart = getMonthStartKey(currentMonth);
    const monthEnd = getMonthEndKey(currentMonth);
    const eventsRef = collection(db, "users", user.uid, "events");
    const eventsQuery = query(
      eventsRef,
      orderBy("dateKey", "asc"),
      orderBy("time", "asc")
    );
    const unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
      const nextEvents: Record<string, CalendarEvent[]> = {};
      snapshot.docs.forEach((item) => {
        const data = item.data() as Omit<CalendarEvent, "id">;
        if (data.dateKey < monthStart || data.dateKey > monthEnd) return;
        if (!nextEvents[data.dateKey]) {
          nextEvents[data.dateKey] = [];
        }
        nextEvents[data.dateKey].push({
          id: item.id,
          title: data.title ?? "",
          dateKey: data.dateKey ?? "",
          time: data.time ?? "",
          createdAt: data.createdAt,
        });
      });
      setEvents(nextEvents);
    });
    return () => unsubscribeEvents();
  }, [user, db, monthKey]);

  useEffect(() => {
    if (!selectedDate || !user || !db) {
      setSelectedLog(null);
      setSelectedLogExists(false);
      return;
    }
    const selectedRef = doc(db, "users", user.uid, "days", selectedDate);
    const unsubscribeSelected = onSnapshot(selectedRef, (snapshot) => {
      if (!snapshot.exists()) {
        setSelectedLog(null);
        setSelectedLogExists(false);
        return;
      }
      const data = snapshot.data() as Partial<DayLog>;
      setSelectedLog({
        did: data.did ?? "",
        learned: data.learned ?? "",
        reviewedAt: data.reviewedAt ?? null,
      });
      setSelectedLogExists(true);
    });
    return () => unsubscribeSelected();
  }, [selectedDate, user, db]);

  useEffect(() => {
    if (!isTimerActive) return;
    const interval = setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev === null) return null;
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerActive]);

  useEffect(() => {
    if (timerSeconds === 0) {
      setTimerFinished(true);
    }
  }, [timerSeconds]);

  useEffect(() => {
    if (timerSeconds === null) {
      timerNotifiedRef.current = false;
      return;
    }
    if (timerSeconds > 0) {
      timerNotifiedRef.current = false;
      return;
    }
    if (timerNotifiedRef.current) return;
    timerNotifiedRef.current = true;
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification("타이머 종료", {
        body: `${timerApp ?? "보호 시간"} 타이머가 끝났어요.`,
      });
    } catch {
      // ignore notification failures (e.g., blocked by browser)
    }
  }, [timerSeconds, timerApp]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (bodyOverflowRef.current === null) {
      bodyOverflowRef.current = document.body.style.overflow || "";
    }
    document.body.style.overflow = modalOpen
      ? "hidden"
      : bodyOverflowRef.current;
    return () => {
      if (bodyOverflowRef.current !== null) {
        document.body.style.overflow = bodyOverflowRef.current;
      }
    };
  }, [modalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined" || !buildTime) return;
    const storageKey = "to-day-build-time";
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && stored !== buildTime) {
        setUpdateAvailable(true);
      }
      localStorage.setItem(storageKey, buildTime);
    } catch {
      // ignore storage failures
    }
  }, [buildTime]);

  useEffect(() => {
    return listenForForegroundMessages((payload) => {
      const body =
        payload.notification?.body ||
        payload.data?.body ||
        "알림이 도착했어요.";
      setWakeReminder(body);
    });
  }, []);

  const wakeTimesLabel = (() => {
    const times = getWakeTimes(settings.wakeTimes);
    if (times.length === 0) return "없음";
    if (times.length === 1) return times[0];
    return `${times[0]} 외 ${times.length - 1}개`;
  })();

  const handleSignIn = async () => {
    if (!auth) return;
    setAuthError("");
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      try {
        await signInWithRedirect(auth, provider);
      } catch {
        setAuthError("로그인에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const handleAddWakeTime = () => {
    setSettingsDraft((prev) => {
      const current = prev.wakeTimes ?? [];
      const fallbackTime = current[0]?.time ?? defaultSettings.wakeTime;
      return {
        ...prev,
        wakeTimes: [
          ...current,
          { id: `${Date.now()}`, time: fallbackTime, enabled: true },
        ],
      };
    });
  };

  const handleUpdateWakeTime = (id: string, time: string) => {
    setSettingsDraft((prev) => ({
      ...prev,
      wakeTimes: (prev.wakeTimes ?? []).map((alarm) =>
        alarm.id === id ? { ...alarm, time } : alarm
      ),
    }));
  };

  const handleToggleWakeTime = (id: string) => {
    setSettingsDraft((prev) => ({
      ...prev,
      wakeTimes: (prev.wakeTimes ?? []).map((alarm) =>
        alarm.id === id ? { ...alarm, enabled: !alarm.enabled } : alarm
      ),
    }));
  };

  const handleRemoveWakeTime = (id: string) => {
    setSettingsDraft((prev) => ({
      ...prev,
      wakeTimes: (prev.wakeTimes ?? []).filter((alarm) => alarm.id !== id),
    }));
  };

  const handleSaveWakeSettings = async () => {
    if (!user || !db) return;
    const firestore = db;
    const userId = user.uid;
    const settingsRef = doc(firestore, "users", userId, "settings", "main");
    const previousWakeTimes = getUniqueWakeTimes(settings.wakeTimes);
    const nextWakeTimes = getUniqueWakeTimes(settingsDraft.wakeTimes);
    const wakeTimesToSave = normalizeWakeTimes(settingsDraft.wakeTimes);
    const primaryWakeTime = nextWakeTimes[0] ?? defaultSettings.wakeTime;
    const nextWakeEnabled = nextWakeTimes.length > 0;
    await setDoc(
      settingsRef,
      {
        wakeTime: primaryWakeTime,
        wakeEnabled: nextWakeEnabled,
        wakeTimes: wakeTimesToSave,
        protectEnabled: settingsDraft.protectEnabled,
        protectStart: settingsDraft.protectStart,
        protectEnd: settingsDraft.protectEnd,
      },
      { merge: true }
    );
    const previousIndexTimes =
      previousWakeTimes.length > 0
        ? previousWakeTimes
        : settings.wakeTime
          ? [settings.wakeTime]
          : [];
    await Promise.all(
      previousIndexTimes.map((time) =>
        deleteDoc(doc(firestore, "wakeTimeIndex", time, "users", userId))
      )
    );
    if (nextWakeEnabled) {
      await Promise.all(
        nextWakeTimes.map((time) =>
          setDoc(
            doc(firestore, "wakeTimeIndex", time, "users", userId),
            { userId, wakeTime: time, updatedAt: serverTimestamp() },
            { merge: true }
          )
        )
      );
    }
    setWakeSaved(true);
  };

  const handleSaveWakeRoutine = async () => {
    if (!user || !db) return;
    const settingsRef = doc(db, "users", user.uid, "settings", "main");
    await setDoc(
      settingsRef,
      {
        wakeRoutine: settingsDraft.wakeRoutine ?? [],
      },
      { merge: true }
    );
    setRoutineSaved(true);
  };

  const saveDistractionApps = async (apps: DistractionApp[]) => {
    if (!user || !db) return;
    const settingsRef = doc(db, "users", user.uid, "settings", "main");
    await setDoc(
      settingsRef,
      {
        distractionApps: apps,
      },
      { merge: true }
    );
  };

  const handleSaveLog = async () => {
    if (!user || !db) return;
    const todayRef = doc(db, "users", user.uid, "days", todayKey);
    await setDoc(
      todayRef,
      {
        did: todayDraft.did,
        learned: todayDraft.learned,
        date: todayKey,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const handleReviewComplete = async () => {
    if (!user || !db || !yesterdayExists) return;
    const yesterdayRef = doc(db, "users", user.uid, "days", yesterdayKey);
    await updateDoc(yesterdayRef, { reviewedAt: serverTimestamp() });
  };

  const handleAddTodo = async () => {
    if (!user || !db || !newTodo.trim()) return;
    const todosRef = collection(db, "users", user.uid, "days", todayKey, "todos");
    const dueAtValue = newTodoDueAt ? new Date(newTodoDueAt) : null;
    await addDoc(todosRef, {
      text: newTodo.trim(),
      done: false,
      effects: [],
      completedAt: null,
      dueAt: dueAtValue,
      createdAt: serverTimestamp(),
    });
    setNewTodo("");
    setNewTodoDueAt("");
  };

  const handleToggleTodo = async (todo: TodoItem) => {
    if (!user || !db) return;
    if (!todo.done) {
      setEffectSelections({});
      setEffectModalTodo(todo);
      return;
    }
    const todoRef = doc(
      db,
      "users",
      user.uid,
      "days",
      todayKey,
      "todos",
      todo.id
    );
    await updateDoc(todoRef, { done: false, completedAt: null, effects: [] });
  };

  const toggleEffectType = (type: EffectType) => {
    setEffectSelections((prev) => {
      if (prev[type]) {
        const next = { ...prev };
        delete next[type];
        return next;
      }
      if (Object.keys(prev).length >= 2) return prev;
      return { ...prev, [type]: 2 };
    });
  };

  const updateEffectIntensity = (type: EffectType, intensity: 1 | 2 | 3) => {
    setEffectSelections((prev) => {
      if (!prev[type]) return prev;
      return { ...prev, [type]: intensity };
    });
  };

  const closeEffectModal = () => {
    setEffectModalTodo(null);
    setEffectSelections({});
  };

  const handleConfirmEffects = async () => {
    if (!user || !db || !effectModalTodo) return;
    const selectedEffects = Object.entries(effectSelections).map(
      ([type, intensity]) =>
        ({
          type: type as EffectType,
          intensity,
        }) as Effect
    );
    if (selectedEffects.length === 0) return;
    const effects = applyEffectByUserType(userType, selectedEffects);
    const todoRef = doc(
      db,
      "users",
      user.uid,
      "days",
      todayKey,
      "todos",
      effectModalTodo.id
    );
    await updateDoc(todoRef, {
      done: true,
      effects,
      completedAt: serverTimestamp(),
    });
    dispatchEffect({
      type: "ADD_EFFECTS",
      payload: {
        date: todayKey,
        effects,
      },
    });
    closeEffectModal();
  };

  const handleDeleteTodo = async (todo: TodoItem) => {
    if (!user || !db) return;
    const todoRef = doc(
      db,
      "users",
      user.uid,
      "days",
      todayKey,
      "todos",
      todo.id
    );
    await deleteDoc(todoRef);
  };

  const handleUpdateMissedReason = async (
    todo: TodoItem,
    reasonType: MissedReasonType
  ) => {
    if (!user || !db) return;
    const todoRef = doc(
      db,
      "users",
      user.uid,
      "days",
      todayKey,
      "todos",
      todo.id
    );
    await updateDoc(todoRef, { missedReasonType: reasonType });
  };

  const handleGenerateReasonHelp = async (todo: TodoItem) => {
    const dueAtMillis = toMillis(todo.dueAt);
    const reasonType = todo.missedReasonType;
    if (
      todo.done ||
      !dueAtMillis ||
      dueAtMillis >= Date.now() ||
      !reasonType ||
      !AI_ELIGIBLE_REASONS.has(reasonType)
    ) {
      return;
    }
    setTodoAILoading((prev) => ({ ...prev, [todo.id]: true }));
    setTodoAIError((prev) => ({ ...prev, [todo.id]: "" }));
    const result = await (async () => {
      try {
        const response = await fetch("/api/ai/rewrite-todo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originalTodoText: todo.text,
            reasonType:
              reasonType === MissedReasonType.HARD_TO_START
                ? "HARD_TO_START"
                : reasonType === MissedReasonType.TOO_BIG
                  ? "TOO_BIG"
                  : "EMOTIONALLY_HEAVY",
          }),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as {
          result?: {
            reflectionQuestions: string[];
            rewrittenTodo: string;
          } | null;
        };
        return data.result ?? null;
      } catch {
        return null;
      }
    })();
    if (!result) {
      setTodoAIError((prev) => ({
        ...prev,
        [todo.id]: "AI 생성에 실패했어요. 다시 시도해 주세요.",
      }));
    } else {
      setTodoAIResults((prev) => ({ ...prev, [todo.id]: result }));
    }
    setTodoAILoading((prev) => ({ ...prev, [todo.id]: false }));
  };

  const clearTodoAIResult = (todoId: string) => {
    setTodoAIResults((prev) => {
      if (!prev[todoId]) return prev;
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
    setTodoAIError((prev) => {
      if (!prev[todoId]) return prev;
      const next = { ...prev };
      delete next[todoId];
      return next;
    });
  };

  const handleReplaceTodoText = async (todo: TodoItem, nextText: string) => {
    if (!user || !db || !nextText.trim()) return;
    const todoRef = doc(
      db,
      "users",
      user.uid,
      "days",
      todayKey,
      "todos",
      todo.id
    );
    await updateDoc(todoRef, {
      text: nextText.trim(),
      missedReasonType: null,
      dueAt: null,
    });
    clearTodoAIResult(todo.id);
  };

  const handleKeepTodo = (todoId: string) => {
    clearTodoAIResult(todoId);
  };

  const handleAddEvent = async () => {
    if (!user || !db || !selectedDate || !newEventTitle.trim()) return;
    const eventsRef = collection(db, "users", user.uid, "events");
    await addDoc(eventsRef, {
      title: newEventTitle.trim(),
      dateKey: selectedDate,
      time: newEventTime,
      createdAt: serverTimestamp(),
    });
    setNewEventTitle("");
  };

  const handleDeleteEvent = async (eventItem: CalendarEvent) => {
    if (!user || !db) return;
    const eventRef = doc(db, "users", user.uid, "events", eventItem.id);
    await deleteDoc(eventRef);
  };

  const handlePreviousMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  };

  const handleNextMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  };

  const startDistractionTimer = (appName: string, minutes: number) => {
    setTimerApp(appName);
    setTimerSeconds(minutes * 60);
    setTimerFinished(false);
  };

  const confirmDistractionTimer = () => {
    if (!pendingAppId) return;
    const nextApps = distractionApps.map((app) =>
      app.id === pendingAppId ? { ...app, minutes: pendingMinutes } : app
    );
    setDistractionApps(nextApps);
    saveDistractionApps(nextApps);
    const appLabel =
      distractionApps.find((app) => app.id === pendingAppId)?.label ??
      "앱";
    startDistractionTimer(appLabel, pendingMinutes);
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
    setPendingAppId(null);
  };

  const cancelDistractionTimer = () => {
    setPendingAppId(null);
  };

  const closeTimer = () => {
    setTimerSeconds(null);
    setTimerApp(null);
    setTimerFinished(false);
  };

  const handleRefreshApp = async () => {
    if (typeof window === "undefined") return;
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      }
    } catch {
      // ignore cache or service worker failures
    }
    window.location.replace(`/?v=${Date.now()}`);
  };

  const handleAddApp = () => {
    const trimmed = newAppLabel.trim();
    if (!trimmed) return;
    const nextApps = [
      ...distractionApps,
      { id: `${Date.now()}`, label: trimmed, minutes: 5 },
    ];
    setDistractionApps(nextApps);
    saveDistractionApps(nextApps);
    setNewAppLabel("");
  };

  const handleRemoveApp = (appId: string) => {
    const nextApps = distractionApps.filter((app) => app.id !== appId);
    setDistractionApps(nextApps);
    saveDistractionApps(nextApps);
  };

  const handleAddRoutine = () => {
    const trimmed = newRoutineText.trim();
    if (!trimmed) return;
    setSettingsDraft((prev) => ({
      ...prev,
      wakeRoutine: [
        ...(prev.wakeRoutine ?? []),
        { id: `${Date.now()}`, text: trimmed },
      ],
    }));
    setNewRoutineText("");
  };

  const handleRemoveRoutine = (routineId: string) => {
    setSettingsDraft((prev) => ({
      ...prev,
      wakeRoutine: (prev.wakeRoutine ?? []).filter(
        (routine) => routine.id !== routineId
      ),
    }));
  };

  const ensureNotificationPermission = async () => {
    if (typeof window === "undefined") return false;
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch {
      return false;
    }
  };

  const triggerWakeNotification = async (title: string, body: string) => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setWakeReminder(body);
      return;
    }
    if (Notification.permission === "granted") {
      try {
        new Notification(title, { body });
        return;
      } catch {
        setWakeReminder(body);
        return;
      }
    }
    setWakeReminder(body);
  };

  const handleEnablePushNotifications = async () => {
    if (!user || !db) return;
    if (firebaseMessagingMissingKeys.length > 0) {
      setWakeReminder("푸시 알림 설정값이 빠졌어요.");
      return;
    }
    const granted = await ensureNotificationPermission();
    if (!granted) {
      setWakeReminder("알림 권한이 없어서 푸시 알림을 켤 수 없어요.");
      return;
    }
    try {
      const token = await registerMessaging();
      if (!token) {
        setWakeReminder("푸시 등록에 실패했어요.");
        return;
      }
      const tokenRef = doc(db, "users", user.uid, "pushTokens", token);
      await setDoc(
        tokenRef,
        {
          token,
          platform: "web",
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      try {
        localStorage.setItem("to-day-push-token", token);
      } catch {
        // ignore storage failures
      }
      setPushEnabled(true);
      setWakeConsent(true);
      const settingsRef = doc(db, "users", user.uid, "settings", "main");
      await setDoc(
        settingsRef,
        {
          wakeConsent: true,
          wakeConsentAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      setWakeReminder("푸시 알림 등록 중 오류가 발생했어요.");
    }
  };

  const handleConsentWakeNotifications = async () => {
    if (!user || !db) return;
    const granted = await ensureNotificationPermission();
    if (!granted) {
      setWakeReminder(
        "알림 권한이 거부되어 있어요. 브라우저 설정에서 허용해 주세요."
      );
      return;
    }
    await handleEnablePushNotifications();
  };

  useEffect(() => {
    const wakeTimes = getUniqueWakeTimes(settings.wakeTimes);
    if (wakeTimes.length === 0) return;
    const matchingTimes = wakeTimes.filter(
      (time) => parseTimeToMinutes(time) === nowMinutes
    );
    if (matchingTimes.length === 0) return;
    if (typeof window === "undefined") return;
    matchingTimes.forEach((time) => {
      const storageKey = `to-day-wake-notified-${todayKey}-${time}`;
      try {
        if (localStorage.getItem(storageKey)) return;
        localStorage.setItem(storageKey, "1");
      } catch {
        // ignore storage failures
      }
      triggerWakeNotification("기상 알림", `설정한 기상 시간(${time})이에요.`);
    });
  }, [nowMinutes, settings.wakeTimes, todayKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const token = localStorage.getItem("to-day-push-token");
      setPushEnabled(Boolean(token));
    } catch {
      setPushEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (!wakeConsent || pushEnabled) return;
    if (!messagingReady) return;
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    handleEnablePushNotifications();
  }, [wakeConsent, pushEnabled, messagingReady]);

  const updateBanner = updateAvailable ? (
    <div className="rounded-2xl bg-slate-900 px-4 py-3 text-xs text-white">
      <div className="flex items-center justify-between gap-3">
        <span>새 버전이 준비됐어요.</span>
        <button
          className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-900"
          onClick={handleRefreshApp}
        >
          새로고침
        </button>
      </div>
    </div>
  ) : null;

  if (!firebaseReady) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          {updateBanner}
          <div className="rounded-3xl bg-slate-900 p-6 shadow-lg">
            <h1 className="text-2xl font-semibold">Firebase 설정 필요</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              `.env.local`에 Firebase 환경 변수를 넣은 뒤 다시 실행해 주세요.
            </p>
            {firebaseConfigMissingKeys.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs text-slate-400">
                {firebaseConfigMissingKeys.map((key) => (
                  <li key={key}>· {key}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6">
          {updateBanner}
          <p className="text-center text-sm text-slate-300">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          {updateBanner}
          <div className="rounded-3xl bg-slate-900 p-6 shadow-lg">
            <h1 className="text-2xl font-semibold">to day</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              기상부터 점심까지 집중을 지키고, 하루의 기록과 투두를 이어가는
              습관 앱이에요.
            </p>
            <button
              className="mt-6 w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900"
              onClick={handleSignIn}
            >
              Google로 시작하기
            </button>
            {authError && (
              <p className="mt-3 text-xs text-rose-300">{authError}</p>
            )}
          </div>
          <div className="rounded-3xl border border-slate-800 p-6 text-sm text-slate-300">
            <p>핵심 기능</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>· 기상 알림 시간 설정</li>
              <li>· 12시까지 보호 시간 모드</li>
              <li>· 오늘 한 일 / 배운 것 기록</li>
              <li>· 어제 기록 복습 후 투두 진입</li>
              <li>· 오늘 투두리스트</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-slate-800 p-6 text-sm text-slate-300">
            <p>핸드폰에서도 사용하기</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>· 배포된 주소로 접속하면 바로 사용할 수 있어요.</li>
              <li>
                · 개발 중이면 같은 와이파이에서 PC의 IP:3000으로
                접속하세요.
              </li>
              <li>· iOS: 공유 → 홈 화면에 추가</li>
              <li>· Android: 브라우저 메뉴 → 앱 설치</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (logLogic.needsReview) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto w-full max-w-md space-y-6">
          {updateBanner}
          <header className="space-y-2">
            <p className="text-xs text-slate-400">
              {formatDateKey(yesterdayKey)} 기록 복습
            </p>
            <h1 className="text-2xl font-semibold">어제 기록을 먼저 확인해요</h1>
            <p className="text-sm text-slate-300">
              복습을 완료해야 오늘 투두리스트로 이동할 수 있어요.
            </p>
          </header>
          <div className="rounded-3xl bg-slate-900 p-6">
            <p className="text-xs text-slate-400">오늘 한 일</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
              {yesterdayLog?.did || "기록이 없어요."}
            </p>
            <p className="mt-6 text-xs text-slate-400">오늘 배운 것</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-100">
              {yesterdayLog?.learned || "기록이 없어요."}
            </p>
          </div>
          <button
            className="w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900"
            onClick={handleReviewComplete}
          >
            복습 완료
          </button>
          <button
            className="w-full rounded-full border border-slate-700 px-5 py-3 text-sm text-slate-200"
            onClick={handleSignOut}
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-24 pt-10 text-slate-900">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        {updateBanner}
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">{formatDateKey(todayKey)}</p>
            <h1 className="text-2xl font-semibold">to day</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-500"
              onClick={handleRefreshApp}
            >
              새로고침
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-500"
              onClick={handleSignOut}
            >
              로그아웃
            </button>
          </div>
        </header>

        {activeTab === "home" && (
          <>
            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <p className="text-xs text-slate-400">
                {homeLogic.greetingText}
              </p>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    {user.displayName ?? "오늘도"}님, 좋은 하루 보내요
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    기상 알림 {wakeTimesLabel} · 보호 시간 {settings.protectStart}
                    ~{settings.protectEnd}
                  </p>
                </div>
                <div
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                    protectLogic.protectActive
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  보호 {protectLogic.protectActive ? "ON" : "OFF"}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-2xl border border-slate-100 px-3 py-3">
                  <p className="text-[11px] text-slate-400">기록</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {logLogic.hasTodayLog ? "작성됨" : "비어있음"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 px-3 py-3">
                  <p className="text-[11px] text-slate-400">투두 진행</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {todoLogic.todoCompletedCount}/{todos.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 px-3 py-3">
                  <p className="text-[11px] text-slate-400">보호 시간</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {protectLogic.protectDetailText}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>오늘 진행률</span>
                  <span>{todoLogic.completionRate}%</span>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-slate-900"
                    style={{ width: `${todoLogic.completionRate}%` }}
                  />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <button
                  className="rounded-2xl border border-slate-200 px-2 py-3 font-semibold text-slate-700"
                  onClick={() => setActiveTab("log")}
                >
                  기록 작성
                </button>
                <button
                  className="rounded-2xl border border-slate-200 px-2 py-3 font-semibold text-slate-700"
                  onClick={() => setActiveTab("todos")}
                >
                  투두 확인
                </button>
                <button
                  className="rounded-2xl border border-slate-200 px-2 py-3 font-semibold text-slate-700"
                  onClick={() => setActiveTab("calendar")}
                >
                  달력 보기
                </button>
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">오늘의 핵심</p>
                <p className="text-xs text-slate-400">지금 바로 할 일</p>
              </div>
              <div className="mt-3 grid gap-3 text-sm">
                <div className="rounded-2xl border border-slate-100 px-4 py-3">
                  <p className="text-[11px] text-slate-400">다음 투두</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {todoLogic.pendingTodos[0]?.text ??
                      "완료 대기 투두가 없어요"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 px-4 py-3">
                  <p className="text-[11px] text-slate-400">오늘 일정</p>
                  {homeLogic.todayEvents.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-500">
                      등록된 일정이 없어요
                    </p>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {homeLogic.todayEvents[0].time} ·{" "}
                      {homeLogic.todayEvents[0].title}
                    </p>
                  )}
                  <button
                    className="mt-2 text-xs font-semibold text-slate-500"
                    onClick={() => setActiveTab("calendar")}
                  >
                    일정 더 보기 →
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold">빠른 투두 추가</p>
              <p className="text-xs text-slate-400">
                생각난 일을 바로 기록하세요.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={newTodo}
                  onChange={(event) => setNewTodo(event.target.value)}
                  placeholder="새 투두 입력"
                  className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  type="datetime-local"
                  value={newTodoDueAt}
                  onChange={(event) => setNewTodoDueAt(event.target.value)}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                  onClick={handleAddTodo}
                >
                  추가
                </button>
              </div>
            </section>
          </>
        )}

        {activeTab === "wake" && (
          <>
            <section className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">기상 알림 설정</p>
                  <p className="text-xs text-slate-400">
                    큰 시간 입력으로 여러 알람을 설정하세요.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {(settingsDraft.wakeTimes ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">
                    아직 알람이 없어요. 아래에서 추가해 주세요.
                  </p>
                ) : (
                  (settingsDraft.wakeTimes ?? []).map((alarm) => (
                    <div key={alarm.id} className="flex items-center gap-3">
                      <input
                        type="time"
                        value={alarm.time}
                        onChange={(event) =>
                          handleUpdateWakeTime(alarm.id, event.target.value)
                        }
                        className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-lg font-semibold text-slate-900"
                      />
                      <button
                        type="button"
                        aria-pressed={alarm.enabled}
                        onClick={() => handleToggleWakeTime(alarm.id)}
                        className="rounded-full border border-slate-200 px-2 py-2"
                      >
                        <span
                          className={`relative inline-flex h-6 w-10 items-center rounded-full transition ${
                            alarm.enabled ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                              alarm.enabled ? "translate-x-4" : "translate-x-1"
                            }`}
                          />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 px-2 py-2 text-slate-500"
                        onClick={() => handleRemoveWakeTime(alarm.id)}
                        aria-label="알람 삭제"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 7h16" />
                          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  className="w-full rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600"
                  onClick={handleAddWakeTime}
                >
                  + 알람 추가
                </button>
              </div>
            {!wakeConsent && (
              <div className="mt-3 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <span>알림 기능 사용에 동의해 주세요.</span>
                <button
                  className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white"
                  onClick={handleConsentWakeNotifications}
                  disabled={!messagingReady}
                >
                  알림 사용
                </button>
              </div>
            )}
            {firebaseMessagingMissingKeys.length > 0 && (
              <p className="mt-2 text-xs text-rose-400">
                {firebaseMessagingMissingKeys.join(", ")} 환경 변수가 필요해요.
              </p>
            )}
            <button
              className="mt-4 w-full rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              onClick={handleSaveWakeSettings}
            >
              설정 저장
            </button>
            {wakeSaved && (
              <p className="mt-2 text-center text-xs text-emerald-600">
                설정이 저장됐어요.
              </p>
            )}
            {wakeReminder && (
              <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div className="flex items-start justify-between gap-3">
                  <span>{wakeReminder}</span>
                  <button
                    className="text-[11px] text-slate-400"
                    onClick={() => setWakeReminder(null)}
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">기상 루틴</p>
                <p className="text-xs text-slate-400">
                  알림 후 바로 실천할 일을 적어두세요.
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={newRoutineText}
                onChange={(event) => setNewRoutineText(event.target.value)}
                placeholder="예) 물 한 컵 마시기"
                className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                onClick={handleAddRoutine}
              >
                추가
              </button>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              {(settingsDraft.wakeRoutine ?? []).length === 0 && (
                <p className="text-xs text-slate-400">
                  등록된 루틴이 없어요.
                </p>
              )}
              {(settingsDraft.wakeRoutine ?? []).map((routine, index) => (
                <div
                  key={routine.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 px-3 py-2"
                >
                  <span className="text-sm text-slate-700">
                    {getIconForRoutine(routine.text)} {index + 1}.{" "}
                    {routine.text}
                  </span>
                  <button
                    className="text-xs text-slate-400"
                    onClick={() => handleRemoveRoutine(routine.id)}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <button
              className="mt-4 w-full rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              onClick={handleSaveWakeRoutine}
            >
              루틴 저장
            </button>
            {routineSaved && (
              <p className="mt-2 text-center text-xs text-emerald-600">
                루틴이 저장됐어요.
              </p>
            )}
          </section>
        </>
        )}

        {activeTab === "shield" && (
          <>
            <section className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">보호 시간 설정</p>
                  <p className="text-xs text-slate-400">
                    보호 시간을 직접 설정할 수 있어요.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="time"
                  value={settingsDraft.protectStart}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      protectStart: event.target.value,
                    }))
                  }
                  className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <span className="text-xs text-slate-400">~</span>
                <input
                  type="time"
                  value={settingsDraft.protectEnd}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      protectEnd: event.target.value,
                    }))
                  }
                  className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <button
                className="mt-4 w-full rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                onClick={handleSaveWakeSettings}
              >
                보호 시간 저장
              </button>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">보호 시간 모드</p>
                  <p className="text-xs text-slate-400">
                    {protectLogic.protectActive
                      ? "현재 집중 모드가 활성화되어 있어요."
                      : "지금은 보호 시간이 아니에요."}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs ${
                    protectLogic.protectActive
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {protectLogic.protectActive ? "ON" : "OFF"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                {distractionApps.map((app) => (
                  <div key={app.id} className="flex flex-col gap-1">
                    <button
                      className="rounded-2xl border border-slate-200 px-2 py-3 text-center"
                      onClick={() => {
                        setPendingAppId(app.id);
                        setPendingMinutes(app.minutes);
                      }}
                    >
                      {app.label}
                    </button>
                    {app.id !== "insta" &&
                      app.id !== "youtube" &&
                      app.id !== "kakao" && (
                        <button
                          className="text-[10px] text-slate-400"
                          onClick={() => handleRemoveApp(app.id)}
                        >
                          삭제
                        </button>
                      )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  value={newAppLabel}
                  onChange={(event) => setNewAppLabel(event.target.value)}
                  placeholder="차단 앱 추가"
                  className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                  onClick={handleAddApp}
                >
                  추가
                </button>
              </div>
            </section>
          </>
        )}

        {activeTab === "log" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold">오늘 기록</p>
            <p className="text-xs text-slate-400">
              하루가 끝나기 전에 오늘을 정리해요.
            </p>
            <div className="mt-4 space-y-4 text-sm">
              <label className="block">
                <span className="text-xs text-slate-400">오늘 한 일</span>
                <textarea
                  value={todayDraft.did}
                  onChange={(event) =>
                    setTodayDraft((prev) => ({
                      ...prev,
                      did: event.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-2 w-full rounded-2xl border border-slate-200 p-3 text-sm"
                  placeholder="예) 오전 독서 30분, 운동 20분"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">오늘 배운 것</span>
                <textarea
                  value={todayDraft.learned}
                  onChange={(event) =>
                    setTodayDraft((prev) => ({
                      ...prev,
                      learned: event.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-2 w-full rounded-2xl border border-slate-200 p-3 text-sm"
                  placeholder="예) 집중할 때는 알림을 꺼두면 좋다"
                />
              </label>
            </div>
            <button
              className="mt-4 w-full rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              onClick={handleSaveLog}
            >
              기록 저장
            </button>
          </section>
        )}

        {activeTab === "calendar" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">달력</p>
                <p className="text-xs text-slate-400">
                  날짜를 눌러 일정과 할 일을 추가하세요.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500"
                  onClick={handlePreviousMonth}
                >
                  이전
                </button>
                <button
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500"
                  onClick={handleNextMonth}
                >
                  다음
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {monthKey.replace("-", ".")}
            </p>
            <div className="mt-3 grid grid-cols-7 gap-2 text-xs text-slate-400">
              {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
                <div key={label} className="text-center">
                  {label}
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-2 text-xs">
              {getCalendarMatrix(currentMonth).map((week, weekIndex) =>
                week.map((day, dayIndex) => {
                  const dateKey = day
                    ? `${monthKey}-${String(day).padStart(2, "0")}`
                    : null;
                  const dayEvents = dateKey ? events[dateKey] ?? [] : [];
                  return (
                    <button
                      key={`${weekIndex}-${dayIndex}`}
                      className={`h-12 rounded-xl border text-center ${
                        day
                          ? "border-slate-200 bg-white"
                          : "border-transparent bg-transparent"
                      }`}
                      onClick={() => dateKey && setSelectedDate(dateKey)}
                      disabled={!day}
                    >
                      {day && (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs font-semibold">{day}</span>
                          {dayEvents.length > 0 && (
                            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">
                              {dayEvents.length}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {activeTab === "todos" && (
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold">오늘 투두리스트</p>
            <p className="text-xs text-slate-400">
              복습을 끝냈으니 오늘의 할 일을 정리해요.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              오늘 기록된 Effect {todayEffectCount}개
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <input
                value={newTodo}
                onChange={(event) => setNewTodo(event.target.value)}
                placeholder="새 투두 입력"
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="datetime-local"
                value={newTodoDueAt}
                onChange={(event) => setNewTodoDueAt(event.target.value)}
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                onClick={handleAddTodo}
              >
                추가
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {todos.length === 0 && (
                <p className="text-xs text-slate-400">아직 투두가 없어요.</p>
              )}
              {todos.map((todo) => (
                (() => {
                  const dueAtMillis = toMillis(todo.dueAt);
                  const isOverdue =
                    !todo.done && dueAtMillis !== null && dueAtMillis < Date.now();
                  const aiReady =
                    isOverdue &&
                    todo.missedReasonType &&
                    AI_ELIGIBLE_REASONS.has(todo.missedReasonType);
                  const aiResult = todoAIResults[todo.id];
                  const aiError = todoAIError[todo.id];
                  const aiLoading = todoAILoading[todo.id];
                  return (
                <div
                  key={todo.id}
                  className="rounded-2xl border border-slate-100 px-3 py-3"
                >
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={() => handleToggleTodo(todo)}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={
                            todo.done ? "text-slate-400 line-through" : ""
                          }
                        >
                          {todo.text}
                        </span>
                        <button
                          className="text-[11px] text-slate-400"
                          onClick={() => handleDeleteTodo(todo)}
                          type="button"
                        >
                          삭제
                        </button>
                      </div>
                      {todo.dueAt && (
                        <p
                          className={`mt-1 text-[11px] ${
                            isOverdue ? "text-rose-400" : "text-slate-400"
                          }`}
                        >
                          마감{" "}
                          {new Date(dueAtMillis ?? Date.now()).toLocaleString()}
                        </p>
                      )}
                      {!todo.done && isOverdue && (
                        <div className="mt-2">
                          <label className="text-[11px] text-slate-400">
                            못한 이유
                          </label>
                          <select
                            value={todo.missedReasonType ?? ""}
                            onChange={(event) =>
                              handleUpdateMissedReason(
                                todo,
                                event.target.value as MissedReasonType
                              )
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-2 text-xs"
                          >
                            <option value="" disabled>
                              선택하세요
                            </option>
                            {Object.values(MissedReasonType).map((reason) => (
                              <option key={reason} value={reason}>
                                {MISSED_REASON_LABELS[reason]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {!todo.done && aiReady && (
                        <div className="mt-2">
                          <button
                            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600"
                            onClick={() => handleGenerateReasonHelp(todo)}
                            disabled={aiLoading}
                          >
                            {aiLoading ? "생성 중..." : "AI 제안 받기"}
                          </button>
                          {aiError && (
                            <p className="mt-1 text-[11px] text-rose-400">
                              {aiError}
                            </p>
                          )}
                        </div>
                      )}
                      {aiResult && (
                        <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500">
                              AI 제안
                            </p>
                          </div>
                          <div className="mt-3 space-y-2">
                            <div>
                              <p className="text-[11px] text-slate-400">
                                상태 인식 질문
                              </p>
                              <div className="mt-2 space-y-1 text-xs text-slate-600">
                                {aiResult.reflectionQuestions.map((question) => (
                                  <p key={question}>· {question}</p>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <p className="text-[11px] text-slate-400">
                                이렇게 바꿔볼래요?
                              </p>
                              <p className="mt-1 text-sm text-slate-700">
                                {aiResult.rewrittenTodo}
                              </p>
                              <div className="mt-3 flex gap-2">
                                <button
                                  className="flex-1 rounded-full border border-slate-200 px-3 py-2 text-xs text-slate-600"
                                  type="button"
                                  onClick={() => handleKeepTodo(todo.id)}
                                >
                                  기존 투두 유지
                                </button>
                                <button
                                  className="flex-1 rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                                  onClick={() =>
                                    handleReplaceTodoText(
                                      todo,
                                      aiResult.rewrittenTodo
                                    )
                                  }
                                >
                                기존 투두 수정하기
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
                  );
                })()
              ))}
            </div>
          </section>
        )}

      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white">
        <div
          className="mx-auto grid w-full max-w-md grid-cols-6 gap-2 px-4 py-3 text-xs text-slate-500"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          {[
            { key: "home", label: "홈" },
            { key: "wake", label: "기상" },
            { key: "shield", label: "보호" },
            { key: "log", label: "기록" },
            { key: "calendar", label: "달력" },
            { key: "todos", label: "투두" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`rounded-full px-2 py-2 ${
                activeTab === tab.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-500"
              }`}
              onClick={() => setActiveTab(tab.key as TabKey)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {pendingAppId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center max-h-[80vh] overflow-y-auto">
            <p className="text-xs text-slate-400">보호 시간 모드</p>
            <h2 className="mt-2 text-lg font-semibold">
              {
                distractionApps.find((app) => app.id === pendingAppId)?.label ??
                "앱"
              }{" "}
              사용 시간을 설정해 주세요
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              확인을 누르면 설정한 시간이 시작돼요.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={pendingMinutes}
                onChange={(event) =>
                  setPendingMinutes(
                    Math.max(1, Math.min(120, Number(event.target.value)))
                  )
                }
                className="w-20 rounded-xl border border-slate-200 px-2 py-2 text-sm text-center"
              />
              <span className="text-sm text-slate-500">분</span>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-500"
                onClick={cancelDistractionTimer}
              >
                취소
              </button>
              <button
                className="flex-1 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                onClick={confirmDistractionTimer}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400">선택한 날짜</p>
                <h2 className="text-lg font-semibold">
                  {formatDateKey(selectedDate)}
                </h2>
              </div>
              <button
                className="text-xs text-slate-400"
                onClick={() => setSelectedDate(null)}
              >
                닫기
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <input
                type="time"
                value={newEventTime}
                onChange={(event) => setNewEventTime(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={newEventTitle}
                onChange={(event) => setNewEventTitle(event.target.value)}
                placeholder="일정 / 해야할 일"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                className="w-full rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                onClick={handleAddEvent}
              >
                일정 추가
              </button>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">기록</p>
              {!selectedLogExists && (
                <p className="mt-2 text-xs text-slate-400">
                  이 날짜에는 기록이 없어요.
                </p>
              )}
              {selectedLogExists && (
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <div>
                    <p className="text-[11px] text-slate-400">오늘 한 일</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {selectedLog?.did || "기록이 없어요."}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">오늘 배운 것</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {selectedLog?.learned || "기록이 없어요."}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {(events[selectedDate] ?? []).length === 0 && (
                <p className="text-xs text-slate-400">
                  아직 등록된 일정이 없어요.
                </p>
              )}
              {(events[selectedDate] ?? []).map((eventItem) => (
                <div
                  key={eventItem.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-100 px-3 py-2"
                >
                  <div>
                    <p className="text-xs text-slate-400">{eventItem.time}</p>
                    <p className="text-sm">{eventItem.title}</p>
                  </div>
                  <button
                    className="text-xs text-slate-400"
                    onClick={() => handleDeleteEvent(eventItem)}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {effectModalTodo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-400">Effect 기록</p>
                <h2 className="mt-1 text-lg font-semibold">
                  이 할 일을 하고 나서, 가장 크게 남은 건 뭐였어?
                </h2>
              </div>
              <button
                className="text-xs text-slate-400"
                onClick={closeEffectModal}
              >
                닫기
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              대상: {effectModalTodo.text}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              최대 2개까지 선택할 수 있어요.
            </p>
            <div className="mt-4 space-y-3">
              {EFFECT_OPTIONS.map((option) => {
                const selected = effectSelections[option.type];
                return (
                  <div
                    key={option.type}
                    className={`rounded-2xl border px-3 py-3 ${
                      selected ? "border-slate-900 bg-slate-50" : "border-slate-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleEffectType(option.type)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-900">
                          {option.label}
                        </p>
                        {selected && (
                          <span className="text-[11px] text-slate-500">
                            {INTENSITY_LABELS[selected]} 강도
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {option.description}
                      </p>
                    </button>
                    {selected && (
                      <div className="mt-3 flex gap-2">
                        {EFFECT_INTENSITIES.map((intensity) => (
                          <button
                            key={intensity}
                            type="button"
                            onClick={() =>
                              updateEffectIntensity(option.type, intensity)
                            }
                            className={`flex-1 rounded-full border px-2 py-1 text-xs ${
                              selected === intensity
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 text-slate-500"
                            }`}
                          >
                            {INTENSITY_LABELS[intensity]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex gap-3">
              <button
                className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-500"
                onClick={closeEffectModal}
              >
                취소
              </button>
              <button
                className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold ${
                  selectedEffectCount === 0
                    ? "bg-slate-200 text-slate-400"
                    : "bg-slate-900 text-white"
                }`}
                onClick={handleConfirmEffects}
                disabled={selectedEffectCount === 0}
              >
                완료
              </button>
            </div>
          </div>
        </div>
      )}

      {isTimerActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 px-6 text-white">
          <div className="w-full max-w-sm rounded-3xl bg-slate-900 p-6 text-center">
            <p className="text-xs text-slate-400">
              보호 시간 모드 · {timerApp}
            </p>
            {!timerFinished ? (
              <>
                <h2 className="mt-3 text-2xl font-semibold">
                  {Math.floor((timerSeconds ?? 0) / 60)
                    .toString()
                    .padStart(2, "0")}
                  :
                  {((timerSeconds ?? 0) % 60).toString().padStart(2, "0")}
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  5분 동안 기다리면서 집중을 되찾아요.
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-3 text-xl font-semibold">타이머 종료</h2>
                <p className="mt-2 text-sm text-slate-300">
                  이제 다시 집중 모드로 돌아가요.
                </p>
                <button
                  className="mt-4 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900"
                  onClick={closeTimer}
                >
                  돌아가기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
