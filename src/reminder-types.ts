export type ReminderTaskType = 'credit_card' | 'sim';
export type ReminderCycleStatus = 'pending' | 'completed' | 'expired' | 'cancelled';

export interface CreditCardConfig {
  statementDay: number;
  paymentDay: number;
  paymentMonthOffset: 0 | 1;
  reminderOffsets: number[];
}

export interface SimConfig {
  provider: string;
  numberMasked: string;
  region: string;
  intervalDays: number;
  lastOperationDate: string;
  actionGuide: string;
  reminderOffsets: number[];
}

export interface ReminderCycle {
  id: string;
  taskId: string;
  cycleKey: string;
  periodStart: string;
  dueDate: string;
  status: ReminderCycleStatus;
  completedAt: string | null;
  completedNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderTask {
  id: string;
  userId: string;
  type: ReminderTaskType;
  name: string;
  enabled: boolean;
  timezone: string;
  config: CreditCardConfig | SimConfig;
  createdAt: string;
  updatedAt: string;
  currentCycle: ReminderCycle | null;
  nextReminderDate: string | null;
  sentReminderTypes: string[];
}

export interface ReminderStats {
  total: number;
  active: number;
  dueSoon: number;
  expired: number;
}
