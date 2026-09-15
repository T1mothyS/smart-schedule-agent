import * as dbModule from '../db.js';
import { initScheduleDb } from '../schedule-store.js';
import { initReminderDb } from '../reminder-store.js';
import { initActivityDb } from '../activity-store.js';
import * as attachmentService from '../attachment-service.js';
import { initializeInviteCodes } from '../invite-code-service.js';
import { addLog } from '../log-service.js';
import type { RuntimeConfig } from './config.js';

export function createStoreInitializer({ config, onDatabaseReady, onInviteCodesReady, onReady }: {
  config: RuntimeConfig;
  onDatabaseReady: (db: typeof dbModule) => void;
  onInviteCodesReady: (ready: boolean) => void;
  onReady: () => void;
}) {
  let initialized = false;
  const { LEGACY_ADMIN_INVITE_CODE, LEGACY_USER_INVITE_CODE, isProduction } = config;
  // 初始化业务数据库；测试可以复用同一套路由而不启动固定端口。
  let initializing: Promise<void> | undefined;
  async function initializeServer(): Promise<void> {
    if (initialized) return;
    if (!initializing) initializing = initializeBusinessStores().finally(() => { initializing = undefined; });
    return initializing;
  }

  async function initializeBusinessStores(): Promise<void> {
    const startedAt = Date.now();
    if (initialized) return;
    addLog('debug', 'system', '服务启动开始', {
      event: 'service_starting',
      pid: process.pid,
      nodeVersion: process.version,
    });
    config.initializeEnvironment();
    // 初始化数据库
    console.log('[Startup] 初始化数据库...');
    await dbModule.initDb();
    console.log('[Startup] 数据库初始化完成');
    onDatabaseReady(dbModule);
    const inviteCodeStatuses = initializeInviteCodes({
      adminCode: LEGACY_ADMIN_INVITE_CODE,
      userCode: LEGACY_USER_INVITE_CODE,
      isProduction,
    });
    onInviteCodesReady(inviteCodeStatuses.every(status => status.active));

    // 初始化日程数据库
    console.log('[Startup] 初始化日程数据库...');
    await initScheduleDb();
    console.log('[Startup] 日程数据库初始化完成');

    // 初始化周期提醒数据库
    console.log('[Startup] 初始化周期提醒数据库...');
    await initReminderDb();
    console.log('[Startup] 周期提醒数据库初始化完成');

    console.log('[Startup] 初始化活动数据库...');
    await initActivityDb();
    attachmentService.attachmentsRoot();
    console.log('[Startup] 活动数据库初始化完成');
    initialized = true;
    onReady();
    addLog('info', 'db', '业务数据库初始化完成', {
      event: 'database_initialization_completed',
      durationMs: Date.now() - startedAt,
    });
  }


  return initializeServer;
}
