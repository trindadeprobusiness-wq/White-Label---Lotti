export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;
export type Temperature = 'COLD' | 'WARM' | 'HOT';

export interface Question {
  id: string;
  prompt: string;
  type: 'text' | 'single' | 'multi' | 'contact';
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  maxLength?: number;
}

export interface LeadScore {
  score: number;
  temperature: Temperature;
  signals: string[];
}

export const BOTTLENECKS = [
  'acquisition', 'lead_quality', 'cost', 'content', 'positioning',
  'service', 'follow_up', 'conversion', 'automation', 'process', 'unclear',
] as const;
export type Bottleneck = typeof BOTTLENECKS[number];
export const NEXT_STEPS = ['strategy_call', 'send_diagnostic', 'nurture'] as const;
export type NextStep = typeof NEXT_STEPS[number];

export interface DiagnosticSummary {
  summary: string;
  primary_bottleneck: Bottleneck;
  secondary_bottleneck: Bottleneck | null;
  recommended_next_step: NextStep;
  user_message: string;
  source: 'rules' | 'ai';
}
