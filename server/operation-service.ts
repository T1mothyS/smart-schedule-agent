import * as db from './db.js';
import { withPersistenceTransaction } from './persistence.js';

export function executeOnce<T>(userId: string, scope: string, operationId: string, execute: () => T): T {
  return withPersistenceTransaction(() => {
    const saved = db.getOperationResult(userId, scope, operationId);
    if (saved !== undefined) return saved as T;
    const result = execute();
    db.saveOperationResult(userId, scope, operationId, result);
    return result;
  });
}
