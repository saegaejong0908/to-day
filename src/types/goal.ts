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
  weeklyActionPlan?: {
    weekKey: string;
    rationale: string;
    todos: string[];
    achievedRate?: number;
  };
  progress: number;
  createdAt: Date;
};

