const { Validator } = require('/Volumes/SSD1/workspace/scratch/nextproduct-agentguard/validator.js');

export const AgentGuardPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // Only validate bash/shell commands
      if (input.tool !== 'bash' && input.tool !== 'execute_bash') {
        return;
      }

      const command = output.args?.command;
      if (!command) {
        return;
      }

      // Validate through AgentGuard
      const validator = new Validator();
      const result = validator.validate(command);

      if (result.action === 'BLOCK') {
        throw new Error(`🚫 AgentGuard BLOCKED: ${command}\nRule: ${result.rule?.pattern}\nReason: ${result.reason}`);
      }

      if (result.action === 'CONFIRM') {
        throw new Error(`⚠️ AgentGuard CONFIRM required: ${command}\nThis command requires manual confirmation. Run it directly in terminal.`);
      }
    },
  };
};