# Contributing Guide

> **Important:** All commands in this guide must be run in **Git Bash**, not Command Prompt or PowerShell. This ensures compatibility across all operating systems and prevents path/command issues.

## Branch Naming Convention

Create feature branches using this format: `feature/your-name-or-task`

**Examples:**
- `feature/crypto`
- `feature/voting-logic`
- `feature/humaira-auth`
- `feature/sheikh-ui`

## Branching Strategy

This project uses a three-tier branching model:

- **`main`** — Production-ready code (stable releases only)
- **`dev`** — Integration branch for testing (where features are merged first)
- **`feature/***`** — Your work branches (created from `dev`)

**Golden Rule:** Nobody pushes directly to `main` or `dev`. All work goes through pull requests.

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/sheikhhossainn/evoting-simulation.git
cd evoting-simulation
```

### 2. Create a Local Feature Branch (Always from `dev`)

First, ensure you have the latest `dev` branch:

```bash
git checkout dev
git pull origin dev
```

Then create your feature branch from `dev`:

```bash
git checkout -b feature/your-task-name
```

Replace `your-task-name` with your actual task (e.g., `git checkout -b feature/add-encryption`).

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

If this is your first push on this branch, use:

```bash
git push -u origin feature/your-task-name
```

The `-u` flag sets the upstream, so future pushes only need `git push`.

## Syncing `dev` into Your Feature Branch During Development

If other team members push changes to `dev` while you're working, keep your branch up to date:

```bash
git checkout dev
git pull origin dev
git checkout feature/your-task-name
git merge dev
```

This pulls the latest changes from `dev` into your feature branch, preventing merge conflicts later.

## Creating a Pull Request

When your work is complete and committed, create a pull request to merge into `dev`:

1. **Go to the repository** on GitHub: https://github.com/sheikhhossainn/evoting-simulation
2. **Click the "Pull requests" tab** at the top
3. **Click "New pull request"** (green button)
4. **Select your branch** as the "compare" branch (the one you've been working on)
5. **Ensure `dev` is selected** as the base branch (NOT `main`)
6. **Add a clear title and description** of your changes
7. **Click "Create pull request"**

A team member will review your changes, request modifications if needed, or approve and merge.

## Deleting Your Branch After Merge

Once your pull request is merged into `dev`, clean up your local and remote branches:

### 1. Switch to `dev`

First, move away from your feature branch:

```bash
git checkout dev
```

### 2. Delete Local Branch

```bash
git branch -d feature/your-task-name
```

Use `-d` for safe deletion (only works if the branch is fully merged).

If you need to force delete (only if you're absolutely sure):

```bash
git branch -D feature/your-task-name
```

### 3. Delete Remote Branch

```bash
git push origin --delete feature/your-task-name
```

## Contribution Rules

- ⛔ **No direct pushes to `main` or `dev`** — all changes require a pull request
- 👥 **Code review required** — at least one team member must review and approve before merging
- 📝 **Always target `dev`** — feature branches merge into `dev`, not `main`
- 🔄 **Keep branches synced** — merge `dev` into your branch regularly to avoid conflicts
- 🧹 **Clean up branches** — delete your branch after merging to keep the repo tidy

## Full Example: Complete Workflow

Here's the entire contribution cycle from start to finish:

```bash
# 1. Clone the repository (first time only)
git clone https://github.com/sheikhhossainn/evoting-simulation.git
cd evoting-simulation

# 2. Get the latest dev branch
git checkout dev
git pull origin dev

# 3. Create your feature branch from dev
git checkout -b feature/add-ballot-verification

# 4. Make your changes
# ... edit files in your editor ...

# 5. Stage and commit your changes
git add .
git commit -m "Add ballot verification logic with checksum validation"

# 6. Push your branch to remote
git push -u origin feature/add-ballot-verification

# 7. If dev gets updated while you're working, keep your branch in sync
git checkout dev
git pull origin dev
git checkout feature/add-ballot-verification
git merge dev

# 8. Push the merge
git push

# 9. Create a pull request on GitHub
# Go to: https://github.com/sheikhhossainn/evoting-simulation
# Click "Pull requests" → "New pull request"
# Select your branch as compare, dev as base, add description, create PR

# 10. Wait for review and approval from a team member

# 11. After PR is merged, switch to dev
git checkout dev

# 12. Delete local branch
git branch -d feature/add-ballot-verification

# 13. Delete remote branch
git push origin --delete feature/add-ballot-verification

# 14. Pull the latest dev to stay updated
git pull origin dev
```

## Daily Workflow

Start every day by syncing with the latest `dev`:

```bash
git checkout dev
git pull origin dev
```

Then switch to your feature branch and continue work:

```bash
git checkout feature/your-task-name
```

Before you start coding each day, it's a good idea to merge the latest `dev` into your branch:

```bash
git merge dev
```

This keeps your work aligned with what the team has been doing.

## Need Help?

- **Stuck on a Git command?** Ask a team member
- **Project details?** Check the main [README.md](README.md)
- **Learn Git better?** See [GitHub's Git documentation](https://docs.github.com/en/get-started/using-git)
- **Merge conflicts?** Reach out to the team—don't force push unless you're absolutely sure
