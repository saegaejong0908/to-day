/**
 * today 앱 - 루틴 텍스트 기반 자동 아이콘 매핑
 *
 * 목적:
 * - 사용자가 루틴 텍스트만 입력하면
 * - 의미에 맞는 아이콘(emoji)을 자동으로 붙여준다
 * - 설정/선택을 강요하지 않는다 (아침 UX 최적화)
 *
 * 원칙:
 * 1. 아이콘은 "저장 데이터"가 아니라 "UI 표시용"이다
 * 2. 키워드가 여러 개 매칭되면 우선순위가 높은 아이콘 1개만 사용
 * 3. 아무 키워드도 안 맞으면 기본 아이콘 사용
 */

/**
 * 아이콘 매핑 규칙
 * - priority 숫자가 낮을수록 우선순위 높음
 * - keywords 중 하나라도 포함되면 해당 아이콘 적용
 */
export const ICON_KEYWORD_MAP = [
  {
    icon: "🚫",
    priority: 1,
    category: "control",
    keywords: [
      "줄이기",
      "제한",
      "끊기",
      "금지",
      "참기",
      "조절",
      "관리",
      "타이머",
      "분",
      "시간",
      "잠깐",
      "조금만",
      "적당히",
    ],
    context: [
      "인스타",
      "유튜브",
      "릴스",
      "쇼츠",
      "틱톡",
      "sns",
      "핸드폰",
      "폰",
    ],
  },
  {
    icon: "📱",
    priority: 2,
    category: "digital",
    keywords: [
      "인스타",
      "유튜브",
      "릴스",
      "쇼츠",
      "틱톡",
      "sns",
      "핸드폰",
      "폰",
      "스크롤",
      "보기",
      "시청",
    ],
  },
  {
    icon: "💧",
    priority: 3,
    category: "body",
    keywords: ["물", "수분", "물마시기", "목마름"],
  },
  {
    icon: "🚿",
    priority: 4,
    category: "body",
    keywords: ["씻", "샤워", "세수", "목욕"],
  },
  {
    icon: "🪥",
    priority: 5,
    category: "body",
    keywords: ["양치", "치카", "이닦기"],
  },
  {
    icon: "😴",
    priority: 6,
    category: "body",
    keywords: ["잠", "수면", "졸림", "쉬기", "휴식"],
  },
  {
    icon: "☀️",
    priority: 7,
    category: "body",
    keywords: ["기상", "아침", "햇빛", "햇살", "일어나기"],
  },
  {
    icon: "🏃‍♂️",
    priority: 8,
    category: "movement",
    keywords: ["운동", "러닝", "조깅", "걷기", "산책"],
  },
  {
    icon: "🧘‍♂️",
    priority: 9,
    category: "movement",
    keywords: ["스트레칭", "요가", "몸풀기", "풀기"],
  },
  {
    icon: "🍽️",
    priority: 10,
    category: "food",
    keywords: ["식사", "밥", "먹기", "아침", "점심", "저녁"],
  },
  {
    icon: "☕",
    priority: 11,
    category: "food",
    keywords: ["커피", "카페인", "차", "각성"],
  },
  {
    icon: "🍎",
    priority: 12,
    category: "food",
    keywords: ["과일", "간식", "당보충"],
  },
  {
    icon: "🧠",
    priority: 13,
    category: "mind",
    keywords: [
      "고민",
      "생각",
      "생각하기",
      "정리",
      "판단",
      "결정",
      "선택",
      "머리",
      "마음",
      "감정",
      "상태",
    ],
  },
  {
    icon: "💭",
    priority: 14,
    category: "mind",
    keywords: ["멍", "멍때리기", "가만히", "명상", "호흡"],
  },
  {
    icon: "😮‍💨",
    priority: 15,
    category: "mind",
    keywords: ["힘듦", "버거움", "지침", "피곤함", "답답", "막막"],
  },
  {
    icon: "😤",
    priority: 16,
    category: "mind",
    keywords: ["짜증", "화남", "열받"],
  },
  {
    icon: "✍️",
    priority: 17,
    category: "record",
    keywords: ["기록", "쓰기", "적기", "일기", "저널", "회고", "메모", "노트"],
  },
  {
    icon: "🗂️",
    priority: 18,
    category: "record",
    keywords: ["정리", "요약", "분류", "정돈"],
  },
  {
    icon: "📘",
    priority: 19,
    category: "study",
    keywords: ["공부", "학습", "이해", "복습", "예습", "개념"],
  },
  {
    icon: "📐",
    priority: 20,
    category: "study",
    keywords: ["문제", "풀이", "연습", "수학", "계산", "틀림"],
  },
  {
    icon: "💡",
    priority: 21,
    category: "study",
    keywords: ["아이디어", "깨달음", "아하", "힌트"],
  },
  {
    icon: "💻",
    priority: 22,
    category: "work",
    keywords: ["코딩", "개발", "작업", "프로젝트", "과제", "업무"],
  },
  {
    icon: "🧩",
    priority: 23,
    category: "problem",
    keywords: ["막힘", "헷갈림", "실수", "오류", "에러", "다시보기", "점검", "분석", "놓침"],
  },
  {
    icon: "🧹",
    priority: 24,
    category: "environment",
    keywords: ["청소", "정리", "방정리", "환기", "치우기"],
  },
  {
    icon: "🛏️",
    priority: 25,
    category: "environment",
    keywords: ["침대", "이불", "정돈"],
  },
] as const;

const sortedIconRules = [...ICON_KEYWORD_MAP].sort(
  (a, b) => a.priority - b.priority
);

/**
 * 루틴 텍스트를 받아서 아이콘을 반환한다
 * @param text 사용자가 입력한 루틴 문장
 */
export function getIconForRoutine(text: string): string {
  const normalized = text.replace(/\s/g, "").toLowerCase();

  const match = sortedIconRules.find((rule) => {
    const keywordMatch = rule.keywords.some((keyword) =>
      normalized.includes(keyword)
    );
    if (!keywordMatch) return false;
    if ("context" in rule && Array.isArray(rule.context)) {
      return rule.context.some((value) => normalized.includes(value));
    }
    return true;
  });

  return match ? match.icon : "🟢";
}
