const pad = (value: number) => String(value).padStart(2, "0");

export const getLocalDateKey = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
};

export const getYesterdayKey = (date: Date = new Date()) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - 1);
  return getLocalDateKey(copy);
};

export const parseTimeToMinutes = (value?: string | null) => {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

export const formatDateKey = (value: string) =>
  value.replaceAll("-", ".");

export const getMonthKey = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  return `${year}-${month}`;
};

export const getMonthStartKey = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  return `${year}-${month}-01`;
};

export const getMonthEndKey = (date: Date = new Date()) => {
  const copy = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return getLocalDateKey(copy);
};

export const getCalendarMatrix = (date: Date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay();
  const totalDays = last.getDate();

  const weeks: Array<Array<number | null>> = [];
  let day = 1;
  while (day <= totalDays) {
    const week: Array<number | null> = [];
    for (let i = 0; i < 7; i += 1) {
      if (weeks.length === 0 && i < startDay) {
        week.push(null);
      } else if (day <= totalDays) {
        week.push(day);
        day += 1;
      } else {
        week.push(null);
      }
    }
    weeks.push(week);
  }
  return weeks;
};
