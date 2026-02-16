export type WeeklyReviewRhythm = "steady" | "sporadic" | "stopped";

export type GoalTrackWeeklyReview = {
  id: string;
  goalTrackId: string;
  weekStartKey: string;
  rhythm: WeeklyReviewRhythm;
  wobbleMoment: string;
  nextWeekOneChange: string;
  nextWeekKeepOne?: string;
  coachSummary: string;
  coachQuestion: string;
  createdAt: Date;
  updatedAt: Date;
};
