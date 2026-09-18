import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { createCaldavBridge, BridgePlan } from './caldav-bridge.js';
import { CaldavError } from './caldav-projection.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aical-caldav-control-')); process.env.DATA_DIR = root;
const { createCaldavController } = await import('./caldav-service.js');
const guard = await import('./caldav-control.js');
function fixture() {
  const directory = fs.mkdtempSync(path.join(root, 'controller-')); let now = 0; let writes = 0;
  const plan: BridgePlan = { planToken: 'a'.repeat(64), scopeVersion: 'b'.repeat(64), complete: true, operations: [], issues: [], excluded: 0 };
  let failure: string | undefined;
  const bridge = { scopeVersion: plan.scopeVersion!, busy: false, preview: async () => { if (failure) throw new CaldavError(failure); return plan; }, sync: async () => { writes++; return { ...plan, applied: true as const }; } } as ReturnType<typeof createCaldavBridge>;
  const controller = createCaldavController(bridge, directory, () => true, () => true, () => now);
  return { controller, plan, directory, fail: (code?: string) => { failure = code; }, advance: (minutes: number) => { now += minutes * 60_000; }, writes: () => writes };
}
test('automation needs confirmed scope and phone evidence; disabled survives restart', async () => {
  const f = fixture(); await f.controller.tick(); assert.equal(f.writes(), 0);
  assert.throws(() => f.controller.automation(true, f.plan.scopeVersion, true), /SCOPE_CONFIRMATION/);
  await f.controller.sync(f.plan.planToken);
  assert.throws(() => f.controller.automation(true, f.plan.scopeVersion), /PHONE_VERIFICATION/);
  f.controller.automation(true, f.plan.scopeVersion, true); await f.controller.tick(); assert.equal(f.writes(), 2);
  f.controller.automation(false); await f.controller.tick(); assert.equal(f.writes(), 2);
  assert.equal(guard.readControl(f.directory).enabled, false);
});
test('network backoff is 5/10/20/30 minutes; auth and mass deletes pause without writes', async () => {
  const f = fixture(); await f.controller.sync(f.plan.planToken); f.controller.automation(true, f.plan.scopeVersion, true);
  f.fail('CALDAV_NETWORK_ERROR'); let total = 0;
  for (const minutes of [5, 10, 20, 30]) {
    await f.controller.tick(); total += minutes;
    assert.equal(f.controller.status().nextAttempt, total * 60_000); assert.equal(f.writes(), 1);
    await f.controller.tick(); f.advance(minutes);
  }
  f.fail('CALDAV_AUTH_FAILED'); await f.controller.tick(); assert.equal(f.controller.status().enabled, false);
  f.fail(); f.controller.automation(true, f.plan.scopeVersion); f.plan.requiresDeleteConfirmation = true;
  await f.controller.tick(); assert.equal(f.controller.status().enabled, false); assert.equal(f.writes(), 1);
});
test('partial projection is reported and cannot initially enable automation', async () => {
  const f = fixture(); f.plan.complete = false; f.plan.issues = [{ sourceId: 'invalid', code: 'UNSUPPORTED_RECURRENCE' }];
  await f.controller.sync(f.plan.planToken); assert.equal(f.controller.status().summary?.complete, false);
  assert.throws(() => f.controller.automation(true, f.plan.scopeVersion, true), /SCOPE_CONFIRMATION/);
});
test('restore drains accepted work, blocks new work and clears automation consent', async () => {
  let release!: () => void; let restored = false;
  guard.writeControl({ version: 1, enabled: true, failures: 0, confirmedScope: 'a'.repeat(64) });
  const work = guard.withBridgeWork(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  assert.throws(guard.captureBridgeState, /BRIDGE_BUSY/);
  const restore = guard.withBridgeRestore(() => { restored = true; });
  await assert.rejects(guard.withBridgeWork(async () => {}), /MAINTENANCE/); assert.equal(restored, false);
  release(); await work; await restore; assert.equal(restored, true);
  assert.equal(guard.readControl().enabled, false); assert.equal(guard.readControl().confirmedScope, undefined);
  assert(guard.captureBridgeState()?.['control.json']);
});

test('scheduled snapshot waits for bridge without disabling automation', async () => {
  guard.writeControl({ version: 1, enabled: true, failures: 0 });
  let release!: () => void;
  const work = guard.withBridgeWork(() => new Promise<void>(resolve => { release = resolve; })); await Promise.resolve();
  let captured = false;
  const backup = guard.withBridgeSnapshot(() => { captured = !!guard.captureBridgeState(); });
  assert.equal(captured, false); release(); await work; await backup;
  assert.equal(captured, true); assert.equal(guard.readControl().enabled, true);
});
