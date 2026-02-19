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
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
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
import type { RecordItem } from "@/types/record";
import type { DesignPlan } from "@/types/designPlan";
import type { GoalTrack } from "@/types/goalTrack";
import type { GoalTrackEvent } from "@/types/goalTrackEvent";
import type { GoalTrackWeeklyReview } from "@/types/goalTrackWeeklyReview";
import {
  buildEventId,
  calcLast7Days,
  calcLast7DaysCompletionRatios,
  getExecutedDayCount,
  recentEvents,
} from "@/domain/execution";
import { buildReviewId } from "@/domain/weeklyReview";
import { buildWeeklyCoach } from "@/domain/weeklyCoach";
import {
  getLastNDateKeys,
  getNextWeekDateKeyByWeekdayKST,
  getWeekStartKeyKST,
  getWeekStartKeysForLastNWeeks,
} from "@/domain/date";
import { calcRhythmImpact, fallbackSuggestion } from "@/domain/todoBlock";
import type { BlockType } from "@/types/todoBlock";
import {
  deleteGoalTrackEventsByGoalTrackId,
  deleteGoalTrackEventsByTodoId,
} from "@/lib/goalTrackEvents";
import { WeeklyReviewCard } from "@/components/design/WeeklyReviewCard";
import { InlineGoalLinkEditor } from "@/components/todo/InlineGoalLinkEditor";
import { TodoBlockPanel } from "@/components/todo/TodoBlockPanel";

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
  wakeRoutine?: RoutineCollection | RoutineItem[];
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
  missedReasonType?: MissedReasonType | null;
  goalId?: string | null;
  goalTrackId?: string | null;
};

const getTodoGoalTrackId = (todo: TodoItem): string | null =>
  todo.goalTrackId ?? null;

type CalendarEvent = {
  id: string;
  title: string;
  dateKey: string;
  time: string;
  createdAt?: unknown;
};

type TabKey =
  | "home"
  | "wake"
  | "shield"
  | "log"
  | "design"
  | "calendar"
  | "todos";

type DistractionApp = {
  id: string;
  label: string;
  minutes: number;
};

type RoutineType = "morning" | "night" | "custom";
type RoutineTriggerType = "alarm" | "manual" | "location";

type RoutineTask = {
  id: string;
  title: string;
  completed: boolean;
};

type RoutineItem = {
  id: string;
  title: string;
  type: RoutineType;
  triggerType?: RoutineTriggerType;
  tasks: RoutineTask[];
  streak: number;
  totalCompletedDays: number;
  monthlySuccessRate: number;
  lastCompletedDate: string;
  completionHistory?: string[];
};

type RoutineCollection = {
  routines: RoutineItem[];
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
  wakeRoutine: { routines: [] },
  distractionApps: [
    { id: "insta", label: "인스타그램", minutes: 5 },
    { id: "youtube", label: "유튜브", minutes: 5 },
    { id: "kakao", label: "카카오톡", minutes: 5 },
  ],
};

const ROUTINE_STREAK_GRACE_DAYS = 2;

const parseDateKeyToDate = (value: string) => {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const diffDaysBetweenDateKeys = (from: string, to: string) => {
  const fromDate = parseDateKeyToDate(from);
  const toDate = parseDateKeyToDate(to);
  if (!fromDate || !toDate) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY);
};

const calculateMonthlySuccessRate = (
  completionHistory: string[],
  todayDateKey: string
) => {
  const todayDate = parseDateKeyToDate(todayDateKey) ?? new Date();
  const monthPrefix = getMonthKey(todayDate);
  const elapsedDays = Math.max(1, todayDate.getDate());
  const uniqueSuccessDays = new Set(
    completionHistory.filter((dayKey) => dayKey.startsWith(monthPrefix))
  );
  return Math.round((uniqueSuccessDays.size / elapsedDays) * 100);
};

const makeDefaultRoutine = (
  routineId = `routine-${Date.now()}`,
  tasks: RoutineTask[] = []
): RoutineItem => ({
  id: routineId,
  title: "아침 루틴",
  type: "morning",
  triggerType: "alarm",
  tasks,
  streak: 0,
  totalCompletedDays: 0,
  monthlySuccessRate: 0,
  lastCompletedDate: "",
  completionHistory: [],
});

const normalizeRoutineTask = (task: unknown, index: number): RoutineTask | null => {
  if (typeof task === "string") {
    const title = task.trim();
    if (!title) return null;
    return { id: `${Date.now()}-task-${index}`, title, completed: false };
  }
  if (!task || typeof task !== "object") return null;
  const candidate = task as Partial<RoutineTask> & { text?: string };
  const title =
    typeof candidate.title === "string"
      ? candidate.title.trim()
      : typeof candidate.text === "string"
        ? candidate.text.trim()
        : "";
  if (!title) return null;
  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : `${Date.now()}-task-${index}`,
    title,
    completed: Boolean(candidate.completed),
  };
};

const normalizeRoutineItem = (
  routine: unknown,
  index: number,
  todayDateKey: string
): RoutineItem | null => {
  if (!routine || typeof routine !== "object") return null;
  const candidate = routine as Partial<RoutineItem> & {
    text?: string;
    tasks?: unknown[];
  };
  const title =
    typeof candidate.title === "string"
      ? candidate.title
      : typeof candidate.text === "string" && candidate.text.trim()
        ? candidate.text.trim()
        : `루틴 ${index + 1}`;
  const tasks = Array.isArray(candidate.tasks)
    ? candidate.tasks
        .map((task, taskIndex) => normalizeRoutineTask(task, taskIndex))
        .filter((task): task is RoutineTask => Boolean(task))
    : [];
  const completionHistory = Array.isArray(candidate.completionHistory)
    ? candidate.completionHistory.filter(
        (item): item is string => typeof item === "string" && item.length > 0
      )
    : [];
  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : `${Date.now()}-routine-${index}`,
    title,
    type:
      candidate.type === "morning" || candidate.type === "night" || candidate.type === "custom"
        ? candidate.type
        : "morning",
    triggerType:
      candidate.triggerType === "alarm" ||
      candidate.triggerType === "manual" ||
      candidate.triggerType === "location"
        ? candidate.triggerType
        : "alarm",
    tasks,
    streak:
      typeof candidate.streak === "number" && candidate.streak >= 0
        ? candidate.streak
        : 0,
    totalCompletedDays:
      typeof candidate.totalCompletedDays === "number" && candidate.totalCompletedDays >= 0
        ? candidate.totalCompletedDays
        : completionHistory.length,
    monthlySuccessRate: calculateMonthlySuccessRate(completionHistory, todayDateKey),
    lastCompletedDate:
      typeof candidate.lastCompletedDate === "string" ? candidate.lastCompletedDate : "",
    completionHistory,
  };
};

const extractRoutineArray = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { routines?: unknown }).routines)) {
    return (raw as { routines: unknown[] }).routines;
  }
  return [];
};

const toRoutineCollection = (routines: RoutineItem[]): RoutineCollection => ({
  routines,
});

const getRoutineDisplayTitle = (title: string, fallbackIndex: number) => {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : `루틴 ${fallbackIndex + 1}`;
};

const normalizeWakeRoutine = (raw: unknown, todayDateKey: string): RoutineItem[] => {
  const source = extractRoutineArray(raw);
  if (source.length === 0) {
    return [];
  }
  const looksLikeLegacyTaskArray = source.some((item) => {
    if (typeof item === "string") return true;
    if (!item || typeof item !== "object") return false;
    return (
      "text" in item &&
      typeof (item as { text?: unknown }).text === "string" &&
      !("tasks" in item)
    );
  });
  if (looksLikeLegacyTaskArray) {
    const tasks = source
      .map((item, index) => normalizeRoutineTask(item, index))
      .filter((item): item is RoutineTask => Boolean(item));
    return [makeDefaultRoutine("morning-default", tasks)];
  }
  return source
    .map((item, index) => normalizeRoutineItem(item, index, todayDateKey))
    .filter((item): item is RoutineItem => Boolean(item));
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
  [MissedReasonType.COMPLETED_BUT_NOT_CHECKED]: "완료했는데, 체크를 못했어요",
  [MissedReasonType.HARD_TO_START]: "시작하기가 어려워요",
  [MissedReasonType.NOT_ENOUGH_TIME]: "끝내기 위한 시간이 부족해요",
  [MissedReasonType.WANT_TO_REST]: "오늘은 쉬고싶어요",
};
const AI_ELIGIBLE_REASONS = new Set<MissedReasonType>([
  MissedReasonType.HARD_TO_START,
  MissedReasonType.NOT_ENOUGH_TIME,
]);

const HARD_TO_START_QUESTION_POOL = [
  "딱 시작만 한다면, 첫 행동은 뭐였을까요?",
  "이 투두에서 ‘생각 안 해도 되는 최소 행동’은 뭘까요?",
  "지금 당장 1분 안에 할 수 있는 행동으로 바꾼다면?",
  "이 일을 시작할 때 가장 귀찮은 부분은 어디인가요?",
  "누군가 옆에서 ‘이것만 하자’고 말해준다면 뭐가 좋을까요?",
] as const;

const NOT_ENOUGH_TIME_QUESTION_POOL = [
  "오늘 꼭 하지 않아도 되는 부분은 뭘까요?",
  "전체 중 절반만 한다면 어디까지가 적당할까요?",
  "이 투두를 10분짜리로 줄인다면 남길 건 뭘까요?",
  "완벽하지 않아도 괜찮다면, 오늘 어디까지면 충분할까요?",
] as const;

const hashStringToInt = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const pickStableQuestions = (
  seed: string,
  pool: readonly string[],
  min: 2 | 3 = 2,
  max: 2 | 3 = 3
) => {
  if (pool.length <= min) return [...pool];
  const hash = hashStringToInt(seed);
  const count = (hash % (max - min + 1)) + min;
  const indices = pool.map((_, index) => index);
  // stable shuffle (Fisher–Yates variant)
  let state = hash || 1;
  for (let i = indices.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, Math.min(count, pool.length)).map((i) => pool[i]);
};

const normalizeMissedReasonType = (value: unknown): MissedReasonType | null => {
  // supports old stored values
  if (value === "FORGOT") return MissedReasonType.COMPLETED_BUT_NOT_CHECKED;
  if (value === "HARD_TO_START") return MissedReasonType.HARD_TO_START;
  if (value === "TIME_MISMATCH") return MissedReasonType.NOT_ENOUGH_TIME;
  if (value === "JUST_SKIP") return MissedReasonType.WANT_TO_REST;
  if (
    value === MissedReasonType.COMPLETED_BUT_NOT_CHECKED ||
    value === MissedReasonType.HARD_TO_START ||
    value === MissedReasonType.NOT_ENOUGH_TIME ||
    value === MissedReasonType.WANT_TO_REST
  ) {
    return value as MissedReasonType;
  }
  return null;
};

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
  const [linkNewTodoToGoal, setLinkNewTodoToGoal] = useState(false);
  const [newTodoDesignPlanId, setNewTodoDesignPlanId] = useState("");
  const [newTodoGoalTrackId, setNewTodoGoalTrackId] = useState("");
  const [designPlans, setDesignPlans] = useState<DesignPlan[]>([]);
  const [goalTracks, setGoalTracks] = useState<GoalTrack[]>([]);
  const [selectedDesignPlanId, setSelectedDesignPlanId] = useState<string | null>(null);
  const [newDesignPlanTitle, setNewDesignPlanTitle] = useState("");
  const [newGoalTrackTitle, setNewGoalTrackTitle] = useState("");
  const [weeklyReviewContentExpanded, setWeeklyReviewContentExpanded] =
    useState(false);
  const [editingReviewDayGoalTrackId, setEditingReviewDayGoalTrackId] = useState<
    string | null
  >(null);
  const [editingDesignPlanId, setEditingDesignPlanId] = useState<string | null>(null);
  const [editingDesignPlanTitle, setEditingDesignPlanTitle] = useState("");
  const [editingGoalTrackId, setEditingGoalTrackId] = useState<string | null>(null);
  const [editingGoalTrackTitle, setEditingGoalTrackTitle] = useState("");
  const [addingTodoForGoalTrackId, setAddingTodoForGoalTrackId] = useState<string | null>(null);
  const [goalTrackTodoText, setGoalTrackTodoText] = useState("");
  const [goalTrackTodoDueAt, setGoalTrackTodoDueAt] = useState("");
  const [goalTrackEvents, setGoalTrackEvents] = useState<GoalTrackEvent[]>([]);
  const [todosByDateKey, setTodosByDateKey] = useState<
    Record<string, TodoItem[]>
  >({});
  const [goalTrackWeeklyReviews, setGoalTrackWeeklyReviews] = useState<
    GoalTrackWeeklyReview[]
  >([]);
  const [weeklyReviewSaving, setWeeklyReviewSaving] = useState(false);
  const [executionToast, setExecutionToast] = useState<string | null>(null);
  const [editingGoalLinkTodoId, setEditingGoalLinkTodoId] = useState<string | null>(null);
  const [openBlockPanelTodoId, setOpenBlockPanelTodoId] = useState<string | null>(null);
  const [blockSuggestion, setBlockSuggestion] = useState<
    Record<string, { question: string; rewrittenTodo: string }>
  >({});
  const [blockSuggestionLoading, setBlockSuggestionLoading] = useState<
    Record<string, boolean>
  >({});
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
  const [wakeScreen, setWakeScreen] = useState<"list" | "execute" | "edit">("list");
  const [selectedWakeRoutineId, setSelectedWakeRoutineId] = useState<string | null>(null);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerApp, setTimerApp] = useState<string | null>(null);
  const [timerFinished, setTimerFinished] = useState(false);
  const bodyOverflowRef = useRef<string | null>(null);
  const todoInsertInFlightRef = useRef<Set<string>>(new Set());
  const goalTrackEventsBackfillRunRef = useRef(false);
  const timerNotifiedRef = useRef(false);
  const autoRefreshRef = useRef(false);
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
  >(() => ({} as Record<EffectType, Effect["intensity"]>));
  const [todoAIResults, setTodoAIResults] = useState<
    Record<
      string,
      { conditionMessage: string; rewrittenTodo: string }
    >
  >({});
  const [todoAILoading, setTodoAILoading] = useState<Record<string, boolean>>(
    {}
  );
  const [todoAIError, setTodoAIError] = useState<Record<string, string>>({});
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [todoDraftText, setTodoDraftText] = useState("");
  const [todoPolishLoading, setTodoPolishLoading] = useState(false);
  const [todoPolishError, setTodoPolishError] = useState("");
  const [recordDraft, setRecordDraft] = useState("");
  const [recordGoalTrackId, setRecordGoalTrackId] = useState<string>("");
  const [recordsThisMonth, setRecordsThisMonth] = useState<RecordItem[]>([]);
  const [logSection, setLogSection] = useState<"daily" | "record">(
    "daily"
  );

  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

  const userType = settings.userType ?? defaultSettings.userType;
  const firebaseReady = Boolean(auth && db);
  const isTimerActive = timerSeconds !== null;
  const monthKey = getMonthKey(currentMonth);
  const modalOpen = Boolean(
    pendingAppId || selectedDate || isTimerActive || effectModalTodo || todoModalOpen
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
  const thisMonthRecordCount = recordsThisMonth.length;
  const wakeRoutines = useMemo(
    () => normalizeWakeRoutine(settingsDraft.wakeRoutine, todayKey),
    [settingsDraft.wakeRoutine, todayKey]
  );
  const activeWakeRoutine = useMemo(() => {
    if (wakeRoutines.length === 0) return null;
    if (selectedWakeRoutineId) {
      return wakeRoutines.find((routine) => routine.id === selectedWakeRoutineId) ?? null;
    }
    return wakeRoutines[0];
  }, [wakeRoutines, selectedWakeRoutineId]);
  const activeWakeRoutineIndex = useMemo(() => {
    if (!activeWakeRoutine) return -1;
    return wakeRoutines.findIndex((routine) => routine.id === activeWakeRoutine.id);
  }, [activeWakeRoutine, wakeRoutines]);
  const activeWakeRoutineAllDone = useMemo(() => {
    if (!activeWakeRoutine) return false;
    if (activeWakeRoutine.tasks.length === 0) return false;
    return activeWakeRoutine.tasks.every((task) => task.completed);
  }, [activeWakeRoutine]);
  const activeWakeRoutineCompletedToday = useMemo(() => {
    if (!activeWakeRoutine) return false;
    return activeWakeRoutine.lastCompletedDate === todayKey;
  }, [activeWakeRoutine, todayKey]);
  const uiCard = "rounded-3xl bg-white p-6 shadow-sm";
  const uiPrimaryButton =
    "h-11 w-full rounded-full bg-slate-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-slate-800";
  const uiSecondaryButton =
    "h-11 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50";
  const uiDangerButton =
    "h-11 rounded-full border border-rose-200 bg-white px-4 text-xs font-semibold text-rose-500 transition-colors hover:bg-rose-50";
  const uiInputPanel = "rounded-2xl border border-slate-100 bg-slate-50 p-3";

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
    if (!user || !db) return;
    setSettingsDraft((prev) => {
      const current = normalizeWakeRoutine(prev.wakeRoutine, todayKey);
      let changed = false;
      const nextWakeRoutine = current.map((routine) => {
        const shouldReset =
          routine.lastCompletedDate !== todayKey && routine.tasks.some((task) => task.completed);
        const nextMonthlySuccessRate = calculateMonthlySuccessRate(
          routine.completionHistory ?? [],
          todayKey
        );
        if (!shouldReset && nextMonthlySuccessRate === routine.monthlySuccessRate) {
          return routine;
        }
        changed = true;
        return {
          ...routine,
          tasks: shouldReset
            ? routine.tasks.map((task) => ({ ...task, completed: false }))
            : routine.tasks,
          monthlySuccessRate: nextMonthlySuccessRate,
        };
      });
      if (changed && db && user) {
        const settingsRef = doc(db, "users", user.uid, "settings", "main");
        void setDoc(
          settingsRef,
          {
            wakeRoutine: toRoutineCollection(nextWakeRoutine),
          },
          { merge: true }
        );
      }
      return changed
        ? {
            ...prev,
            wakeRoutine: toRoutineCollection(nextWakeRoutine),
          }
        : prev;
    });
  }, [todayKey, user, db]);

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
      setTodoModalOpen(false);
      setTodoDraftText("");
      setTodoPolishLoading(false);
      setTodoPolishError("");
      setLinkNewTodoToGoal(false);
      setNewTodoDesignPlanId("");
      setNewTodoGoalTrackId("");
      setDesignPlans([]);
      setGoalTracks([]);
      setSelectedDesignPlanId(null);
      setEditingDesignPlanId(null);
      setEditingDesignPlanTitle("");
      setEditingGoalTrackId(null);
      setEditingGoalTrackTitle("");
      setAddingTodoForGoalTrackId(null);
      setGoalTrackTodoText("");
      setGoalTrackTodoDueAt("");
      setGoalTrackEvents([]);
      setGoalTrackWeeklyReviews([]);
      goalTrackEventsBackfillRunRef.current = false;
      setEditingGoalLinkTodoId(null);
      setRecordsThisMonth([]);
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
      const nextRoutine = normalizeWakeRoutine(data.wakeRoutine, todayKey);
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
        wakeRoutine: toRoutineCollection(nextRoutine),
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
        wakeRoutine: toRoutineCollection(nextRoutine),
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
          missedReasonType: normalizeMissedReasonType(data.missedReasonType),
          goalId: typeof data.goalId === "string" ? data.goalId : null,
          goalTrackId: typeof data.goalTrackId === "string" ? data.goalTrackId : null,
        };
      });
      setTodos(nextTodos);
    });

    const toCreatedAtString = (v: unknown): string => {
      if (typeof v === "string") return v;
      const t = v as { toDate?: () => Date } | null;
      if (t && typeof t.toDate === "function") return t.toDate().toISOString();
      return "";
    };

    const designPlansRef = collection(db, "users", user.uid, "designPlans");
    const designPlansQuery = query(designPlansRef, orderBy("createdAt", "asc"));
    const unsubscribeDesignPlans = onSnapshot(designPlansQuery, (snapshot) => {
      const next: DesignPlan[] = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          title: typeof data.title === "string" ? data.title : "",
          createdAt: toCreatedAtString(data.createdAt) || "",
        };
      });
      setDesignPlans(next);
    });

    const goalTracksRef = collection(db, "users", user.uid, "goalTracks");
    const goalTracksQuery = query(goalTracksRef, orderBy("createdAt", "asc"));
    const unsubscribeGoalTracks = onSnapshot(goalTracksQuery, (snapshot) => {
      const next: GoalTrack[] = snapshot.docs.map((item) => {
        const data = item.data();
        const rw = data.reviewWeekday;
        return {
          id: item.id,
          designPlanId: typeof data.designPlanId === "string" ? data.designPlanId : "",
          title: typeof data.title === "string" ? data.title : "",
          reviewWeekday:
            typeof rw === "number" && rw >= 0 && rw <= 6 ? rw : 6,
          createdAt: toCreatedAtString(data.createdAt) || "",
        };
      });
      setGoalTracks(next);
    });

    const goalTrackEventsRef = collection(db, "users", user.uid, "goalTrackEvents");
    const goalTrackEventsQuery = query(
      goalTrackEventsRef,
      orderBy("createdAt", "desc"),
      limit(150)
    );
    const unsubscribeGoalTrackEvents = onSnapshot(goalTrackEventsQuery, (snapshot) => {
      const next: GoalTrackEvent[] = snapshot.docs.map((item) => {
        const data = item.data();
        const createdAt =
          typeof (data.createdAt as unknown as { toDate?: () => Date })?.toDate === "function"
            ? (data.createdAt as unknown as { toDate: () => Date }).toDate()
            : data.createdAt instanceof Date
              ? data.createdAt
              : new Date();
        return {
          id: item.id,
          goalTrackId: typeof data.goalTrackId === "string" ? data.goalTrackId : "",
          todoId: typeof data.todoId === "string" ? data.todoId : "",
          todoText: typeof data.todoText === "string" ? data.todoText : "",
          dateKey: typeof data.dateKey === "string" ? data.dateKey : "",
          createdAt,
        };
      });
      setGoalTrackEvents(next);
    });

    const last8WeekKeys = getWeekStartKeysForLastNWeeks(8);
    const weeklyReviewsRef = collection(
      db,
      "users",
      user.uid,
      "goalTrackWeeklyReviews"
    );
    const weeklyReviewsQuery = query(
      weeklyReviewsRef,
      where("weekStartKey", "in", last8WeekKeys)
    );
    const unsubscribeWeeklyReviews = onSnapshot(weeklyReviewsQuery, (snapshot) => {
      const next: GoalTrackWeeklyReview[] = snapshot.docs.map((item) => {
        const data = item.data();
        const toDate = (v: unknown): Date => {
          if (typeof (v as { toDate?: () => Date })?.toDate === "function") {
            return (v as { toDate: () => Date }).toDate();
          }
          return v instanceof Date ? v : new Date();
        };
        const rhythm =
          data.rhythm === "steady" || data.rhythm === "sporadic" || data.rhythm === "stopped"
            ? data.rhythm
            : "steady";
        const status =
          data.status === "STEADY" || data.status === "SPORADIC" || data.status === "STOPPED"
            ? data.status
            : rhythm === "steady"
              ? "STEADY"
              : rhythm === "sporadic"
                ? "SPORADIC"
                : "STOPPED";
        const nextWeekRuleText =
          typeof data.nextWeekRuleText === "string"
            ? data.nextWeekRuleText
            : typeof data.nextWeekOneChange === "string"
              ? data.nextWeekOneChange
              : "";
        const plannedWeekdays = Array.isArray(data.plannedWeekdays)
          ? (data.plannedWeekdays as number[]).filter(
              (n) => typeof n === "number" && n >= 0 && n <= 6
            )
          : undefined;
        const nextWeekRules = Array.isArray(data.nextWeekRules)
          ? (
              data.nextWeekRules as Array<{
                text?: string;
                weekday?: number;
                weekdays?: number[];
              }>
            )
              .filter((r) => r && typeof r.text === "string" && r.text.trim())
              .map((r) => {
                const weekdays = Array.isArray(r.weekdays)
                  ? r.weekdays.filter((d) => d >= 0 && d <= 6)
                  : typeof r.weekday === "number" && r.weekday >= 0 && r.weekday <= 6
                    ? [r.weekday]
                    : undefined;
                return {
                  text: (r.text ?? "").trim(),
                  weekdays: weekdays && weekdays.length > 0 ? weekdays : undefined,
                };
              })
          : undefined;
        const blockReason =
          typeof data.blockReason === "string" &&
          Object.values(MissedReasonType).includes(data.blockReason as MissedReasonType)
            ? (data.blockReason as MissedReasonType)
            : undefined;
        return {
          id: item.id,
          goalTrackId: typeof data.goalTrackId === "string" ? data.goalTrackId : "",
          weekStartKey: typeof data.weekStartKey === "string" ? data.weekStartKey : "",
          rhythm,
          status,
          wobbleMoment: typeof data.wobbleMoment === "string" ? data.wobbleMoment : undefined,
          blockReason: blockReason ?? null,
          blockNote: typeof data.blockNote === "string" ? data.blockNote : undefined,
          nextWeekOneChange:
            typeof data.nextWeekOneChange === "string" ? data.nextWeekOneChange : undefined,
          nextWeekRuleText: nextWeekRuleText || undefined,
          nextWeekKeepOne:
            typeof data.nextWeekKeepOne === "string" ? data.nextWeekKeepOne : undefined,
          plannedWeekdays,
          nextWeekRules,
          outcomeMode:
            data.outcomeMode === "metric" ||
            data.outcomeMode === "sense" ||
            data.outcomeMode === "skip"
              ? data.outcomeMode
              : undefined,
          metricLabel: typeof data.metricLabel === "string" ? data.metricLabel : undefined,
          metricValue:
            typeof data.metricValue === "number" ? data.metricValue : undefined,
          metricUnit: typeof data.metricUnit === "string" ? data.metricUnit : undefined,
          sense:
            data.sense === "closer" || data.sense === "same" || data.sense === "farther"
              ? data.sense
              : undefined,
          outcomeNote: typeof data.outcomeNote === "string" ? data.outcomeNote : undefined,
          aiRefinedRuleText:
            typeof data.aiRefinedRuleText === "string" ? data.aiRefinedRuleText : undefined,
          aiRefineRationale:
            typeof data.aiRefineRationale === "string" ? data.aiRefineRationale : undefined,
          coachFact: typeof data.coachFact === "string" ? data.coachFact : undefined,
          coachPattern: typeof data.coachPattern === "string" ? data.coachPattern : undefined,
          coachAction: typeof data.coachAction === "string" ? data.coachAction : undefined,
          coachSummary: typeof data.coachSummary === "string" ? data.coachSummary : undefined,
          coachQuestion: typeof data.coachQuestion === "string" ? data.coachQuestion : undefined,
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt),
        };
      });
      setGoalTrackWeeklyReviews(next);
    });

    const recordsRef = collection(db, "users", user.uid, "records");
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const recordsQuery = query(
      recordsRef,
      where("createdAt", ">=", monthStart),
      where("createdAt", "<", monthEnd),
      orderBy("createdAt", "desc")
    );
    const unsubscribeRecords = onSnapshot(recordsQuery, (snapshot) => {
      const nextRecords: RecordItem[] = snapshot.docs.map((item) => {
        const data = item.data() as Partial<RecordItem> & {
          createdAt?: unknown;
          goalId?: unknown;
        };
        const createdAt =
          typeof (data.createdAt as unknown as { toDate?: () => Date })?.toDate ===
          "function"
            ? (data.createdAt as unknown as { toDate: () => Date }).toDate()
            : data.createdAt instanceof Date
              ? data.createdAt
              : new Date();
        return {
          id: item.id,
          content: typeof data.content === "string" ? data.content : "",
          goalId: typeof data.goalId === "string" ? data.goalId : undefined,
          goalTrackId: typeof data.goalTrackId === "string" ? data.goalTrackId : undefined,
          createdAt,
        };
      });
      setRecordsThisMonth(nextRecords);
    });

    return () => {
      unsubscribeSettings();
      unsubscribeToday();
      unsubscribeYesterday();
      unsubscribeTodos();
      unsubscribeDesignPlans();
      unsubscribeGoalTracks();
      unsubscribeGoalTrackEvents();
      unsubscribeWeeklyReviews();
      unsubscribeRecords();
    };
  }, [user, todayKey, yesterdayKey]);

  useEffect(() => {
    if (!user || !db) return;
    const firestore = db;
    const keys = getLastNDateKeys(7);
    const unsubs = keys.map((dateKey) => {
      const todosRef = collection(
        firestore,
        "users",
        user.uid,
        "days",
        dateKey,
        "todos"
      );
      const q = query(todosRef, orderBy("createdAt", "asc"));
      return onSnapshot(q, (snapshot) => {
        const nextTodos: TodoItem[] = snapshot.docs.map((item) => {
          const data = item.data() as Omit<TodoItem, "id">;
          return {
            id: item.id,
            text: data.text ?? "",
            done: Boolean(data.done),
            effects: Array.isArray(data.effects) ? data.effects : [],
            createdAt: data.createdAt,
            completedAt: data.completedAt,
            dueAt: data.dueAt,
            missedReasonType: normalizeMissedReasonType(data.missedReasonType),
            goalId: typeof data.goalId === "string" ? data.goalId : null,
            goalTrackId:
              typeof data.goalTrackId === "string" ? data.goalTrackId : null,
          };
        });
        setTodosByDateKey((prev) => ({ ...prev, [dateKey]: nextTodos }));
      });
    });
    return () => unsubs.forEach((u) => u());
  }, [user, db, todayKey]);

  useEffect(() => {
    if (!user || !db || goalTrackEventsBackfillRunRef.current) return;
    const completedLinked = todos.filter(
      (t) => t.done && t.goalTrackId && t.text.trim()
    );
    if (completedLinked.length === 0) return;
    const eventIds = new Set(goalTrackEvents.map((e) => e.id));
    const toUpsert = completedLinked.filter((t) => {
      const eid = buildEventId(t.goalTrackId!, t.id, todayKey);
      return !eventIds.has(eid);
    });
    if (toUpsert.length === 0) return;
    goalTrackEventsBackfillRunRef.current = true;
    const eventsRef = collection(db, "users", user.uid, "goalTrackEvents");
    void Promise.all(
      toUpsert.map((t) => {
        const eid = buildEventId(t.goalTrackId!, t.id, todayKey);
        return setDoc(doc(eventsRef, eid), {
          goalTrackId: t.goalTrackId,
          todoId: t.id,
          todoText: t.text,
          dateKey: todayKey,
          createdAt: serverTimestamp(),
        });
      })
    );
  }, [user, db, todos, goalTrackEvents, todayKey]);

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
    if (activeTab !== "wake") return;
    setWakeScreen("list");
  }, [activeTab]);

  useEffect(() => {
    if (wakeRoutines.length === 0) {
      setSelectedWakeRoutineId(null);
      return;
    }
    if (!selectedWakeRoutineId) {
      setSelectedWakeRoutineId(wakeRoutines[0].id);
      return;
    }
    const exists = wakeRoutines.some((routine) => routine.id === selectedWakeRoutineId);
    if (!exists) {
      setSelectedWakeRoutineId(wakeRoutines[0].id);
    }
  }, [wakeRoutines, selectedWakeRoutineId]);

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
    if (typeof window === "undefined" || !buildTime) return;
    let isMounted = true;
    const checkVersion = async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { version?: string };
        if (!isMounted) return;
        if (data?.version && data.version !== buildTime) {
          setUpdateAvailable(true);
        }
      } catch {
        // ignore version check failures
      }
    };
    checkVersion();
    const intervalId = window.setInterval(checkVersion, 60000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [buildTime]);

  useEffect(() => {
    if (!updateAvailable) return;
    if (autoRefreshRef.current) return;
    autoRefreshRef.current = true;
    const refreshIfVisible = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (modalOpen) return;
      handleRefreshApp();
    };
    const timeoutId = window.setTimeout(refreshIfVisible, 1200);
    const onVisibility = () => refreshIfVisible();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [updateAvailable]);

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
    const routinesToSave = normalizeWakeRoutine(settingsDraft.wakeRoutine, todayKey).map(
      (routine, index) => ({
        ...routine,
        title: getRoutineDisplayTitle(routine.title, index),
      })
    );
    await setDoc(
      settingsRef,
      {
        wakeRoutine: toRoutineCollection(routinesToSave),
      },
      { merge: true }
    );
    setRoutineSaved(true);
  };

  const persistWakeRoutine = async (routines: RoutineItem[]) => {
    if (!user || !db) return;
    const settingsRef = doc(db, "users", user.uid, "settings", "main");
    await setDoc(
      settingsRef,
      {
        wakeRoutine: toRoutineCollection(routines),
      },
      { merge: true }
    );
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
    if (linkNewTodoToGoal && !newTodoGoalTrackId) return;
    const todosRef = collection(db, "users", user.uid, "days", todayKey, "todos");
    const dueAtValue = newTodoDueAt ? new Date(newTodoDueAt) : null;
    const normalizedText = newTodo.trim();
    const targetGoalTrackId = linkNewTodoToGoal ? newTodoGoalTrackId : null;
    const dedupKey = [todayKey, normalizedText].join("::");
    const existsAlready = todos.some((todo) => todo.text.trim() === normalizedText);
    if (existsAlready || todoInsertInFlightRef.current.has(dedupKey)) return;
    todoInsertInFlightRef.current.add(dedupKey);
    try {
      const duplicateSnapshot = await getDocs(
        query(todosRef, where("text", "==", normalizedText), limit(1))
      );
      if (!duplicateSnapshot.empty) return;
      await addDoc(todosRef, {
        text: normalizedText,
        done: false,
        effects: [],
        completedAt: null,
        dueAt: dueAtValue,
        goalTrackId: targetGoalTrackId,
        createdAt: serverTimestamp(),
      });
    } finally {
      todoInsertInFlightRef.current.delete(dedupKey);
    }
    setNewTodo("");
    setNewTodoDueAt("");
    setLinkNewTodoToGoal(false);
    setNewTodoDesignPlanId("");
    setNewTodoGoalTrackId("");
  };

  const handleAddDesignPlan = async () => {
    if (!user || !db || !newDesignPlanTitle.trim()) return;
    const ref = collection(db, "users", user.uid, "designPlans");
    await addDoc(ref, {
      title: newDesignPlanTitle.trim(),
      createdAt: serverTimestamp(),
    });
    setNewDesignPlanTitle("");
  };

  const handleRenameDesignPlan = async (id: string, title: string) => {
    if (!user || !db || !title.trim()) return;
    const planRef = doc(db, "users", user.uid, "designPlans", id);
    await updateDoc(planRef, { title: title.trim() });
    setEditingDesignPlanId(null);
    setEditingDesignPlanTitle("");
  };

  const nullifyGoalTrackIdInAllTodos = async (goalTrackId: string) => {
    if (!db || !user) return;
    const daysRef = collection(db, "users", user.uid, "days");
    const daysSnap = await getDocs(daysRef);
    let batch = writeBatch(db);
    let batchCount = 0;
    const BATCH_LIMIT = 450;
    for (const dayDoc of daysSnap.docs) {
      const todosRef = collection(db, "users", user.uid, "days", dayDoc.id, "todos");
      const todosSnap = await getDocs(
        query(todosRef, where("goalTrackId", "==", goalTrackId))
      );
      for (const todoDoc of todosSnap.docs) {
        batch.update(todoDoc.ref, { goalTrackId: null });
        batchCount++;
        if (batchCount >= BATCH_LIMIT) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
    }
    if (batchCount > 0) await batch.commit();
  };

  const handleDeleteDesignPlan = async (id: string) => {
    if (!user || !db) return;
    const tracksToDelete = goalTracks.filter((t) => t.designPlanId === id);
    for (const track of tracksToDelete) {
      await nullifyGoalTrackIdInAllTodos(track.id);
      await deleteGoalTrackEventsByGoalTrackId(db, user.uid, track.id);
    }
    let batch = writeBatch(db);
    for (const track of tracksToDelete) {
      batch.delete(doc(db, "users", user.uid, "goalTracks", track.id));
    }
    batch.delete(doc(db, "users", user.uid, "designPlans", id));
    await batch.commit();
    if (selectedDesignPlanId === id) setSelectedDesignPlanId(null);
  };

  const handleAddGoalTrack = async () => {
    if (!user || !db || !selectedDesignPlanId || !newGoalTrackTitle.trim()) return;
    const ref = collection(db, "users", user.uid, "goalTracks");
    await addDoc(ref, {
      designPlanId: selectedDesignPlanId,
      title: newGoalTrackTitle.trim(),
      reviewWeekday: 6,
      createdAt: serverTimestamp(),
    });
    setNewGoalTrackTitle("");
  };

  const handleRenameGoalTrack = async (id: string, title: string) => {
    if (!user || !db || !title.trim()) return;
    const trackRef = doc(db, "users", user.uid, "goalTracks", id);
    await updateDoc(trackRef, { title: title.trim() });
    setEditingGoalTrackId(null);
    setEditingGoalTrackTitle("");
  };

  const handleUpdateGoalTrackReviewWeekday = async (
    goalTrackId: string,
    reviewWeekday: number
  ) => {
    if (!user || !db) return;
    const track = goalTracks.find((t) => t.id === goalTrackId);
    const designPlanId = track?.designPlanId;
    const tracksToUpdate = designPlanId
      ? goalTracks.filter((t) => t.designPlanId === designPlanId)
      : [{ id: goalTrackId }];
    const batch = writeBatch(db);
    for (const t of tracksToUpdate) {
      const ref = doc(db, "users", user.uid, "goalTracks", t.id);
      batch.update(ref, { reviewWeekday });
    }
    await batch.commit();
    setEditingReviewDayGoalTrackId(null);
  };

  const handleAddTodoFromGoalTrack = async () => {
    if (!user || !db || !addingTodoForGoalTrackId || !goalTrackTodoText.trim()) return;
    const todosRef = collection(db, "users", user.uid, "days", todayKey, "todos");
    const dueAtValue = goalTrackTodoDueAt ? new Date(goalTrackTodoDueAt) : null;
    await addDoc(todosRef, {
      text: goalTrackTodoText.trim(),
      done: false,
      effects: [],
      completedAt: null,
      dueAt: dueAtValue,
      goalTrackId: addingTodoForGoalTrackId,
      createdAt: serverTimestamp(),
    });
    setAddingTodoForGoalTrackId(null);
    setGoalTrackTodoText("");
    setGoalTrackTodoDueAt("");
  };

  const handleDeleteGoalTrack = async (id: string) => {
    if (!user || !db) return;
    await nullifyGoalTrackIdInAllTodos(id);
    await deleteGoalTrackEventsByGoalTrackId(db, user.uid, id);
    const trackRef = doc(db, "users", user.uid, "goalTracks", id);
    await deleteDoc(trackRef);
  };

  const handleAddAiTodoAsTodo = async (
    todoText: string,
    goalTrackId?: string,
    targetDateKey?: string
  ) => {
    if (!user || !db || !todoText.trim()) return;
    const dateKey = targetDateKey ?? todayKey;
    const todosRef = collection(db, "users", user.uid, "days", dateKey, "todos");
    const normalizedText = todoText.trim();
    const targetGoalTrackId = goalTrackId || null;
    const dedupKey = [dateKey, normalizedText].join("::");
    if (todoInsertInFlightRef.current.has(dedupKey)) return;
    todoInsertInFlightRef.current.add(dedupKey);
    try {
      if (dateKey === todayKey && todos.some((todo) => todo.text.trim() === normalizedText)) {
        return;
      }
      const duplicateSnapshot = await getDocs(
        query(todosRef, where("text", "==", normalizedText), limit(1))
      );
      if (!duplicateSnapshot.empty) return;
      await addDoc(todosRef, {
        text: normalizedText,
        done: false,
        effects: [],
        completedAt: null,
        dueAt: null,
        goalTrackId: targetGoalTrackId,
        createdAt: serverTimestamp(),
      });
    } finally {
      todoInsertInFlightRef.current.delete(dedupKey);
    }
  };

  const handleToggleTodo = async (todo: TodoItem) => {
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
    const eventsRef = collection(db, "users", user.uid, "goalTrackEvents");
    const goalTrackId = todo.goalTrackId ?? null;

    if (!todo.done) {
      await updateDoc(todoRef, {
        done: true,
        completedAt: serverTimestamp(),
        effects: [],
      });
      if (goalTrackId) {
        const eventId = buildEventId(goalTrackId, todo.id, todayKey);
        const eventRef = doc(eventsRef, eventId);
        await setDoc(eventRef, {
          goalTrackId,
          todoId: todo.id,
          todoText: todo.text,
          dateKey: todayKey,
          createdAt: serverTimestamp(),
        });
        const track = goalTracks.find((t) => t.id === goalTrackId);
        const trackName = track?.title || "목표";
        setExecutionToast(`${trackName} 실행 1회 기록`);
        window.setTimeout(() => setExecutionToast(null), 2000);
      }
      return;
    }
    await updateDoc(todoRef, { done: false, completedAt: null, effects: [] });
    if (goalTrackId) {
      const eventId = buildEventId(goalTrackId, todo.id, todayKey);
      const eventRef = doc(eventsRef, eventId);
      await deleteDoc(eventRef);
    }
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
    setEffectSelections(() => ({} as Record<EffectType, Effect["intensity"]>));
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
    if (todo.goalTrackId) {
      await deleteGoalTrackEventsByTodoId(db, user.uid, todo.id);
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
    await deleteDoc(todoRef);
  };

  const handleUpdateTodoGoalTrackId = async (
    todo: TodoItem,
    goalTrackId: string | null
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
    await updateDoc(todoRef, { goalTrackId });
    setEditingGoalLinkTodoId(null);
  };

  const handleApplyWeeklyCoachAction = async (
    goalTrackId: string,
    actionText: string,
    weekday: number
  ) => {
    if (!user || !db || !actionText.trim()) return;
    const normalizedText = actionText.trim();
    // weekday: 0=일, 1=월, ... 6=토 (Date.getDay()) → 0=월...6=일 (ISO) 변환
    const isoWeekday = (weekday + 6) % 7;
    const targetDateKey = getNextWeekDateKeyByWeekdayKST(isoWeekday);
    const todosRef = collection(db, "users", user.uid, "days", targetDateKey, "todos");
    const duplicateSnapshot = await getDocs(
      query(todosRef, where("goalTrackId", "==", goalTrackId), limit(50))
    );
    const isDuplicate = duplicateSnapshot.docs.some(
      (d) => (d.data().text as string)?.trim() === normalizedText
    );
    if (isDuplicate) {
      setExecutionToast("이미 추가되어 있어요");
      window.setTimeout(() => setExecutionToast(null), 2000);
      return;
    }
    await addDoc(todosRef, {
      text: normalizedText,
      done: false,
      effects: [],
      completedAt: null,
      dueAt: null,
      goalTrackId,
      createdAt: serverTimestamp(),
    });
    setExecutionToast("다음 주 투두에 추가했어요");
    window.setTimeout(() => setExecutionToast(null), 2000);
  };

  const handleSaveSnapshotOnly = async (data: {
    goalTrackId: string;
    weekStartKey: string;
    outcomeMode?: "metric" | "sense" | "skip";
    metricLabel?: string;
    metricValue?: number | null;
    metricUnit?: string;
    sense?: "closer" | "same" | "farther" | null;
    outcomeNote?: string;
  }) => {
    if (!user || !db) return;
    setWeeklyReviewSaving(true);
    try {
      const reviewId = buildReviewId(data.goalTrackId, data.weekStartKey);
      const reviewRef = doc(
        db,
        "users",
        user.uid,
        "goalTrackWeeklyReviews",
        reviewId
      );
      await updateDoc(reviewRef, {
        outcomeMode: data.outcomeMode ?? null,
        metricLabel: data.metricLabel ?? null,
        metricValue: data.metricValue ?? null,
        metricUnit: data.metricUnit ?? null,
        sense: data.sense ?? null,
        outcomeNote: data.outcomeNote ?? null,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setWeeklyReviewSaving(false);
    }
  };

  const handleSaveWeeklyReview = async (data: {
    goalTrackId: string;
    weekStartKey: string;
    status: "STEADY" | "SPORADIC" | "STOPPED";
    blockReason?: MissedReasonType | null;
    blockNote?: string;
    nextWeekRules: Array<{ text: string; weekdays?: number[] }>;
    outcomeMode?: "metric" | "sense" | "skip";
    metricLabel?: string;
    metricValue?: number | null;
    metricUnit?: string;
    sense?: "closer" | "same" | "farther" | null;
    outcomeNote?: string;
  }) => {
    if (!user || !db) return;
    setWeeklyReviewSaving(true);
    try {
      const counts = calcLast7Days(goalTrackEvents, data.goalTrackId);
      const rhythm =
        data.status === "STEADY"
          ? "steady"
          : data.status === "SPORADIC"
            ? "sporadic"
            : "stopped";
      const firstRuleText = data.nextWeekRules[0]?.text ?? "";
      const coach = buildWeeklyCoach(counts, {
        rhythm,
        wobbleMoment: "",
        nextWeekRuleText: firstRuleText,
      });
      const reviewId = buildReviewId(data.goalTrackId, data.weekStartKey);
      const reviewRef = doc(
        db,
        "users",
        user.uid,
        "goalTrackWeeklyReviews",
        reviewId
      );
      const existingSnap = await getDoc(reviewRef);
      const existingData = existingSnap.exists() ? existingSnap.data() : {};
      const existing = !!existingSnap.exists();
      const mergedNextWeekRules =
        data.nextWeekRules?.length > 0
          ? data.nextWeekRules
          : (existingData.nextWeekRules ?? data.nextWeekRules ?? []);
      const mergedPlannedWeekdays =
        mergedNextWeekRules[0]?.weekdays?.[0] != null
          ? [mergedNextWeekRules[0].weekdays![0]]
          : (existingData.plannedWeekdays ?? null);
      const mergedFirstRuleText = mergedNextWeekRules[0]?.text ?? firstRuleText;
      await setDoc(
        reviewRef,
        {
          goalTrackId: data.goalTrackId,
          weekStartKey: data.weekStartKey,
          rhythm,
          status: data.status,
          blockReason: data.blockReason ?? null,
          blockNote: data.blockNote ?? null,
          nextWeekRuleText: mergedFirstRuleText,
          nextWeekOneChange: mergedFirstRuleText,
          nextWeekRules: mergedNextWeekRules,
          plannedWeekdays: mergedPlannedWeekdays,
          outcomeMode: data.outcomeMode ?? existingData.outcomeMode ?? null,
          metricLabel: data.metricLabel ?? existingData.metricLabel ?? null,
          metricValue: data.metricValue ?? existingData.metricValue ?? null,
          metricUnit: data.metricUnit ?? existingData.metricUnit ?? null,
          sense: data.sense ?? existingData.sense ?? null,
          outcomeNote: data.outcomeNote ?? existingData.outcomeNote ?? null,
          coachFact: coach.fact,
          coachPattern: coach.pattern,
          coachAction: coach.action,
          updatedAt: serverTimestamp(),
          ...(existing ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );
    } finally {
      setWeeklyReviewSaving(false);
    }
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
    await updateDoc(todoRef, {
      missedReasonType: reasonType,
      missedReasonUpdatedAt: serverTimestamp(),
    });
    clearTodoAIResult(todo.id);
    try {
      const interventionsRef = collection(
        db,
        "users",
        user.uid,
        "days",
        todayKey,
        "todoInterventions"
      );
      await addDoc(interventionsRef, {
        todoId: todo.id,
        reasonType,
        kind: "REASON_SELECTED",
        todoText: todo.text,
        createdAt: serverTimestamp(),
      });
    } catch {
      // ignore logging failures
    }
  };

  /* const normalizeMissedReasonType = (value: unknown): MissedReasonType | null => {
    // supports old stored values
    if (value === "FORGOT") return MissedReasonType.COMPLETED_BUT_NOT_CHECKED;
    if (value === "HARD_TO_START") return MissedReasonType.HARD_TO_START;
    if (value === "TIME_MISMATCH") return MissedReasonType.NOT_ENOUGH_TIME;
    if (value === "JUST_SKIP") return MissedReasonType.WANT_TO_REST;
    if (
      value === MissedReasonType.COMPLETED_BUT_NOT_CHECKED ||
      value === MissedReasonType.HARD_TO_START ||
      value === MissedReasonType.NOT_ENOUGH_TIME ||
      value === MissedReasonType.WANT_TO_REST
    ) {\n+      return value as MissedReasonType;\n+    }\n+    return null;\n+  };\n*** End Patch"}?>  北京赛车冠军 code block invalid? Need proper patch string without JSON. We'll redo.

  */

  const normalizeMissedReasonType = (
    value: unknown
  ): MissedReasonType | null => {
    if (value === "FORGOT") return MissedReasonType.COMPLETED_BUT_NOT_CHECKED;
    if (value === "HARD_TO_START") return MissedReasonType.HARD_TO_START;
    if (value === "TIME_MISMATCH") return MissedReasonType.NOT_ENOUGH_TIME;
    if (value === "JUST_SKIP") return MissedReasonType.WANT_TO_REST;
    if (
      value === MissedReasonType.COMPLETED_BUT_NOT_CHECKED ||
      value === MissedReasonType.HARD_TO_START ||
      value === MissedReasonType.NOT_ENOUGH_TIME ||
      value === MissedReasonType.WANT_TO_REST
    ) {
      return value as MissedReasonType;
    }
    return null;
  };

  const handleGenerateReasonHelp = async (todo: TodoItem) => {
    const dueAtMillis = toMillis(todo.dueAt);
    const reasonType = normalizeMissedReasonType(todo.missedReasonType);
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
    const contextQuestions =
      reasonType === MissedReasonType.HARD_TO_START
        ? pickStableQuestions(
            `${todo.id}-${reasonType}`,
            HARD_TO_START_QUESTION_POOL
          )
        : pickStableQuestions(
            `${todo.id}-${reasonType}`,
            NOT_ENOUGH_TIME_QUESTION_POOL
          );
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
                : "NOT_ENOUGH_TIME",
            contextQuestions,
          }),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as {
          result?: {
            conditionMessage: string;
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

  const handleOpenBlockPanel = (todoId: string) => {
    setOpenBlockPanelTodoId((prev) => (prev === todoId ? null : todoId));
    setEditingGoalLinkTodoId(null);
  };

  const handleFetchTodoBlockSuggestion = async (
    todo: TodoItem,
    blockType: BlockType,
    situation?: string
  ) => {
    setBlockSuggestionLoading((prev) => ({ ...prev, [todo.id]: true }));
    setBlockSuggestion((prev) => {
      const next = { ...prev };
      delete next[todo.id];
      return next;
    });
    let result: { question: string; rewrittenTodo: string } | null = null;
    try {
      const response = await fetch("/api/ai/todo-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockType,
          originalTodo: todo.text,
          situation: situation || undefined,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          result?: { question: string; rewrittenTodo: string } | null;
        };
        result = data.result ?? null;
      }
    } catch {
      // fall through to fallback
    }
    if (!result || !result.question || !result.rewrittenTodo) {
      result = fallbackSuggestion(blockType, todo.text);
    }
    setBlockSuggestion((prev) => ({ ...prev, [todo.id]: result! }));
    setBlockSuggestionLoading((prev) => ({ ...prev, [todo.id]: false }));
  };

  const handleApplyTodoBlockSuggestion = async (
    todo: TodoItem,
    newText: string
  ) => {
    if (!user || !db || !newText.trim()) return;
    const todoRef = doc(
      db,
      "users",
      user.uid,
      "days",
      todayKey,
      "todos",
      todo.id
    );
    await updateDoc(todoRef, { text: newText.trim() });
    setBlockSuggestion((prev) => {
      const next = { ...prev };
      delete next[todo.id];
      return next;
    });
    setOpenBlockPanelTodoId(null);
    setExecutionToast("투두 문구를 조정했어요");
    window.setTimeout(() => setExecutionToast(null), 2000);
  };

  const handleConfirmCompletedButNotChecked = async (todo: TodoItem) => {
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
    await updateDoc(todoRef, {
      done: true,
      completedAt: serverTimestamp(),
      completionNote: "COMPLETED_BUT_NOT_CHECKED",
    });
    try {
      const interventionsRef = collection(
        db,
        "users",
        user.uid,
        "days",
        todayKey,
        "todoInterventions"
      );
      await addDoc(interventionsRef, {
        todoId: todo.id,
        reasonType: MissedReasonType.COMPLETED_BUT_NOT_CHECKED,
        kind: "COMPLETED_CONFIRMED",
        todoText: todo.text,
        createdAt: serverTimestamp(),
      });
    } catch {
      // ignore logging failures
    }
  };

  const handlePolishTodoDraft = async () => {
    const rawTodo = todoDraftText.trim();
    if (!rawTodo) return;
    setTodoPolishLoading(true);
    setTodoPolishError("");
    try {
      const response = await fetch("/api/ai/polish-todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawTodo }),
      });
      if (!response.ok) {
        setTodoPolishError("문장 다듬기에 실패했어요.");
        return;
      }
      const data = (await response.json()) as {
        result?: { polishedTodo: string } | null;
      };
      const polishedTodo = data.result?.polishedTodo?.trim() ?? "";
      if (!polishedTodo) {
        setTodoPolishError("다듬은 문장을 받지 못했어요.");
        return;
      }
      setTodoDraftText(polishedTodo);
    } catch {
      setTodoPolishError("문장 다듬기 중 오류가 발생했어요.");
    } finally {
      setTodoPolishLoading(false);
    }
  };

  const handleSubmitGoalTodo = async () => {
    const text = todoDraftText.trim();
    if (!text) return;
    const goalTrackIdForTodo = recordGoalTrackId || undefined;
    await handleAddAiTodoAsTodo(text, goalTrackIdForTodo);
    setTodoDraftText("");
    setTodoPolishError("");
    setTodoModalOpen(false);
  };

  const handleAddRecordItem = async () => {
    if (!user || !db) return;
    const content = recordDraft.trim();
    if (!content) return;
    try {
      const recordsRef = collection(db, "users", user.uid, "records");
      await addDoc(recordsRef, {
        content,
        goalTrackId: recordGoalTrackId || null,
        createdAt: serverTimestamp(),
      });
      setRecordDraft("");
    } catch {
      // ignore record save failures
    }
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
        await Promise.all(
          registrations.map(async (registration) => {
            try {
              await registration.update();
              registration.waiting?.postMessage({ type: "SKIP_WAITING" });
            } catch {
              // ignore update failures
            }
            await registration.unregister();
          })
        );
      }
      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      }
    } catch {
      // ignore cache or service worker failures
    }
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("v", `${Date.now()}`);
    window.location.replace(nextUrl.toString());
    window.setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        // ignore reload failures
      }
    }, 1500);
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

  const updateWakeRoutineInDraft = (
    updater: (routines: RoutineItem[]) => RoutineItem[],
    options?: { persist?: boolean }
  ) => {
    setSettingsDraft((prev) => {
      const current = normalizeWakeRoutine(prev.wakeRoutine, todayKey);
      const nextWakeRoutine = updater(current);
      if (options?.persist) {
        void persistWakeRoutine(nextWakeRoutine);
      }
      return {
        ...prev,
        wakeRoutine: toRoutineCollection(nextWakeRoutine),
      };
    });
  };

  const handleAddRoutine = () => {
    const trimmed = newRoutineText.trim();
    if (!trimmed) return;
    updateWakeRoutineInDraft((routines) => {
      const routine =
        routines.find((item) => item.id === selectedWakeRoutineId) ?? routines[0];
      if (!routine) {
        const createdRoutineId = `routine-${Date.now()}`;
        setSelectedWakeRoutineId(createdRoutineId);
        return [makeDefaultRoutine(createdRoutineId, [{ id: `${Date.now()}-task`, title: trimmed, completed: false }])];
      }
      return routines.map((item) =>
        item.id === routine.id
          ? {
              ...item,
              tasks: [
                ...item.tasks,
                { id: `${Date.now()}-task`, title: trimmed, completed: false },
              ],
            }
          : item
      );
    });
    setNewRoutineText("");
  };

  const handleCreateRoutine = () => {
    const nextRoutineId = `routine-${Date.now()}`;
    updateWakeRoutineInDraft((routines) => [
      ...routines,
      {
        ...makeDefaultRoutine(nextRoutineId, []),
        title: `루틴 ${routines.length + 1}`,
      },
    ]);
    setSelectedWakeRoutineId(nextRoutineId);
    setWakeScreen("edit");
  };

  const handleDeleteRoutine = (routineId: string) => {
    updateWakeRoutineInDraft((routines) =>
      routines.filter((routine) => routine.id !== routineId)
    );
    setSelectedWakeRoutineId((prev) => (prev === routineId ? null : prev));
    setWakeScreen("list");
  };

  const handleUpdateRoutineTitle = (routineId: string, title: string) => {
    updateWakeRoutineInDraft((routines) =>
      routines.map((routine) =>
        routine.id === routineId
          ? {
              ...routine,
              title,
            }
          : routine
      )
    );
  };

  const handleRemoveRoutineTask = (routineId: string, taskId: string) => {
    updateWakeRoutineInDraft((routines) =>
      routines.map((routine) =>
        routine.id === routineId
          ? {
              ...routine,
              tasks: routine.tasks.filter((task) => task.id !== taskId),
            }
          : routine
      )
    );
  };

  const handleToggleRoutineTask = (routineId: string, taskId: string) => {
    updateWakeRoutineInDraft(
      (routines) =>
        routines.map((routine) =>
          routine.id === routineId
            ? {
                ...routine,
                tasks: routine.tasks.map((task) =>
                  task.id === taskId
                    ? {
                        ...task,
                        completed: !task.completed,
                      }
                    : task
                ),
              }
            : routine
        ),
      { persist: true }
    );
  };

  const handleChangeRoutineTrigger = (
    routineId: string,
    triggerType: RoutineTriggerType
  ) => {
    updateWakeRoutineInDraft((routines) =>
      routines.map((routine) =>
        routine.id === routineId
          ? {
              ...routine,
              triggerType,
            }
          : routine
      )
    );
  };

  const handleCompleteWakeRoutine = () => {
    if (!activeWakeRoutine || !activeWakeRoutineAllDone || activeWakeRoutineCompletedToday) {
      return;
    }
    updateWakeRoutineInDraft(
      (routines) =>
        routines.map((routine) => {
          if (routine.id !== activeWakeRoutine.id) return routine;
          const lastCompletedDate = routine.lastCompletedDate;
          const diffDays = lastCompletedDate
            ? diffDaysBetweenDateKeys(lastCompletedDate, todayKey)
            : null;
          const canKeepStreak =
            diffDays !== null && diffDays > 0 && diffDays - 1 <= ROUTINE_STREAK_GRACE_DAYS;
          const nextStreak = canKeepStreak ? routine.streak + 1 : 1;
          const completionHistory = Array.from(
            new Set([...(routine.completionHistory ?? []), todayKey])
          ).sort();
          return {
            ...routine,
            streak: nextStreak,
            totalCompletedDays: routine.totalCompletedDays + 1,
            lastCompletedDate: todayKey,
            monthlySuccessRate: calculateMonthlySuccessRate(completionHistory, todayKey),
            completionHistory,
          };
        }),
      { persist: true }
    );
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
              className={uiSecondaryButton}
              onClick={handleRefreshApp}
            >
              새로고침
            </button>
            <button
              className={uiSecondaryButton}
              onClick={handleSignOut}
            >
              로그아웃
            </button>
          </div>
        </header>

        {activeTab === "home" && (
          <>
            <section className={uiCard}>
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
                  className="h-11 rounded-full border border-slate-200 px-2 font-semibold text-slate-700"
                  onClick={() => setActiveTab("log")}
                >
                  기록 작성
                </button>
                <button
                  className="h-11 rounded-full border border-slate-200 px-2 font-semibold text-slate-700"
                  onClick={() => setActiveTab("todos")}
                >
                  투두 확인
                </button>
                <button
                  className="h-11 rounded-full border border-slate-200 px-2 font-semibold text-slate-700"
                  onClick={() => setActiveTab("calendar")}
                >
                  달력 보기
                </button>
              </div>
            </section>

            <section className={uiCard}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">성장 대시보드</p>
                <p className="text-xs text-slate-400">이번 달 기준</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-2xl border border-slate-100 px-3 py-3">
                  <p className="text-[11px] text-slate-400">오늘 완료</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {todoLogic.todoCompletedCount}개
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 px-3 py-3">
                  <p className="text-[11px] text-slate-400">이번 달 기록</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {thisMonthRecordCount}개
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 px-3 py-3">
                  <p className="text-[11px] text-slate-400">목표</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {goalTracks.length}개
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {goalTracks.length === 0 && (
                  <p className="text-xs text-slate-400">
                    아직 목표가 없어요. 설계 탭에서 목표를 만들어보세요.
                  </p>
                )}
                {goalTracks.slice(0, 3).map((track) => (
                  <div
                    key={track.id}
                    className="rounded-2xl border border-slate-100 px-4 py-3"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {track.title || "제목 없는 목표"}
                    </p>
                    <button
                      type="button"
                      className="mt-2 h-10 w-full rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-600"
                      onClick={() => setActiveTab("design")}
                    >
                      설계 보기 →
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className={uiCard}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">오늘 실행</p>
                <p className="text-xs text-slate-400">목표에서 내려온 할 일</p>
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

            <section className={uiCard}>
              <p className="text-sm font-semibold">실행 추가</p>
              <p className="text-xs text-slate-400">
                목표에서 내려온 실행을 추가하세요.
              </p>
              <div className={`mt-3 ${uiInputPanel} flex flex-col gap-2`}>
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
                  className={uiPrimaryButton}
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
            <section className={uiCard}>
              <p className="text-sm font-semibold">루틴</p>
              <p className="text-xs text-slate-400">
                여러 루틴을 만들고 선택해서 실행하세요.
              </p>
            </section>

            {wakeScreen === "list" && (
              <>
                {wakeRoutines.length === 0 ? (
                  <section className={uiCard}>
                    <p className="text-sm font-semibold">루틴이 없어요</p>
                    <p className="mt-1 text-xs text-slate-400">
                      아래 버튼으로 첫 루틴을 만들어 보세요.
                    </p>
                  </section>
                ) : (
                  wakeRoutines.map((routine, index) => (
                    <section key={routine.id} className={uiCard}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {getRoutineDisplayTitle(routine.title, index)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            🔥 {routine.streak}일 · 성공률 {routine.monthlySuccessRate}%
                          </p>
                        </div>
                        <details className="relative">
                          <summary className="cursor-pointer list-none rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500">
                            ⋯
                          </summary>
                          <div className="absolute right-0 z-20 mt-2 w-28 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                            <button
                              type="button"
                              className="w-full rounded-xl px-2 py-2 text-left text-xs text-slate-600 hover:bg-slate-50"
                              onClick={() => {
                                setSelectedWakeRoutineId(routine.id);
                                setWakeScreen("edit");
                              }}
                            >
                              편집
                            </button>
                            <button
                              type="button"
                              className="w-full rounded-xl px-2 py-2 text-left text-xs text-rose-500 hover:bg-rose-50"
                              onClick={() => handleDeleteRoutine(routine.id)}
                            >
                              삭제
                            </button>
                          </div>
                        </details>
                      </div>
                      <button
                        type="button"
                        className="mt-4 h-11 w-full rounded-full bg-slate-900 px-4 text-xs font-semibold text-white"
                        onClick={() => {
                          setSelectedWakeRoutineId(routine.id);
                          setWakeScreen("execute");
                        }}
                      >
                        실행하기
                      </button>
                    </section>
                  ))
                )}
                <section className={uiCard}>
                  <button
                    type="button"
                    className={uiPrimaryButton}
                    onClick={handleCreateRoutine}
                  >
                    + 루틴 추가
                  </button>
                </section>
              </>
            )}

            {wakeScreen === "execute" && activeWakeRoutine && (
              <section className={uiCard}>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500"
                  onClick={() => setWakeScreen("list")}
                >
                  ← 목록으로
                </button>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-100 px-4 py-3">
                    <p className="text-[11px] text-slate-400">루틴 이름</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {getRoutineDisplayTitle(
                        activeWakeRoutine.title,
                        activeWakeRoutineIndex >= 0 ? activeWakeRoutineIndex : 0
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 px-4 py-3">
                    <p className="text-[11px] text-slate-400">연속 성공일</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      🔥 {activeWakeRoutine.streak}일
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {activeWakeRoutine.tasks.length === 0 && (
                    <p className="text-xs text-slate-400">
                      태스크가 없어요. 편집 화면에서 추가해 주세요.
                    </p>
                  )}
                  {activeWakeRoutine.tasks.map((task) => (
                    <label
                      key={task.id}
                      className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${
                        task.completed
                          ? "scale-[1.01] border-emerald-200 bg-emerald-50/70"
                          : "border-slate-100 bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => handleToggleRoutineTask(activeWakeRoutine.id, task.id)}
                        className="h-4 w-4 accent-slate-900"
                      />
                      <span
                        className={`text-sm transition ${
                          task.completed
                            ? "font-semibold text-emerald-700 line-through"
                            : "text-slate-700"
                        }`}
                      >
                        {getIconForRoutine(task.title)} {task.title}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className={`mt-4 h-11 w-full rounded-full px-4 text-xs font-semibold transition ${
                    activeWakeRoutineAllDone && !activeWakeRoutineCompletedToday
                      ? "bg-slate-900 text-white"
                      : "bg-slate-200 text-slate-400"
                  }`}
                  onClick={handleCompleteWakeRoutine}
                  disabled={!activeWakeRoutineAllDone || activeWakeRoutineCompletedToday}
                >
                  {activeWakeRoutineCompletedToday
                    ? "오늘 루틴 완료됨"
                    : "오늘 완료하기"}
                </button>
              </section>
            )}

            {wakeScreen === "edit" && activeWakeRoutine && (
              <>
                <section className={uiCard}>
                  <button
                    type="button"
                    className="text-xs font-semibold text-slate-500"
                    onClick={() => setWakeScreen("list")}
                  >
                    ← 목록으로
                  </button>
                  <div className={`mt-3 ${uiInputPanel}`}>
                    <p className="text-xs font-semibold text-slate-600">루틴 이름</p>
                    <input
                      value={activeWakeRoutine.title}
                      onChange={(event) =>
                        handleUpdateRoutineTitle(activeWakeRoutine.id, event.target.value)
                      }
                      placeholder="루틴 이름"
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className={`mt-3 ${uiInputPanel}`}>
                    <p className="text-xs font-semibold text-slate-600">트리거 방식</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {([
                        { key: "alarm", label: "알람" },
                        { key: "manual", label: "수동 시작" },
                        { key: "location", label: "위치" },
                      ] as const).map((trigger) => (
                        <button
                          key={trigger.key}
                          type="button"
                          className={`h-9 rounded-full text-[11px] font-semibold ${
                            (activeWakeRoutine.triggerType ?? "alarm") === trigger.key
                              ? "bg-slate-900 text-white"
                              : "border border-slate-200 bg-white text-slate-600"
                          }`}
                          onClick={() =>
                            handleChangeRoutineTrigger(activeWakeRoutine.id, trigger.key)
                          }
                        >
                          {trigger.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
                <section className={uiCard}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">루틴 편집</p>
                      <p className="text-xs text-slate-400">
                        실행 설정을 수정합니다.
                      </p>
                    </div>
                  </div>
                  <div className={`mt-3 ${uiInputPanel} flex gap-2`}>
                    <input
                      value={newRoutineText}
                      onChange={(event) => setNewRoutineText(event.target.value)}
                      placeholder="예) 물 한 컵 마시기"
                      className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                    />
                    <button
                      className="h-11 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white"
                      onClick={handleAddRoutine}
                    >
                      추가
                    </button>
                  </div>
                  <div className="mt-3 space-y-2 text-xs">
                    {activeWakeRoutine.tasks.map((task, index) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-100 px-3 py-2"
                      >
                        <span className="text-sm text-slate-700">
                          {getIconForRoutine(task.title)} {index + 1}. {task.title}
                        </span>
                        <button
                          className="text-xs text-slate-400"
                          onClick={() =>
                            handleRemoveRoutineTask(activeWakeRoutine.id, task.id)
                          }
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className={`mt-4 ${uiPrimaryButton}`}
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
          </>
        )}

        {activeTab === "shield" && (
          <>
            <section className={uiCard}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">보호 시간 설정</p>
                  <p className="text-xs text-slate-400">
                    보호 시간을 직접 설정할 수 있어요.
                  </p>
                </div>
              </div>
              <div className={`mt-4 ${uiInputPanel} flex items-center gap-3`}>
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
                className={`mt-4 ${uiPrimaryButton}`}
                onClick={handleSaveWakeSettings}
              >
                보호 시간 저장
              </button>
            </section>

            <section className={uiCard}>
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
              <div className={`mt-4 ${uiInputPanel} grid grid-cols-3 gap-2 text-xs`}>
                {distractionApps.map((app) => (
                  <div key={app.id} className="flex flex-col gap-1">
                    <button
                      className="h-11 rounded-full border border-slate-200 px-2 text-center"
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
              <div className={`mt-3 ${uiInputPanel} flex gap-2`}>
                <input
                  value={newAppLabel}
                  onChange={(event) => setNewAppLabel(event.target.value)}
                  placeholder="차단 앱 추가"
                  className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  className="h-11 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white"
                  onClick={handleAddApp}
                >
                  추가
                </button>
              </div>
            </section>
          </>
        )}

        {(activeTab === "log" || activeTab === "design") && (
          <>
            {activeTab === "log" && (
              <section className={uiCard}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLogSection("daily")}
                  className={`h-10 rounded-full border px-2 text-center font-semibold ${
                    logSection === "daily"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  오늘 기록
                </button>
                <button
                  type="button"
                  onClick={() => setLogSection("record")}
                  className={`h-10 rounded-full border px-2 text-center font-semibold ${
                    logSection === "record"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  실행 기록
                </button>
                </div>
              </section>
            )}

            {activeTab === "log" && logSection === "daily" && (
              <section className={uiCard}>
                <p className="text-sm font-semibold">오늘 기록</p>
                <p className="text-xs text-slate-400">
                  하루가 끝나기 전에 오늘을 정리해요.
                </p>
                <div className={`mt-4 ${uiInputPanel} space-y-4 text-sm`}>
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

            {activeTab === "design" && (
              <>
              <section className={uiCard}>
                <p className="text-sm font-semibold">설계 / 목표 관리</p>
                <p className="mt-1 text-xs text-slate-400">
                  설계(상위)를 만들고 그 아래 목표/주제를 추가하세요.
                </p>
                <div className={`mt-3 ${uiInputPanel} flex gap-2`}>
                  <input
                    value={newDesignPlanTitle}
                    onChange={(e) => setNewDesignPlanTitle(e.target.value)}
                    placeholder="설계 이름 (예: 수능 전체 1등급)"
                    className="flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    className="h-11 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white disabled:bg-slate-300"
                    onClick={handleAddDesignPlan}
                    disabled={!newDesignPlanTitle.trim()}
                  >
                    추가
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {designPlans.length === 0 && (
                    <p className="text-xs text-slate-400">등록된 설계가 없어요.</p>
                  )}
                  {designPlans.map((plan) => (
                    <div
                      key={plan.id}
                      className={`rounded-2xl border px-3 py-3 ${
                        selectedDesignPlanId === plan.id
                          ? "border-slate-900 bg-slate-50"
                          : "border-slate-100"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        {editingDesignPlanId === plan.id ? (
                          <div className="flex flex-1 items-center gap-2">
                            <input
                              value={editingDesignPlanTitle}
                              onChange={(e) => setEditingDesignPlanTitle(e.target.value)}
                              className="flex-1 rounded-xl border border-slate-200 px-2 py-1 text-sm"
                              placeholder="설계 이름"
                              autoFocus
                            />
                            <button
                              type="button"
                              className="text-xs font-semibold text-slate-600"
                              onClick={() =>
                                handleRenameDesignPlan(plan.id, editingDesignPlanTitle)
                              }
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              className="text-xs text-slate-400"
                              onClick={() => {
                                setEditingDesignPlanId(null);
                                setEditingDesignPlanTitle("");
                              }}
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="flex-1 text-left text-sm font-semibold text-slate-900"
                              onClick={() =>
                                setSelectedDesignPlanId(
                                  selectedDesignPlanId === plan.id ? null : plan.id
                                )
                              }
                            >
                              {plan.title || "제목 없음"}
                            </button>
                            <button
                              type="button"
                              className="text-xs text-slate-400 hover:text-slate-600"
                              onClick={() => {
                                setEditingDesignPlanId(plan.id);
                                setEditingDesignPlanTitle(plan.title || "");
                              }}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="text-xs text-slate-400 hover:text-rose-500"
                              onClick={() => handleDeleteDesignPlan(plan.id)}
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                      {selectedDesignPlanId === plan.id && (
                        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                          <div className="flex gap-2">
                            <input
                              value={newGoalTrackTitle}
                              onChange={(e) => setNewGoalTrackTitle(e.target.value)}
                              placeholder="목표/주제 (예: 수학 1등급)"
                              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            />
                            <button
                              type="button"
                              className="h-9 rounded-full bg-slate-900 px-3 text-xs font-semibold text-white disabled:bg-slate-300"
                              onClick={handleAddGoalTrack}
                              disabled={!newGoalTrackTitle.trim()}
                            >
                              추가
                            </button>
                          </div>
                          {goalTracks
                            .filter((t) => t.designPlanId === plan.id)
                            .map((track) => (
                              <div
                                key={track.id}
                                className="mb-5 rounded-[14px] border border-black/[0.08] bg-white px-5 py-5 transition-colors hover:border-black/20"
                              >
                                {editingGoalTrackId === track.id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      value={editingGoalTrackTitle}
                                      onChange={(e) => setEditingGoalTrackTitle(e.target.value)}
                                      className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                                      placeholder="목표/주제"
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      className="text-xs font-semibold text-slate-600"
                                      onClick={() =>
                                        handleRenameGoalTrack(track.id, editingGoalTrackTitle)
                                      }
                                    >
                                      저장
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs text-slate-400"
                                      onClick={() => {
                                        setEditingGoalTrackId(null);
                                        setEditingGoalTrackTitle("");
                                      }}
                                    >
                                      취소
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm text-slate-700">
                                      {track.title || "제목 없음"}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        className="text-xs text-slate-400 hover:text-slate-600"
                                        onClick={() => {
                                          setEditingGoalTrackId(track.id);
                                          setEditingGoalTrackTitle(track.title || "");
                                        }}
                                      >
                                        수정
                                      </button>
                                      <button
                                        type="button"
                                        className="text-xs text-slate-400 hover:text-rose-500"
                                        onClick={() => handleDeleteGoalTrack(track.id)}
                                      >
                                        삭제
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {addingTodoForGoalTrackId === track.id ? (
                                  <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-2">
                                    <input
                                      value={goalTrackTodoText}
                                      onChange={(e) => setGoalTrackTodoText(e.target.value)}
                                      placeholder="투두 입력"
                                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                                    />
                                    <input
                                      type="datetime-local"
                                      value={goalTrackTodoDueAt}
                                      onChange={(e) => setGoalTrackTodoDueAt(e.target.value)}
                                      className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        className="flex-1 rounded-full bg-slate-900 px-2 py-1 text-xs font-semibold text-white disabled:bg-slate-300"
                                        onClick={handleAddTodoFromGoalTrack}
                                        disabled={!goalTrackTodoText.trim()}
                                      >
                                        추가
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500"
                                        onClick={() => {
                                          setAddingTodoForGoalTrackId(null);
                                          setGoalTrackTodoText("");
                                          setGoalTrackTodoDueAt("");
                                        }}
                                      >
                                        취소
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="mt-2 w-full rounded-lg border border-dashed border-slate-200 py-1 text-xs text-slate-500 hover:border-slate-300"
                                    onClick={() => setAddingTodoForGoalTrackId(track.id)}
                                  >
                                    + 투두 추가
                                  </button>
                                )}
                                <WeeklyReviewCard
                                  track={track}
                                  review={
                                    goalTrackWeeklyReviews.find(
                                      (r) =>
                                        r.goalTrackId === track.id &&
                                        r.weekStartKey === getWeekStartKeyKST()
                                    ) ?? null
                                  }
                                  weekStartKey={getWeekStartKeyKST()}
                                  planReviewWeekday={
                                    goalTracks.filter(
                                      (t) => t.designPlanId === plan.id
                                    )[0]?.reviewWeekday ?? 6
                                  }
                                  last7DaysCounts={calcLast7Days(goalTrackEvents, track.id)}
                                  last7DaysCompletionRatios={calcLast7DaysCompletionRatios(
                                    todosByDateKey,
                                    track.id,
                                    getLastNDateKeys(7)
                                  )}
                                  recentExecution={(() => {
                                    const counts = calcLast7Days(
                                      goalTrackEvents,
                                      track.id
                                    );
                                    const keys = getLastNDateKeys(7);
                                    const executedDays = getExecutedDayCount(
                                      counts,
                                      keys
                                    );
                                    const recent = recentEvents(
                                      goalTrackEvents,
                                      track.id,
                                      1
                                    );
                                    return {
                                      executedDays,
                                      lastExecutedText:
                                        recent[0]?.todoText ?? "",
                                    };
                                  })()}
                                  editingReviewDayGoalTrackId={
                                    editingReviewDayGoalTrackId
                                  }
                                  onUpdateReviewWeekday={
                                    handleUpdateGoalTrackReviewWeekday
                                  }
                                  onEditingReviewDayChange={
                                    setEditingReviewDayGoalTrackId
                                  }
                                  onApplyAction={handleApplyWeeklyCoachAction}
                                  onSave={handleSaveWeeklyReview}
                                  onSaveSnapshotOnly={handleSaveSnapshotOnly}
                                  reviewContentExpanded={weeklyReviewContentExpanded}
                                  onReviewContentExpandedChange={
                                    setWeeklyReviewContentExpanded
                                  }
                                  saving={weeklyReviewSaving}
                                />
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>


              </>
            )}

            {activeTab === "log" && logSection === "record" && (
              <section className={uiCard}>
                <p className="text-sm font-semibold">목표 연결 기록</p>
                <p className="text-xs text-slate-400">
                  실행한 것을 기록하면 성장 진행률에 반영돼요.
                </p>
                <div className={`mt-4 ${uiInputPanel} space-y-2`}>
                  <textarea
                    value={recordDraft}
                    onChange={(event) => setRecordDraft(event.target.value)}
                    rows={2}
                    className="w-full rounded-2xl border border-slate-200 p-3 text-sm"
                    placeholder="예) 핵심 자료 1개 저장"
                  />
                  <select
                    value={recordGoalTrackId}
                    onChange={(event) => setRecordGoalTrackId(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">목표 선택(선택 안 함)</option>
                    {goalTracks.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.title || "제목 없는 목표"}
                      </option>
                    ))}
                  </select>
                  <button
                    className={`w-full rounded-full px-4 py-2 text-xs font-semibold ${
                      recordDraft.trim()
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-400"
                    }`}
                    onClick={handleAddRecordItem}
                    disabled={!recordDraft.trim()}
                  >
                    기록 추가
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {recordsThisMonth.length === 0 && (
                    <p className="text-xs text-slate-400">
                      이번 달 기록이 아직 없어요.
                    </p>
                  )}
                  {recordsThisMonth.slice(0, 8).map((record) => {
                    const goalId = record.goalTrackId ?? record.goalId;
                    const linkedTrack = goalTracks.find(
                      (t) => t.id === goalId
                    );
                    return (
                      <div
                        key={record.id}
                        className="rounded-2xl border border-slate-100 px-3 py-2"
                      >
                        <p className="text-sm text-slate-800">{record.content}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {linkedTrack ? linkedTrack.title : "목표 미선택"} ·{" "}
                          {record.createdAt.toLocaleString()}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === "calendar" && (
          <section className={uiCard}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">달력</p>
                <p className="text-xs text-slate-400">
                  날짜를 눌러 일정과 할 일을 추가하세요.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="h-9 rounded-full border border-slate-200 px-3 text-xs text-slate-500"
                  onClick={handlePreviousMonth}
                >
                  이전
                </button>
                <button
                  className="h-9 rounded-full border border-slate-200 px-3 text-xs text-slate-500"
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
          <section className={uiCard}>
            <p className="text-sm font-semibold">오늘 투두리스트</p>
            <p className="text-xs text-slate-400">
              복습을 끝냈으니 오늘의 할 일을 정리해요.
            </p>
            <div className={`mt-4 ${uiInputPanel} flex flex-col gap-2`}>
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
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={linkNewTodoToGoal}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setLinkNewTodoToGoal(checked);
                    if (!checked) {
                      setNewTodoDesignPlanId("");
                      setNewTodoGoalTrackId("");
                    }
                  }}
                  className="h-4 w-4"
                />
                이 투두를 목표에 연결하기
              </label>
              {linkNewTodoToGoal && (
                <div className="flex flex-col gap-2">
                  <select
                    value={newTodoDesignPlanId}
                    onChange={(event) => {
                      setNewTodoDesignPlanId(event.target.value);
                      setNewTodoGoalTrackId("");
                    }}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">설계 선택</option>
                    {designPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.title || "제목 없음"}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newTodoGoalTrackId}
                    onChange={(event) => setNewTodoGoalTrackId(event.target.value)}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                    disabled={!newTodoDesignPlanId}
                  >
                    <option value="">목표/주제 선택</option>
                    {goalTracks
                      .filter((t) => t.designPlanId === newTodoDesignPlanId)
                      .map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.title || "제목 없음"}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <button
                className={uiPrimaryButton}
                onClick={handleAddTodo}
                disabled={linkNewTodoToGoal && !newTodoGoalTrackId}
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
                  const selectedReason = normalizeMissedReasonType(
                    todo.missedReasonType
                  );
                  const aiReady =
                    isOverdue &&
                    selectedReason !== null &&
                    AI_ELIGIBLE_REASONS.has(selectedReason);
                  const aiResult = todoAIResults[todo.id];
                  const aiError = todoAIError[todo.id];
                  const aiLoading = todoAILoading[todo.id];
                  const interventionQuestions =
                    selectedReason === MissedReasonType.HARD_TO_START
                      ? pickStableQuestions(
                          `${todo.id}-${selectedReason}`,
                          HARD_TO_START_QUESTION_POOL
                        )
                      : selectedReason === MissedReasonType.NOT_ENOUGH_TIME
                        ? pickStableQuestions(
                            `${todo.id}-${selectedReason}`,
                            NOT_ENOUGH_TIME_QUESTION_POOL
                          )
                        : [];
                  const linkedGoalTrackId = getTodoGoalTrackId(todo);
                  const linkedTrack = linkedGoalTrackId
                    ? goalTracks.find((t) => t.id === linkedGoalTrackId)
                    : null;
                  const isEditingGoalLink = editingGoalLinkTodoId === todo.id;
                  return (
                <div
                  key={todo.id}
                  className={`rounded-2xl border px-3 py-3 ${
                    linkedGoalTrackId
                      ? "border-l-2 border-l-slate-300 border-slate-100"
                      : "border-slate-100"
                  }`}
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
                          {linkedGoalTrackId && (
                            <span className="mr-1.5 text-[10px] opacity-60" aria-hidden>🎯</span>
                          )}
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
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          className="text-[11px] text-slate-500 underline-offset-1 hover:underline"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditingGoalLinkTodoId(isEditingGoalLink ? null : todo.id);
                            setOpenBlockPanelTodoId(null);
                          }}
                        >
                          {linkedGoalTrackId ? "변경" : "목표 연결"}
                        </button>
                        {linkedGoalTrackId && !todo.done && (
                          <button
                            type="button"
                            className="text-[11px] text-slate-500 underline-offset-1 hover:underline"
                            onClick={(e) => {
                              e.preventDefault();
                              handleOpenBlockPanel(todo.id);
                            }}
                          >
                            막힘 해결
                          </button>
                        )}
                        {linkedTrack && !isEditingGoalLink && (
                          <span className="text-[11px] text-slate-400">
                            → {linkedTrack.title || "목표"}
                          </span>
                        )}
                      </div>
                      {isEditingGoalLink && (
                        <InlineGoalLinkEditor
                          designPlans={designPlans}
                          goalTracks={goalTracks}
                          currentGoalTrackId={linkedGoalTrackId}
                          initialDesignPlanId={linkedTrack?.designPlanId ?? null}
                          initialGoalTrackId={linkedGoalTrackId}
                          onSave={(id) => handleUpdateTodoGoalTrackId(todo, id)}
                          onCancel={() => setEditingGoalLinkTodoId(null)}
                          onUnlink={() => handleUpdateTodoGoalTrackId(todo, null)}
                        />
                      )}
                      {openBlockPanelTodoId === todo.id && linkedGoalTrackId && (
                        <TodoBlockPanel
                          suggestion={blockSuggestion[todo.id] ?? null}
                          loading={blockSuggestionLoading[todo.id] ?? false}
                          rhythm={(() => {
                            const counts = calcLast7Days(
                              goalTrackEvents,
                              linkedGoalTrackId!
                            );
                            const keys = getLastNDateKeys(7);
                            return calcRhythmImpact(counts, keys);
                          })()}
                          onFetch={(blockType, situation) =>
                            handleFetchTodoBlockSuggestion(todo, blockType, situation)
                          }
                          onApply={(newText) =>
                            handleApplyTodoBlockSuggestion(todo, newText)
                          }
                          onClose={() => setOpenBlockPanelTodoId(null)}
                        />
                      )}
                      {dueAtMillis !== null && (
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
                            어디서 막혔는지 선택하세요
                          </label>
                          <select
                            value={selectedReason ?? ""}
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
                            {[
                              MissedReasonType.COMPLETED_BUT_NOT_CHECKED,
                              MissedReasonType.HARD_TO_START,
                              MissedReasonType.NOT_ENOUGH_TIME,
                              MissedReasonType.WANT_TO_REST,
                            ].map((reason) => (
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
                            {aiLoading
                              ? "생성 중..."
                              : "기존 투두 수정 제안"}
                          </button>
                          {aiError && (
                            <p className="mt-1 text-[11px] text-rose-400">
                              {aiError}
                            </p>
                          )}
                        </div>
                      )}
                      {!todo.done &&
                        isOverdue &&
                        selectedReason ===
                          MissedReasonType.COMPLETED_BUT_NOT_CHECKED && (
                          <div className="mt-2">
                            <button
                              className="w-full rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                              type="button"
                              onClick={() =>
                                handleConfirmCompletedButNotChecked(todo)
                              }
                            >
                              완료 처리할까요?
                            </button>
                          </div>
                        )}
                      {!todo.done &&
                        isOverdue &&
                        selectedReason === MissedReasonType.WANT_TO_REST && (
                          <p className="mt-2 text-xs text-slate-500">
                            오늘은 회복이 우선이에요. 기록만 남겼어요.
                          </p>
                        )}
                      {interventionQuestions.length > 0 && (
                        <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                          <p className="text-[11px] text-slate-400">
                            생각을 꺼내는 질문
                          </p>
                          <div className="mt-2 space-y-1 text-xs text-slate-600">
                            {interventionQuestions.map((question) => (
                              <p key={question}>· {question}</p>
                            ))}
                          </div>
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
                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <p className="text-[11px] text-slate-400">
                                {aiResult.conditionMessage}
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
                                기존 투두 수정
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
          className="mx-auto grid w-full max-w-md grid-cols-7 gap-2 px-4 py-3 text-xs text-slate-500"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          {[
            { key: "home", label: "홈" },
            { key: "wake", label: "루틴" },
            { key: "shield", label: "보호" },
            { key: "log", label: "기록" },
            { key: "design", label: "설계" },
            { key: "calendar", label: "달력" },
            { key: "todos", label: "투두" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`h-10 rounded-full border px-2 ${
                activeTab === tab.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
              onClick={() => setActiveTab(tab.key as TabKey)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {todoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400">오늘 투두로 추가</p>
                <h2 className="text-lg font-semibold">실행 문장을 직접 적어주세요</h2>
              </div>
              <button
                type="button"
                className="text-xs text-slate-400"
                onClick={() => setTodoModalOpen(false)}
              >
                닫기
              </button>
            </div>
            <div className={`mt-4 ${uiInputPanel}`}>
              <textarea
                value={todoDraftText}
                onChange={(event) => setTodoDraftText(event.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-slate-200 p-3 text-sm"
                placeholder="예) 오늘 21:00~22:00에 포트폴리오 프로젝트 README 1개 완성"
              />
            </div>
            <button
              type="button"
              className={`mt-3 w-full rounded-full px-4 py-2 text-xs font-semibold ${
                todoPolishLoading || !todoDraftText.trim()
                  ? "bg-slate-200 text-slate-400"
                  : "bg-slate-900 text-white"
              }`}
              onClick={handlePolishTodoDraft}
              disabled={todoPolishLoading || !todoDraftText.trim()}
            >
              {todoPolishLoading ? "다듬는 중..." : "✨ 투두 다듬기 AI"}
            </button>
            {todoPolishError && (
              <p className="mt-2 text-xs text-rose-500">{todoPolishError}</p>
            )}
            <button
              type="button"
              className={`mt-3 w-full rounded-full px-4 py-2 text-xs font-semibold ${
                todoDraftText.trim()
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-400"
              }`}
              onClick={handleSubmitGoalTodo}
              disabled={!todoDraftText.trim()}
            >
              투두 추가
            </button>
          </div>
        </div>
      )}

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
            <div className={`mt-4 ${uiInputPanel} flex items-center justify-center gap-2`}>
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
            <div className={`mt-4 ${uiInputPanel} space-y-3`}>
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

      {false && effectModalTodo && (
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
              대상: {effectModalTodo?.text}
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

      {executionToast && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-xs text-white shadow-lg">
          {executionToast}
        </div>
      )}
    </div>
  );
}
