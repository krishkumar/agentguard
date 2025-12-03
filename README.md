# AgentGuard

**Work safely with agents like Claude Code.**

AI coding agents are powerful—but with great power comes `rm -rf /`.

I've been recommending tools like Claude Code and Cursor to junior devs and non-technical folks lately. These agents can execute shell commands autonomously, which is useful. But it also means a single hallucination could wipe their SSH keys, nuke a folder, or brick a meticulously created dev environment.

Frontier models do come with guardrails, but I wanted control over project-specific no-nos too—like pushing to master or running that one script that drops the staging database.

An LLM deciding whether a command is "safe" is probabilistic. I wanted something classical — a system where I define exactly what's allowed and what's blocked, with no ambiguity. 

Inspired by `.gitignore`: simple pattern matching, one rule per line, easy for anyone to read and modify.

> Built with [Kiro](https://kiro.dev) for the Kiroween Hackathon 2025

## Highlights

- Deterministic rules, not probabilistic LLM guardrails
- `.gitignore`-style syntax anyone can read
- Zero latency—all validation is local
- Claude Code hook integration

## Install

```bash
npm install -g ai-agentguard
```

Or from source:

```bash
git clone https://github.com/krishkumar/agentguard
cd agentguard
npm install && npm run build
npm link
```

## Quick Start

```bash
agentguard init           # Creates .agentguard with sensible defaults
agentguard install claude # Registers the hook
```

That's it. Every shell command Claude tries to run now goes through AgentGuard first.

## What it does

AgentGuard intercepts shell commands before they execute and validates them against a simple rules file. If a command matches a block pattern, it gets stopped. If it's allowed, it runs normally.

Here's what that looks like in practice:

```
> run nuketown.sh

⏺ Bash(./nuketown.sh)
  ⎿  Error: PreToolUse:Bash hook error: [node ./dist/bin/claude-hook.js]: 🚫
     AgentGuard BLOCKED: ./nuketown.sh
     Rule: *nuketown*
     Reason: Blocked by rule: *nuketown*
```

The agent tried to run the command. AgentGuard caught it. Nothing bad happened.

## The rules file

You create a `.agentguard` file in your project root with patterns for commands you want to block:

```bash
# The obvious dangerous stuff
!rm -rf /
!rm -rf /*
!mkfs*
!dd if=* of=/dev/*

# Don't let agents read my secrets
!cat ~/.ssh/*
!cat ~/.aws/*
!cat */.env

# Block that sketchy script I use for demos
!*nuketown*
```

The syntax is deliberately simple. `!` means block, `*` is a wildcard. That's basically it.

## How it works with Claude Code

Claude Code has a hook system that lets you intercept tool calls before they run. AgentGuard registers a `PreToolUse` hook that receives every Bash command as JSON, validates it against your rules, and returns exit code 0 (allow) or 2 (block).

## Commands

```bash
agentguard init             # Create .agentguard with sensible defaults
agentguard install claude   # Register the Claude Code hook
agentguard uninstall claude # Remove the hook
agentguard check "rm -rf /" # Test if a command would be blocked
```

## Roadmap

Right now this only works with Claude Code's hook system. I'd like to add support for:

- Kiro CLI
- Cursor
- Windsurf
- Other agentic tools as they add hook APIs

The core validation logic is agent-agnostic, so adding new integrations is mostly about figuring out each tool's interception mechanism.

## Built with

This project was built using [Kiro](https://kiro.dev) for the Kiroween Hackathon. The rule engine, CLI, and Claude Code integration were all developed with Kiro's assistance.

---

MIT License
