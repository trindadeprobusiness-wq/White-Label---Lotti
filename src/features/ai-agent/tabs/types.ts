import type { StageOption } from '../components';
import type { AgentSettings, AgentTab } from '../settings';
import type { AgentIssue } from '../validation';

export type AgentTabProps = {
  settings: AgentSettings;
  onChange: (next: AgentSettings) => void;
  issues: AgentIssue[];
  stages: StageOption[];
  onOpenTab: (tab: AgentTab) => void;
};
