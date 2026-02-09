export enum EffectType {
  CLARITY = "clarity",
  MOMENTUM = "momentum",
  RELIEF = "relief",
  DISCIPLINE = "discipline",
  CONFIDENCE = "confidence",
  FOCUS = "focus",
  ENERGY = "energy",
  FAITH = "faith",
}

export interface Effect {
  type: EffectType;
  intensity: 1 | 2 | 3;
}
