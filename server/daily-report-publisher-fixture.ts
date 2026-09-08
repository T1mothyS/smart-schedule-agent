export interface DailyReportPublisherFixtureResult {
  status: 'PUBLISHED';
  date: string;
  report_status: string;
  email_status: string;
}

export async function publishDailyReportFixture(
  baseUrl: string,
  token: string,
  reportDate: string,
  markdown: string,
): Promise<DailyReportPublisherFixtureResult> {
  const response = await fetch(`${baseUrl}/api/integrations/daily-report/reports/${encodeURIComponent(reportDate)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ markdown }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error || `日报 fixture 发布失败（HTTP ${response.status}）`));
  }
  if (payload.date !== reportDate) throw new Error('日报 fixture 返回日期不一致');
  return {
    status: 'PUBLISHED',
    date: reportDate,
    report_status: String(payload.reportStatus || ''),
    email_status: String(payload.emailStatus || ''),
  };
}
