/**
 * Core type definitions for AgentGuard
 */

// ============================================================================
// Rule Types
// ============================================================================

export enum RuleType {
  BLOCK = 'block',
  CONFIRM = 'confirm',
  ALLOW = 'allow',
  PROTECT = 'protect',
  SANDBOX = 'sandbox'
}

export enum RuleSource {
  GLOBAL = 'global',    // /etc/agentguard/rules
  USER = 'user',        // ~/.config/agentguard/rules
  PROJECT = 'project'   // ./.agentguard
}

export interface Rule {
  type: RuleType;
  pattern: string;
  source: RuleSource;
  lineNumber: number;
  specificity: number;  // Calculated based on pattern complexity
  metadata?: {
    path?: string;  // For @protect and @sandbox
  };
}

export interface ParseResult {
  rules: Rule[];
  errors: ParseError[];
}

export interface ParseError {
  line: number;
  message: string;
  source: RuleSource;
}

// ============================================================================
// Command Parsing Types
// ============================================================================

export interface Token {
  type: 'command' | 'argument' | 'operator' | 'redirect';
  value: string;
  originalValue: string;  // Before expansion
  position: number;
}

export interface CommandSegment {
  command: string;
  args: string[];
  operator?: '&&' | '||' | ';' | '|';
}

export interface ParsedCommand {
  original: string;
  normalized: string;
  tokens: Token[];
  segments: CommandSegment[];
  isChained: boolean;
  isPiped: boolean;
}

// ============================================================================
// Validation Types
// ============================================================================

export enum ValidationAction {
  ALLOW = 'allow',
  BLOCK = 'block',
  CONFIRM = 'confirm'
}

export interface ValidationResult {
  action: ValidationAction;
  rule?: Rule;
  reason: string;
  metadata?: {
    affectedFiles?: number;
    targetPaths?: string[];
    estimatedImpact?: 'low' | 'medium' | 'high' | 'catastrophic';
  };
}

export interface MatchResult {
  matched: boolean;
  rule?: Rule;
  confidence: number;  // 0-1, based on specificity
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIOptions {
  command: string[];        // Command to wrap (e.g., ['claude'])
  configPath?: string;      // Override config file location
  verbose?: boolean;        // Enable verbose output
  dryRun?: boolean;        // Test mode, don't execute
}

// ============================================================================
// Process Spawning Types
// ============================================================================

export interface SpawnOptions {
  command: string[];
  shellPath: string;      // Path to guard shell wrapper
  realShell: string;      // Original shell (bash/zsh)
  env?: Record<string, string>;
}

// ============================================================================
// Confirmation Types
// ============================================================================

export interface ConfirmOptions {
  command: string;
  rule: Rule;
  metadata?: {
    affectedFiles?: number;
    targetPaths?: string[];
  };
  timeout?: number;  // Default: 30 seconds
}

export interface ConfirmResult {
  approved: boolean;
  timedOut: boolean;
}

// ============================================================================
// Audit Logging Types
// ============================================================================

export interface LogEntry {
  timestamp: string;      // ISO 8601
  command: string;
  action: ValidationAction;
  rule?: string;
  reason: string;
  exitCode?: number;
}

export interface LogReadOptions {
  limit?: number;         // Default: 50
  action?: ValidationAction;
  since?: Date;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface AgentGuardConfig {
  rules: {
    globalPath: string;
    userPath: string;
    projectPath: string;
  };
  audit: {
    enabled: boolean;
    path: string;
    maxSize: number;
    maxFiles: number;
  };
  confirmation: {
    timeout: number;
    defaultAction: 'allow' | 'block';
  };
  output: {
    verbose: boolean;
    color: boolean;
  };
}
