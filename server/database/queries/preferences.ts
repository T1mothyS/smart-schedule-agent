import { queryAll, queryOne, run } from '../connection.js';
import { getUserById } from './accounts.js';
import type { DbUser, DbReminder } from '../types.js';

export function getReminder(userId: string): DbReminder | undefined {
  return queryOne<DbReminder>('SELECT * FROM reminders WHERE user_id = ?', [userId]);
}

export function upsertReminder(reminder: DbReminder): DbReminder {
  const existing = getReminder(reminder.user_id);
  const reminderEmail = reminder.reminder_email ?? existing?.reminder_email ?? null;
  const homeLocationName = reminder.home_location_name === undefined ? existing?.home_location_name ?? null : reminder.home_location_name;
  const homeLocationAdmin1 = reminder.home_location_admin1 === undefined ? existing?.home_location_admin1 ?? null : reminder.home_location_admin1;
  const homeLocationCountry = reminder.home_location_country === undefined ? existing?.home_location_country ?? null : reminder.home_location_country;
  const homeLatitude = reminder.home_latitude === undefined ? existing?.home_latitude ?? null : reminder.home_latitude;
  const homeLongitude = reminder.home_longitude === undefined ? existing?.home_longitude ?? null : reminder.home_longitude;
  const homeTimezone = reminder.home_timezone === undefined ? existing?.home_timezone ?? null : reminder.home_timezone;
  const dailyReportDeliverySources = reminder.daily_report_delivery_sources
    ?? existing?.daily_report_delivery_sources
    ?? '["local"]';
  if (existing) {
    run(
      `UPDATE reminders SET enabled = ?, hour = ?, minute = ?, reminder_email = ?, email_enabled = ?, report_email_enabled = ?, daily_report_delivery_sources = ?,
       in_app_enabled = ?, browser_enabled = ?, timezone = ?, quiet_hours_enabled = ?, quiet_start = ?, quiet_end = ?,
       home_location_name = ?, home_location_admin1 = ?, home_location_country = ?, home_latitude = ?, home_longitude = ?, home_timezone = ?,
       updated_at = ? WHERE user_id = ?`,
      [reminder.enabled, reminder.hour, reminder.minute, reminderEmail, reminder.email_enabled ?? existing.email_enabled ?? 1,
        reminder.report_email_enabled ?? existing.report_email_enabled ?? 0,
        dailyReportDeliverySources,
        reminder.in_app_enabled ?? existing.in_app_enabled ?? 1, reminder.browser_enabled ?? existing.browser_enabled ?? 1,
        reminder.timezone || existing.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? existing.quiet_hours_enabled ?? 0,
        reminder.quiet_start || existing.quiet_start || '22:00', reminder.quiet_end || existing.quiet_end || '08:00',
        homeLocationName, homeLocationAdmin1, homeLocationCountry, homeLatitude, homeLongitude, homeTimezone,
        reminder.updated_at, reminder.user_id]
    );
  } else {
    run(
      `INSERT INTO reminders (id, user_id, enabled, hour, minute, reminder_email, email_enabled, report_email_enabled, daily_report_delivery_sources, in_app_enabled,
       browser_enabled, timezone, quiet_hours_enabled, quiet_start, quiet_end, home_location_name, home_location_admin1,
       home_location_country, home_latitude, home_longitude, home_timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reminder.id, reminder.user_id, reminder.enabled, reminder.hour, reminder.minute, reminderEmail,
        reminder.email_enabled ?? 1, reminder.report_email_enabled ?? 0, dailyReportDeliverySources, reminder.in_app_enabled ?? 1, reminder.browser_enabled ?? 1,
        reminder.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? 0, reminder.quiet_start || '22:00',
        reminder.quiet_end || '08:00', homeLocationName, homeLocationAdmin1, homeLocationCountry, homeLatitude,
        homeLongitude, homeTimezone, reminder.created_at, reminder.updated_at]
    );
  }
  return {
    ...reminder,
    reminder_email: reminderEmail,
    report_email_enabled: reminder.report_email_enabled ?? existing?.report_email_enabled ?? 0,
    daily_report_delivery_sources: dailyReportDeliverySources,
    home_location_name: homeLocationName,
    home_location_admin1: homeLocationAdmin1,
    home_location_country: homeLocationCountry,
    home_latitude: homeLatitude,
    home_longitude: homeLongitude,
    home_timezone: homeTimezone,
  };
}

export function exportUserAccountData(userId: string): { user: Omit<DbUser, 'password_hash'> | null; reminder: DbReminder | null } {
  const user = getUserById(userId) || null;
  const reminder = getReminder(userId) || null;
  return { user, reminder };
}

export function getAllEnabledReminders(): (DbReminder & { email: string })[] {
  return queryAll<DbReminder & { email: string }>(
    `SELECT r.*, COALESCE(NULLIF(r.reminder_email, ''), u.email) AS email FROM reminders r JOIN users u ON r.user_id = u.id WHERE r.enabled = 1 AND u.disabled = 0`
  );
}

export function getReminderEmail(userId: string): string | null {
  const row = queryOne<{ reminder_email: string | null; email: string }>(
    `SELECT r.reminder_email, u.email FROM users u LEFT JOIN reminders r ON r.user_id = u.id WHERE u.id = ?`,
    [userId],
  );
  return row ? (row.reminder_email?.trim() || row.email) : null;
}
