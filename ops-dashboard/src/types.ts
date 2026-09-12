export interface RunSummary {
  id: string;
  started_at: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  rows_processed: number;
  total_rows: number;
}

export interface RunDetail extends RunSummary {
  output: OutputRow[];
  review_queue: ReviewQueueItem[];
  usage_report: UsageReport;
}

export interface OutputRow {
  request_id: string;
  affordability_status: 'affordable_now' | 'affordable_with_plan' | 'affordable_later' | 'not_affordable';
  recommended_payment_method: string;
  amount_safe_to_pay: number;
  earliest_date_for_full_payment: string | null;
  decision_explanation: string;
  payment_plan: string;
  spending_changes_needed: string;
}

export interface ReviewQueueItem {
  id: string;
  request_id: string;
  flag_reason: 'injection_pattern' | 'validation_fallback' | 'low_confidence';
  extracted_value: string;
  source_type: 'image' | 'message';
  source_content: string; // URL for image, text for message
}

export interface UsageReport {
  models: {
    name: string;
    calls: number;
    input_tokens: number;
    output_tokens: number;
  }[];
  summary: {
    total_calls: number;
    total_tokens: number;
    total_cost: number;
    requests_processed: number;
  };
  raw_markdown: string;
}
