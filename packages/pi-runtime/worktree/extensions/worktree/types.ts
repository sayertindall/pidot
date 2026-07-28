export interface GitWorkingTreeInfo {
  branch?: string;
  detectedBranch?: string;
}

export interface SwitchWorktreeState {
  pendingWorktreeSwitch: boolean;
}
