/**
 * Rule Engine - Applies rules and determines validation actions
 */

import * as os from 'os';
import * as path from 'path';
import { ParsedCommand, Rule, ValidationResult, ValidationAction, RuleType } from './types';
import { PatternMatcher } from './pattern-matcher';

export class RuleEngine {
  private matcher: PatternMatcher;

  // Commands that can cause catastrophic damage when given dangerous paths
  private readonly DESTRUCTIVE_COMMANDS = ['rm'];

  // Flags that indicate recursive/forced deletion
  private readonly DESTRUCTIVE_FLAGS = ['-rf', '-fr', '-r', '-R', '--recursive'];

  // Paths that should always be blocked for destructive commands
  private readonly CATASTROPHIC_PATHS: string[] = [];

  constructor() {
    this.matcher = new PatternMatcher();

    // Initialize catastrophic paths (computed at runtime)
    const homeDir = os.homedir();
    this.CATASTROPHIC_PATHS = [
      '/',                    // Root filesystem
      homeDir,                // User's home directory
      `${homeDir}/`,          // Home with trailing slash
      '/home',                // All users' homes
      '/root',                // Root user home
      '/etc',                 // System configuration
      '/usr',                 // User programs
      '/var',                 // Variable data
      '/bin',                 // Essential binaries
      '/sbin',                // System binaries
      '/lib',                 // Essential libraries
      '/lib64',               // 64-bit libraries
      '/boot',                // Boot files
      '/dev',                 // Device files
      '/proc',                // Process info
      '/sys',                 // System info
    ];
  }

  /**
   * Validate a command against rules
   * Validation order:
   * 1. Check for catastrophic paths in destructive commands (ALWAYS BLOCK)
   * 2. First try to match the FULL command against rules (for patterns like "* | bash")
   * 3. If command is chained or piped and no full match blocks, validate each segment
   * 4. Check PROTECT directives (if command writes to protected path → BLOCK)
   * 5. Check SANDBOX directives (if command writes outside sandbox → BLOCK)
   * 6. Match against pattern rules (BLOCK/CONFIRM/ALLOW)
   * 7. If no match, default to ALLOW
   */
  validate(command: ParsedCommand, rules: Rule[]): ValidationResult {
    // FIRST: Check for catastrophic paths in destructive commands
    // This catches attacks like "rm -rf node_modules dist ~/"
    const catastrophicResult = this.checkCatastrophicPaths(command);
    if (catastrophicResult) {
      return catastrophicResult;
    }

    // For chained/piped commands, first check if the FULL command matches any BLOCK rules
    // This catches patterns like "* | bash" or "curl * | sh"
    if ((command.isChained || command.isPiped) && command.segments.length > 1) {
      const fullCommandResult = this.applyPatternRules(command, rules);

      // If the full command is explicitly blocked, return that result
      if (fullCommandResult.rule && fullCommandResult.action === ValidationAction.BLOCK) {
        return fullCommandResult;
      }

      // Otherwise, validate each segment independently
      return this.validateChainedCommand(command, rules);
    }

    // Check PROTECT directives first
    const protectResult = this.applyProtectDirectives(command, rules);
    if (protectResult) {
      return protectResult;
    }

    // Check SANDBOX directives
    const sandboxResult = this.applySandboxDirectives(command, rules);
    if (sandboxResult) {
      return sandboxResult;
    }

    // Apply pattern rules
    return this.applyPatternRules(command, rules);
  }

  /**
   * Validate chained/piped commands
   * Each segment is validated independently
   * If any segment is blocked, the entire chain is blocked
   */
  private validateChainedCommand(command: ParsedCommand, rules: Rule[]): ValidationResult {
    const segmentResults: ValidationResult[] = [];
    
    // Validate each segment
    for (const segment of command.segments) {
      // Create a ParsedCommand for this segment
      const segmentCommand = `${segment.command} ${segment.args.join(' ')}`.trim();
      const segmentParsed: ParsedCommand = {
        original: segmentCommand,
        normalized: segmentCommand,
        tokens: [],
        segments: [segment],
        isChained: false,
        isPiped: false
      };
      
      // Validate this segment
      const result = this.validate(segmentParsed, rules);
      segmentResults.push(result);
      
      // If any segment is blocked, block the entire chain
      if (result.action === ValidationAction.BLOCK) {
        return {
          action: ValidationAction.BLOCK,
          rule: result.rule,
          reason: `Chained command blocked: segment "${segmentCommand}" - ${result.reason}`
        };
      }
    }
    
    // Check if any segment requires confirmation
    const confirmSegment = segmentResults.find(r => r.action === ValidationAction.CONFIRM);
    if (confirmSegment) {
      return {
        action: ValidationAction.CONFIRM,
        rule: confirmSegment.rule,
        reason: `Chained command requires confirmation: ${confirmSegment.reason}`
      };
    }
    
    // All segments allowed
    const allowSegment = segmentResults.find(r => r.action === ValidationAction.ALLOW && r.rule);
    if (allowSegment && allowSegment.rule) {
      return {
        action: ValidationAction.ALLOW,
        rule: allowSegment.rule,
        reason: `All segments in chained command allowed`
      };
    }
    
    return {
      action: ValidationAction.ALLOW,
      reason: 'All segments in chained command allowed - default policy'
    };
  }

  private applyProtectDirectives(command: ParsedCommand, rules: Rule[]): ValidationResult | null {
    // TODO: P2 feature - Check protect directives
    return null;
  }

  private applySandboxDirectives(command: ParsedCommand, rules: Rule[]): ValidationResult | null {
    // TODO: P2 feature - Check sandbox directives
    return null;
  }

  /**
   * Apply pattern rules (BLOCK/CONFIRM/ALLOW)
   * Uses PatternMatcher to find best matching rule
   */
  private applyPatternRules(command: ParsedCommand, rules: Rule[]): ValidationResult {
    // Filter out PROTECT and SANDBOX directives, only match pattern rules
    const patternRules = rules.filter(
      rule => rule.type === RuleType.BLOCK || 
              rule.type === RuleType.CONFIRM || 
              rule.type === RuleType.ALLOW
    );

    // Match command against rules
    const matchResult = this.matcher.match(command, patternRules);

    // If no match, default to ALLOW
    if (!matchResult.matched || !matchResult.rule) {
      return {
        action: ValidationAction.ALLOW,
        reason: 'No matching rules - default allow policy'
      };
    }

    // Convert rule type to validation action
    const rule = matchResult.rule;
    let action: ValidationAction;
    let reason: string;

    switch (rule.type) {
      case RuleType.BLOCK:
        action = ValidationAction.BLOCK;
        reason = `Blocked by rule: ${rule.pattern}`;
        break;
      
      case RuleType.CONFIRM:
        action = ValidationAction.CONFIRM;
        reason = `Confirmation required by rule: ${rule.pattern}`;
        break;
      
      case RuleType.ALLOW:
        action = ValidationAction.ALLOW;
        reason = `Explicitly allowed by rule: ${rule.pattern}`;
        break;
      
      default:
        // Should not reach here due to filtering above
        action = ValidationAction.ALLOW;
        reason = 'Default allow policy';
    }

    return {
      action,
      rule,
      reason
    };
  }

  private detectWriteOperation(command: ParsedCommand): boolean {
    // TODO: P2 feature - Detect write operations for PROTECT/SANDBOX
    return false;
  }

  private extractTargetPaths(command: ParsedCommand): string[] {
    // TODO: P2 feature - Extract target paths from command
    return [];
  }

  /**
   * Check if a command contains catastrophic paths that should always be blocked.
   * This catches attacks like "rm -rf node_modules dist ~/" where dangerous paths
   * are hidden among benign-looking arguments.
   */
  private checkCatastrophicPaths(command: ParsedCommand): ValidationResult | null {
    for (const segment of command.segments) {
      // Only check destructive commands
      const baseCommand = path.basename(segment.command);
      if (!this.DESTRUCTIVE_COMMANDS.includes(baseCommand)) {
        continue;
      }

      // Check if command has destructive flags
      const hasDestructiveFlags = segment.args.some(arg =>
        this.DESTRUCTIVE_FLAGS.some(flag => {
          // Handle combined flags like -rf, -fr, etc.
          if (arg.startsWith('-') && !arg.startsWith('--')) {
            // Single dash flag - check if it contains 'r' (recursive)
            const flagChars = arg.slice(1);
            return flagChars.includes('r') || flagChars.includes('R');
          }
          return arg === flag;
        })
      );

      if (!hasDestructiveFlags) {
        continue;
      }

      // Check each argument for catastrophic paths
      for (const arg of segment.args) {
        // Skip flags
        if (arg.startsWith('-')) {
          continue;
        }

        // Normalize the path for comparison
        const normalizedArg = this.normalizePath(arg);

        // Check against catastrophic paths
        for (const dangerousPath of this.CATASTROPHIC_PATHS) {
          const normalizedDangerous = this.normalizePath(dangerousPath);

          // Exact match or trying to delete parent of catastrophic path
          if (normalizedArg === normalizedDangerous) {
            return {
              action: ValidationAction.BLOCK,
              reason: `BLOCKED: Catastrophic path detected - "${arg}" would delete critical system/user files`,
              metadata: {
                targetPaths: [arg],
                estimatedImpact: 'catastrophic'
              }
            };
          }

          // Check if argument is a parent directory of a catastrophic path
          // e.g., rm -rf /home when /home/user is catastrophic
          if (normalizedDangerous.startsWith(normalizedArg + '/')) {
            return {
              action: ValidationAction.BLOCK,
              reason: `BLOCKED: Path "${arg}" contains critical system/user directories`,
              metadata: {
                targetPaths: [arg],
                estimatedImpact: 'catastrophic'
              }
            };
          }
        }

        // Additional check: wildcard that could match catastrophic paths
        if (arg === '*' || arg === '/*' || arg === '~/*' || arg === '$HOME/*') {
          const cwd = process.cwd();
          // If we're in a catastrophic directory and using *, block it
          for (const dangerousPath of this.CATASTROPHIC_PATHS) {
            if (cwd === this.normalizePath(dangerousPath) ||
                cwd.startsWith(this.normalizePath(dangerousPath) + '/') === false &&
                this.normalizePath(dangerousPath).startsWith(cwd + '/')) {
              // We're either in a dangerous dir or dangerous dir is under cwd
              if (arg === '*') {
                return {
                  action: ValidationAction.BLOCK,
                  reason: `BLOCKED: Wildcard "*" in "${cwd}" could affect critical directories`,
                  metadata: {
                    targetPaths: [arg],
                    estimatedImpact: 'catastrophic'
                  }
                };
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Normalize a path for consistent comparison
   */
  private normalizePath(p: string): string {
    // Handle empty or undefined
    if (!p) return '';

    // Expand ~ to home directory
    let normalized = p;
    if (normalized.startsWith('~/')) {
      normalized = path.join(os.homedir(), normalized.slice(2));
    } else if (normalized === '~') {
      normalized = os.homedir();
    }

    // Resolve to absolute path
    normalized = path.resolve(normalized);

    // Remove trailing slash (except for root)
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }
}
