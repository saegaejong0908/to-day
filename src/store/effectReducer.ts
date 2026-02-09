import { Effect } from "@/types/effect";

export interface EffectState {
  byDate: Record<string, Effect[]>;
}

export const initialEffectState: EffectState = {
  byDate: {},
};

export type EffectAction =
  | {
      type: "ADD_EFFECTS";
      payload: {
        date: string;
        effects: Effect[];
      };
    };

export function effectReducer(
  state: EffectState,
  action: EffectAction
): EffectState {
  switch (action.type) {
    case "ADD_EFFECTS": {
      const { date, effects } = action.payload;
      return {
        ...state,
        byDate: {
          ...state.byDate,
          [date]: [...(state.byDate[date] || []), ...effects],
        },
      };
    }
    default:
      return state;
  }
}

export function applyEffectByUserType<T extends Effect[]>(
  _userType: string,
  effects: T
): T {
  return effects;
}
