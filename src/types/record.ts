export type RecordItem = {
  id: string;
  content: string;
  /** @deprecated use goalTrackId */
  goalId?: string;
  goalTrackId?: string;
  createdAt: Date;
};

