/**
 * Unit tests for RuleEngine
 */

import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../src/rule-engine';
import { ParsedCommand, Rule, RuleType, RuleSource, ValidationAction } from '../../src/types';

describe('RuleEngine', () => {
  const engine = new RuleEngine();

  // Helper to create a simple parsed command
  const createCommand = (cmd: string): ParsedCommand => ({
    original: cmd,
    normalized: cmd,
    tokens: [],
    segments: [],
    isChained: false,
    isPiped: false
  });

  // Helper to create a rule
  const createRule = (type: RuleType, pattern: string, specificity: number = 10): Rule => ({
    type,
    pattern,
    source: RuleSource.PROJECT,
    lineNumber: 1,
    specificity
  });

  describe('validate', () => {
    it('should block commands matching BLOCK rules', () => {
      const command = createCommand('rm -rf /');
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.rule).toBeDefined();
      expect(result.rule?.type).toBe(RuleType.BLOCK);
      expect(result.reason).toContain('Blocked by rule');
    });

    it('should allow commands matching ALLOW rules', () => {
      const command = createCommand('rm -rf node_modules');
      const rules = [createRule(RuleType.ALLOW, 'rm -rf node_modules')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.ALLOW);
      expect(result.rule).toBeDefined();
      expect(result.rule?.type).toBe(RuleType.ALLOW);
      expect(result.reason).toContain('Explicitly allowed');
    });

    it('should require confirmation for commands matching CONFIRM rules', () => {
      const command = createCommand('rm -rf *');
      const rules = [createRule(RuleType.CONFIRM, 'rm -rf *')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.CONFIRM);
      expect(result.rule).toBeDefined();
      expect(result.rule?.type).toBe(RuleType.CONFIRM);
      expect(result.reason).toContain('Confirmation required');
    });

    it('should default to ALLOW when no rules match', () => {
      const command = createCommand('echo hello');
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.ALLOW);
      expect(result.rule).toBeUndefined();
      expect(result.reason).toContain('default allow');
    });

    it('should apply BLOCK precedence over ALLOW when both match', () => {
      const command = createCommand('rm -rf /tmp');
      const rules = [
        createRule(RuleType.ALLOW, 'rm -rf *', 5),
        createRule(RuleType.BLOCK, 'rm -rf /tmp', 10)
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.rule?.type).toBe(RuleType.BLOCK);
    });

    it('should apply BLOCK precedence over CONFIRM when both match', () => {
      const command = createCommand('rm -rf /');
      const rules = [
        createRule(RuleType.CONFIRM, 'rm -rf *', 5),
        createRule(RuleType.BLOCK, 'rm -rf /', 10)
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.rule?.type).toBe(RuleType.BLOCK);
    });

    it('should apply CONFIRM when it is more specific than ALLOW', () => {
      const command = createCommand('rm -rf temp');
      const rules = [
        createRule(RuleType.ALLOW, 'rm -rf *', 5),
        createRule(RuleType.CONFIRM, 'rm -rf temp', 10)
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.CONFIRM);
      expect(result.rule?.type).toBe(RuleType.CONFIRM);
    });

    it('should apply ALLOW when it is more specific than CONFIRM', () => {
      const command = createCommand('rm -rf node_modules');
      const rules = [
        createRule(RuleType.CONFIRM, 'rm -rf *', 5),
        createRule(RuleType.ALLOW, 'rm -rf node_modules', 15)
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.ALLOW);
      expect(result.rule?.type).toBe(RuleType.ALLOW);
    });

    it('should select more specific rule when multiple rules of same type match', () => {
      const command = createCommand('rm -rf /tmp/test');
      const rules = [
        createRule(RuleType.BLOCK, 'rm -rf *', 5),
        createRule(RuleType.BLOCK, 'rm -rf /tmp/test', 15)
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.rule?.pattern).toBe('rm -rf /tmp/test');
      expect(result.rule?.specificity).toBe(15);
    });

    it('should handle empty rules list', () => {
      const command = createCommand('rm -rf /');
      const rules: Rule[] = [];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.ALLOW);
      expect(result.rule).toBeUndefined();
      expect(result.reason).toContain('default allow');
    });

    it('should filter out PROTECT and SANDBOX directives from pattern matching', () => {
      const command = createCommand('rm -rf /tmp');
      const rules = [
        createRule(RuleType.PROTECT, '/tmp'),
        createRule(RuleType.SANDBOX, '/home'),
        createRule(RuleType.BLOCK, 'rm -rf /tmp')
      ];

      const result = engine.validate(command, rules);

      // Should match the BLOCK rule, not the PROTECT/SANDBOX
      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.rule?.type).toBe(RuleType.BLOCK);
    });
  });

  describe('Example 1: Block catastrophic rm -rf /', () => {
    /**
     * **Feature: agentguard, Example 1: Block catastrophic rm -rf /**
     * **Validates: Requirements 3.4**
     * 
     * Verify that the command `rm -rf /` is blocked when a BLOCK rule exists for it.
     * This is a catastrophic command that would delete the entire filesystem.
     */
    it('blocks rm -rf / with catastrophic block rule', () => {
      const command = createCommand('rm -rf /');
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.rule).toBeDefined();
      expect(result.rule?.type).toBe(RuleType.BLOCK);
      expect(result.rule?.pattern).toBe('rm -rf /');
      expect(result.reason).toContain('Blocked by rule');
    });
  });

  describe('Chained command validation', () => {
    // Helper to create a chained command
    const createChainedCommand = (segments: Array<{ cmd: string; args: string[]; op?: '&&' | '||' | ';' | '|' }>): ParsedCommand => {
      const commandSegments = segments.map((seg, idx) => ({
        command: seg.cmd,
        args: seg.args,
        operator: seg.op
      }));
      
      const fullCommand = segments.map((seg, idx) => {
        const cmd = `${seg.cmd} ${seg.args.join(' ')}`.trim();
        return idx < segments.length - 1 && seg.op ? `${cmd} ${seg.op}` : cmd;
      }).join(' ');
      
      return {
        original: fullCommand,
        normalized: fullCommand,
        tokens: [],
        segments: commandSegments,
        isChained: segments.some(s => s.op && ['&&', '||', ';'].includes(s.op)),
        isPiped: segments.some(s => s.op === '|')
      };
    };

    it('validates each segment independently', () => {
      const command = createChainedCommand([
        { cmd: 'echo', args: ['hello'], op: '&&' },
        { cmd: 'echo', args: ['world'] }
      ]);
      const rules = [createRule(RuleType.ALLOW, 'echo *')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.ALLOW);
    });

    it('blocks entire chain if any segment is blocked', () => {
      const command = createChainedCommand([
        { cmd: 'echo', args: ['hello'], op: '&&' },
        { cmd: 'rm', args: ['-rf', '/'], op: '&&' },
        { cmd: 'echo', args: ['done'] }
      ]);
      const rules = [
        createRule(RuleType.ALLOW, 'echo *'),
        createRule(RuleType.BLOCK, 'rm -rf /')
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.reason).toContain('Chained command blocked');
      expect(result.reason).toContain('rm -rf /');
    });

    it('blocks chain if first segment is blocked', () => {
      const command = createChainedCommand([
        { cmd: 'rm', args: ['-rf', '/'], op: '&&' },
        { cmd: 'echo', args: ['done'] }
      ]);
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
    });

    it('blocks chain if last segment is blocked', () => {
      const command = createChainedCommand([
        { cmd: 'echo', args: ['starting'], op: '&&' },
        { cmd: 'rm', args: ['-rf', '/'] }
      ]);
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
    });

    it('handles || operator', () => {
      const command = createChainedCommand([
        { cmd: 'command1', args: [], op: '||' },
        { cmd: 'rm', args: ['-rf', '/'] }
      ]);
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
    });

    it('handles ; operator', () => {
      const command = createChainedCommand([
        { cmd: 'ls', args: [], op: ';' },
        { cmd: 'rm', args: ['-rf', '/'], op: ';' },
        { cmd: 'pwd', args: [] }
      ]);
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
    });

    it('requires confirmation if any segment requires confirmation', () => {
      const command = createChainedCommand([
        { cmd: 'echo', args: ['hello'], op: '&&' },
        { cmd: 'rm', args: ['-rf', '*'], op: '&&' },
        { cmd: 'echo', args: ['done'] }
      ]);
      const rules = [
        createRule(RuleType.ALLOW, 'echo *'),
        createRule(RuleType.CONFIRM, 'rm -rf *')
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.CONFIRM);
      expect(result.reason).toContain('requires confirmation');
    });

    it('allows chain if all segments are allowed', () => {
      const command = createChainedCommand([
        { cmd: 'make', args: [], op: '&&' },
        { cmd: 'make', args: ['test'], op: '&&' },
        { cmd: 'echo', args: ['success'] }
      ]);
      const rules = [
        createRule(RuleType.ALLOW, 'make'),
        createRule(RuleType.ALLOW, 'make test'),
        createRule(RuleType.ALLOW, 'echo *')
      ];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.ALLOW);
    });

    it('handles piped commands', () => {
      const command = createChainedCommand([
        { cmd: 'cat', args: ['file.txt'], op: '|' },
        { cmd: 'rm', args: ['-rf', '/'] }
      ]);
      const rules = [createRule(RuleType.BLOCK, 'rm -rf /')];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.BLOCK);
      expect(result.reason).toContain('Chained command blocked');
    });

    it('allows chain with default policy when no rules match', () => {
      const command = createChainedCommand([
        { cmd: 'echo', args: ['hello'], op: '&&' },
        { cmd: 'pwd', args: [] }
      ]);
      const rules: Rule[] = [];

      const result = engine.validate(command, rules);

      expect(result.action).toBe(ValidationAction.ALLOW);
      expect(result.reason).toContain('default policy');
    });
  });
});
