export type YearGoal = {
  id: string;
  title: string;
  category: string;
  yearlyTarget: string;
  roadmap: {
    marchGoal: string;
    juneGoal: string;
    septemberGoal: string;
    monthlyPlan: string[];
  };
  aiTodos: string[];
  progress: number;
  createdAt: Date;
};

