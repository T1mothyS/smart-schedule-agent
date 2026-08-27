export type NotificationPreferencesFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

async function readJsonResponse(response: Response): Promise<any> {
  const raw = await response.text();
  let data: any = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

export async function loadNotificationPreferences(
  authHeaders: Record<string, string>,
  fetcher: NotificationPreferencesFetcher = fetch,
): Promise<any> {
  return readJsonResponse(await fetcher('/api/notification-preferences', {
    method: 'GET',
    headers: authHeaders,
  }));
}

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
  return readJsonResponse(response);
}

/** 保存后重新读取服务端状态，避免仅凭 PUT 的响应把未持久化的选择显示为成功。 */
export async function saveAndReloadNotificationPreferences(
  payload: Record<string, unknown>,
  authHeaders: Record<string, string>,
  fetcher: NotificationPreferencesFetcher = fetch,
): Promise<any> {
  await saveNotificationPreferences(payload, authHeaders, fetcher);
  return loadNotificationPreferences(authHeaders, fetcher);
}
