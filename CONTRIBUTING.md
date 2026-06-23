# Contributing Guide

> **Important:** All commands in this guide must be run in **Git Bash**, not Command Prompt or PowerShell. This ensures compatibility across all operating systems and prevents path/command issues.

## Branching Strategy Overview

This project uses a **three-tier branching model**:

```
main (Production - only merged from dev when tested & stable)
  ↑
  └─ dev (Integration branch - where all features merge first)
       ↑
       └─ feature/your-task (Your work - always branch from dev, never from main)
```

**Most Important Rules:** 
- 🚫 **Nobody pushes directly to `main` or `dev`**
- ✅ **Everyone creates a feature branch from `dev`**
- ✅ **Everyone merges their feature branch back into `dev` via pull request**
- ✅ **Only `dev` merges into `main` when everything is tested and stable**

## Branch Naming Convention

Create feature branches using this format: `feature/your-name-or-task`

**Examples:**
- `feature/crypto`
- `feature/voting-logic`
- `feature/humaira-auth`
- `feature/sheikh-ui`

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/sheikhhossainn/evoting-simulation.git
cd evoting-simulation
```

### 2. Create a Local Feature Branch (Always from `dev`, NOT from `main`)

First, ensure you're on `dev` and have the latest code:

```bash
git checkout dev
git pull origin dev
```

Then create your feature branch from `dev`:

```bash
git checkout -b feature/your-task-name
```

Replace `your-task-name` with your actual task (e.g., `git checkout -b feature/add-encryption`).

**Important:** Your feature branch must come from `dev`, not `main`. `main` is read-only for your team.

### 3. Push Your Feature Branch to Remote

```bash
git push -u origin feature/your-task-name
```

The `-u` flag sets the upstream, so future pushes only need `git push`.

## Making and Committing Changes

After making changes to your code, follow these steps:

### 1. Stage Your Changes

```bash
git add .
```

This stages all modified files. To stage specific files:

```bash
git add path/to/file.js
```

### 2. Commit Your Changes

```bash
git commit -m "Clear description of what you changed"
```

**Commit message tips:**
- Be specific: "Add ElGamal encryption module" ✅ instead of "fix stuff" ❌
- Start with a verb: Add, Fix, Update, Remove, Refactor
- Keep it under 50 characters if possible
- Use lowercase and no period at the end

### 3. Push to Remote

```bash
git push
```

Your commits go to your feature branch. They will NOT go to `dev` or `main` until you create and merge a pull request.

## Syncing `dev` into Your Feature Branch During Development

If other team members merge changes into `dev` while you're working, keep your branch up to date:

```bash
git checkout dev
git pull origin dev
git checkout feature/your-task-name
git merge dev
```

Then push the merge to your remote feature branch:

```bash
git push
```

This pulls the latest changes from `dev` into your feature branch, preventing merge conflicts later.

## Creating a Pull Request (Merge into `dev`, NOT `main`)

When your work is complete and committed, create a pull request to merge your feature branch into `dev`:

1. **Go to the repository** on GitHub: https://github.com/sheikhhossainn/evoting-simulation
2. **Click the "Pull requests" tab** at the top
3. **Click "New pull request"** (green button)
4. **Select your branch** as the "compare" branch (the one you've been working on)
5. **Ensure `dev` is selected** as the base branch (NOT `main` — this is critical!)
6. **Add a clear title and description** of your changes
7. **Click "Create pull request"**

A team member will review your changes, request modifications if needed, or approve and merge into `dev`.

**Remember:** Your pull request merges into `dev`, not `main`. `main` is only for stable, tested code.

## Deleting Your Branch After Merge

Once your pull request is merged into `dev`, clean up your local and remote branches:

### Important: You Cannot Delete the Branch You're Currently On

You must switch to a different branch before deleting your feature branch. Never delete a branch while you're currently using it.

### 1. Switch Away from Your Feature Branch

Move to the `dev` branch:

```bash
git checkout dev
```

This is mandatory. You cannot delete the branch you're currently on.

### 2. Delete Local Branch

```bash
git branch -d feature/your-task-name
```

Use `-d` for safe deletion (only works if the branch is fully merged).

If you need to force delete (only if you're absolutely sure):

```bash
git branch -D feature/your-task-name
```

Use `-D` only if the branch was never merged and you're certain you want to discard all changes.

### 3. Delete Remote Branch

```bash
git push origin --delete feature/your-task-name
```

### 4. Update Your Local `dev`

```bash
git pull origin dev
```

This ensures you have the latest code from your merged PR.

## Contribution Rules

- 🚫 **No direct pushes to `main` or `dev`** — all changes require a pull request
- 👤 **Feature branches only** — create your own branch from `dev` for every task
- 👥 **Code review required** — at least one team member must review and approve before merging
- 🎯 **Always merge into `dev`** — your PR target branch is `dev`, NOT `main`
- 🔄 **Keep branches synced** — merge `dev` into your branch regularly to avoid conflicts
- 🧹 **Clean up branches** — switch to `dev` first, then delete your branch after merging
- ⚠️ **Never push to `main`** — `main` is read-only; only `dev` merges into it when stable

## Full Example: Complete Workflow

Here's the entire contribution cycle from start to finish:

```bash
# 1. Clone the repository (first time only)
git clone https://github.com/sheikhhossainn/evoting-simulation.git
cd evoting-simulation

# 2. Get the latest dev branch (IMPORTANT: always branch from dev, not main)
git checkout dev
git pull origin dev

# 3. Create your feature branch from dev
git checkout -b feature/add-ballot-verification

# 4. Make your changes
# ... edit files in your editor ...

# 5. Stage and commit your changes
git add .
git commit -m "Add ballot verification logic with checksum validation"

# 6. Push your branch to remote (goes to your feature branch, NOT dev or main)
git push -u origin feature/add-ballot-verification

# 7. If dev gets updated while you're working, keep your branch in sync
git checkout dev
git pull origin dev
git checkout feature/add-ballot-verification
git merge dev
git push

# 8. Create a pull request on GitHub to merge into dev
# Go to: https://github.com/sheikhhossainn/evoting-simulation
# Click "Pull requests" → "New pull request"
# Select your branch as compare, dev as base (NOT main!), add description, create PR

# 9. Wait for review and approval from a team member
# They will review your code and merge into dev

# 10. After PR is merged into dev, SWITCH to dev (mandatory before deleting)
git checkout dev

# 11. Delete local feature branch (can only delete after switching away from it)
git branch -d feature/add-ballot-verification

# 12. Delete remote feature branch
git push origin --delete feature/add-ballot-verification

# 13. Pull the latest dev to stay updated
git pull origin dev

# 14. You're ready for the next task! Repeat from step 2
```

## Daily Workflow

Start every day by syncing with the latest `dev` (the integration branch):

```bash
git checkout dev
git pull origin dev
```

Then switch to your feature branch and continue work:

```bash
git checkout feature/your-task-name
```

Before you start coding each day, merge the latest `dev` into your branch to stay in sync:

```bash
git merge dev
git push
```

This keeps your work aligned with what the team has been doing.

## What Happens to `main`?

- **You never touch `main` directly**
- The team lead (Sheikh) will merge `dev` into `main` when everything is tested and stable
- `main` contains only production-ready code
- If you need to see what's in `main`, just checkout and pull: `git checkout main && git pull origin main`

## Need Help?

- **Stuck on a Git command?** Ask a team member (Humaira or Sheikh)
- **Not sure if you should merge to dev?** Ask first—don't force merge
- **Project details?** Check the main [README.md](README.md)
- **Learn Git better?** See [GitHub's Git documentation](https://docs.github.com/en/get-started/using-git)
- **Merge conflicts?** Reach out to the team—don't force push unless absolutely necessary
- **Can't delete branch?** Make sure you've switched away from it with `git checkout dev` first
