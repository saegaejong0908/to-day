export type StrategyType =
  | "MINIMUM_VERSION"
  | "SCOPE_REDUCTION"
  | "TRIGGER_ATTACH"
  | "ENVIRONMENT_SETUP";

export const STRATEGY_LABELS: Record<StrategyType, string> = {
  MINIMUM_VERSION: "최소 버전",
  SCOPE_REDUCTION: "범위 축소",
  TRIGGER_ATTACH: "붙이기(트리거)",
  ENVIRONMENT_SETUP: "환경 세팅",
};

export const STRATEGY_OPTIONS: StrategyType[] = [
  "MINIMUM_VERSION",
  "SCOPE_REDUCTION",
  "TRIGGER_ATTACH",
  "ENVIRONMENT_SETUP",
];
