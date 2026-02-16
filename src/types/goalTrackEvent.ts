export type GoalTrackEvent = {
  id: string;
  goalTrackId: string;
  todoId: string;
  todoText: string;
  dateKey: string;
  createdAt: Date;
};

export type GoalTrackEventPayload = {
  goalTrackId: string;
  todoId: string;
  todoText: string;
  dateKey: string;
  createdAt: ReturnType<typeof import("firebase/firestore").serverTimestamp>;
};
