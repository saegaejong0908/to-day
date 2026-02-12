export type YearGoal = {
  id: string;
  yearGoal: string;
  deadlineDate?: string;
  currentPosition: {
    currentStatus: string;
    dailyAvailableTime: string;
    weakestArea: string;
    note: string;
  };
  threeMonthGoal: string;
  weeklyState?: string;
  weeklyActionPlan?: {
    weekKey: string;
    rationale: string;
    todos: Array<{
      text: string;
      weekdays?: number[];
      weekday?: number | null;
    }>;
    achievedRate?: number;
  };
  progress: number;
  createdAt: Date;
};

