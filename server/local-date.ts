

export function getLocalDateString(date?: Date): string {
  const d = date || new Date();
  // 使用本地时区获取日期部分
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 获取本地时间的 ISO 字符串（带时区）
export function getLocalISOString(date?: Date): string {
  const d = date || new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - offset * 60 * 1000);
  return localDate.toISOString();
}
