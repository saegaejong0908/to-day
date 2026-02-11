export type YearGoal = {
  id: string;
  yearGoal: string;
  currentPosition: {
    currentStatus: string;
    dailyAvailableTime: string;
    weakestArea: string;
    note: string;
  };
  threeMonthGoal: string;
  progress: number;
  createdAt: Date;
};

