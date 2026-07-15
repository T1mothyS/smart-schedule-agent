export type ReminderTaskType = 'credit_card' | 'sim' | 'generic';
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

export type RecurrenceRule =
  | { frequency: 'once'; anchorDate: string; advancePolicy: 'calendar' }
  | { frequency: 'monthly'; anchorDate: string; dayOfMonth: number; interval: number; advancePolicy: 'calendar' | 'completion' }
  | { frequency: 'yearly'; anchorDate: string; month: number; dayOfMonth: number; interval: number; advancePolicy: 'calendar' | 'completion' }
  | { frequency: 'interval'; anchorDate: string; unit: 'day' | 'month' | 'year'; interval: number; advancePolicy: 'calendar' | 'completion' };

export interface GenericReminderConfig {
  templateKey: 'subscription' | 'insurance' | 'document' | 'membership' | 'rent' | 'utilities' | 'vehicle_inspection' | 'custom';
  rule: RecurrenceRule;
  reminderOffsets: number[];
  reminderTime: string;
  actionGuide: string;
  priority: 'high' | 'medium' | 'low';
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
  config: CreditCardConfig | SimConfig | GenericReminderConfig;
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
