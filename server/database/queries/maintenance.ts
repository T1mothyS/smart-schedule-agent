import { queryAll, run } from '../connection.js';
import { deleteDailyReportCloudData } from './report-cloud.js';
import { deleteOAuthUserData } from './oauth.js';
import { deleteUserOperationResults } from './operations.js';

export function deleteUser(userId: string): boolean {
  try {
    deleteUserOperationResults(userId);
    run('DELETE FROM daily_report_tokens WHERE user_id = ?', [userId]);
    deleteDailyReportCloudData(userId);
    deleteOAuthUserData(userId);
    run('DELETE FROM library_preferences WHERE user_id = ?', [userId]);
    run('DELETE FROM library_publish_tokens WHERE user_id = ?', [userId]);
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
    run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
    run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]);
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
    run('DELETE FROM ai_schedule_messages WHERE user_id = ?', [userId]);
    run('DELETE FROM note_items WHERE user_id = ?', [userId]);
    const sessions = queryAll<{ id: string }>('SELECT id FROM sessions WHERE user_id = ?', [userId]);
    for (const session of sessions) {
      run('DELETE FROM messages WHERE session_id = ?', [session.id]);
    }
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    const result = run('DELETE FROM users WHERE id = ?', [userId]);
    return result.changes > 0;
  } catch (error) {
    console.error('[DB] Delete user error:', error);
    return false;
  }
}

export function clearUserData(userId: string): { schedules: number; sessions: number } {
  try {
    deleteUserOperationResults(userId);
    run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
    run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]);
    deleteDailyReportCloudData(userId);
    deleteOAuthUserData(userId);
    run('DELETE FROM library_preferences WHERE user_id = ?', [userId]);
    run('DELETE FROM library_publish_tokens WHERE user_id = ?', [userId]);
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
    run('DELETE FROM ai_schedule_messages WHERE user_id = ?', [userId]);
    run('DELETE FROM note_items WHERE user_id = ?', [userId]);
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
    const sessions = queryAll<{ id: string }>('SELECT id FROM sessions WHERE user_id = ?', [userId]);
    for (const session of sessions) run('DELETE FROM messages WHERE session_id = ?', [session.id]);
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    return { schedules: 0, sessions: sessions.length };
  } catch (error) {
    console.error('[DB] Clear user data error:', error);
    return { schedules: 0, sessions: 0 };
  }
}
