import { queryOne, run } from '../connection.js';

export function getOperationResult(userId: string, scope: string, operationId: string): unknown | undefined {
  const row = queryOne<{ result: string }>('SELECT result FROM operation_results WHERE user_id = ? AND scope = ? AND operation_id = ?', [userId, scope, operationId]);
  return row ? JSON.parse(row.result) : undefined;
}

export function saveOperationResult(userId: string, scope: string, operationId: string, result: unknown): void {
  run('INSERT INTO operation_results (user_id, scope, operation_id, result, created_at) VALUES (?, ?, ?, ?, ?)', [userId, scope, operationId, JSON.stringify(result), new Date().toISOString()]);
}

export function deleteUserOperationResults(userId: string): void {
  run('DELETE FROM operation_results WHERE user_id = ?', [userId]);
}
