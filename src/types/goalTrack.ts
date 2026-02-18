/** 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토 (Date.getDay()와 동일) */
export type GoalTrack = {
  id: string;
  designPlanId: string;
  title: string;
  /** 평가 요일. 기본 6(토). undefined면 6으로 처리 */
  reviewWeekday?: number;
  createdAt: string;
};
