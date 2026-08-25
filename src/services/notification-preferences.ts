export type NotificationPreferencesFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function saveNotificationPreferences(
  payload: Record<string, unknown>,
  authHeaders: Record<string, string>,
  fetcher: NotificationPreferencesFetcher = fetch,
): Promise<any> {
  const response = await fetcher('/api/notification-preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data: any = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  if (!response.ok) throw new Error(data.error || '保存失败');
  return data;
}
