/**
 * Rule Engine - Applies rules and determines validation actions
 */

import { ParsedCommand, Rule, ValidationResult, ValidationAction, RuleType } from './types';
import { PatternMatcher } from './pattern-matcher';

export class RuleEngine {
  private matcher: PatternMatcher;

  constructor() {
    this.matcher = new PatternMatcher();
  }

  /**
   * Validate a command against rules
   * Validation order:
   * 1. First try to match the FULL command against rules (for patterns like "* | bash")
   * 2. If command is chained or piped and no full match blocks, validate each segment
   * 3. Check PROTECT directives (if command writes to protected path → BLOCK)
   * 4. Check SANDBOX directives (if command writes outside sandbox → BLOCK)
   * 5. Match against pattern rules (BLOCK/CONFIRM/ALLOW)
   * 6. If no match, default to ALLOW
   */
  validate(command: ParsedCommand, rules: Rule[]): ValidationResult {
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
}
