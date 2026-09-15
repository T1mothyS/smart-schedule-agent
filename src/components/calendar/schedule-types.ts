export interface Schedule {
  id: string;
  calendar_id: string;
  type: 'event' | 'todo';
  title: string;
  description?: string;
  start_time: string;
  end_time?: string;
  all_day: boolean;
  is_unscheduled?: boolean;
  location?: string;
  notes?: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  is_completed: boolean;
  is_repeated: boolean;
  repeat_rule?: string;
  reminders: string[];
  created_at: string;
  updated_at: string;
}

export interface CompletionProofDisplay {
  note: string | null;
  amountCents: number | null;
  currency: string;
  billDate: string | null;
  attachments: Array<{ id: string; originalName: string }>;
}
