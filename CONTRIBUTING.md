# Contributing Guide

## Branch Naming Convention

Create branches using this format: `feature/your-name-or-task`

**Examples:**
- `feature/crypto`
- `feature/voting-logic`
- `feature/john-smith`

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/sheikhhossainn/evoting-simulation.git
cd evoting-simulation
```

### 2. Create a New Local Branch

```bash
git checkout main
git pull origin main
git checkout -b feature/your-task-name
```

Replace `your-task-name` with your actual task (e.g., `git checkout -b feature/crypto`).

### 3. Push Your Branch to Remote

```bash
git push -u origin feature/your-task-name
```

The `-u` flag sets the upstream branch, so future pushes only need `git push`.

### 4. Delete Your Local Branch After Merge

```bash
git branch -d feature/your-task-name
```

For a force delete:

```bash
git branch -D feature/your-task-name
```

## Contribution Rules

- ⛔ **No direct pushes to `main`** — all changes require a pull request
- 👥 **Code review required** — at least one team member must approve before merging
- 📝 **Create a pull request** with a clear description of your changes

## Daily Workflow

Always start your day by syncing with main to avoid conflicts:

```bash
git checkout main
git pull origin main
```

Then switch to your feature branch and continue work:

```bash
git checkout feature/your-task-name
```

## Need Help?

Refer to the main [README.md](README.md) for project details and setup instructions.
