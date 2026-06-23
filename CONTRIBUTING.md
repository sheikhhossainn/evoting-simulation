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

## Making and Committing Changes

After making changes to your code, follow these steps to commit and push:

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
git commit -m "Description of your changes"
```

**Commit message tips:**
- Use clear, descriptive messages (e.g., "Add ElGamal encryption module" instead of "fix stuff")
- Keep messages concise but informative

### 3. Push to Remote

```bash
git push
```

If this is your first push on this branch, use:

```bash
git push -u origin feature/your-task-name
```

## Syncing with Main During Development

If other team members push changes to `main` while you're working on your feature branch, keep your branch up to date:

```bash
git checkout main
git pull origin main
git checkout feature/your-task-name
git merge main
```

This pulls the latest changes from `main` into your feature branch, preventing conflicts later.

## Creating a Pull Request

When your work is complete and committed, create a pull request to merge your changes into `main`:

1. **Go to the repository** on GitHub: https://github.com/sheikhhossainn/evoting-simulation
2. **Click the "Pull requests" tab** at the top
3. **Click "New pull request"** (green button)
4. **Select your branch** as the "compare" branch (the one you've been working on)
5. **Ensure `main` is selected** as the base branch
6. **Add a clear title and description** of your changes
7. **Click "Create pull request"**

A team member will review your changes and provide feedback or approval.

## Deleting Your Branch After Merge

Once your pull request is merged, clean up your local and remote branches:

### Delete Local Branch

```bash
git branch -d feature/your-task-name
```

Use `-d` for safe deletion (only works if the branch is fully merged).

If you want to force delete a branch (use only if you're certain):

```bash
git branch -D feature/your-task-name
```

Use `-D` only if the branch was never merged and you're sure you want to discard all changes.

### Delete Remote Branch

```bash
git push origin --delete feature/your-task-name
```

## Contribution Rules

- ⛔ **No direct pushes to `main`** — all changes require a pull request
- 👥 **Code review required** — at least one team member must approve before merging
- 📝 **Create a pull request** with a clear description of your changes
- 🔄 **Keep branches synced** — merge `main` into your branch to stay up to date
- 🧹 **Clean up branches** — delete your branch after merging to keep the repo tidy

## Full Example: Complete Workflow

Here's a step-by-step example of the entire contribution cycle:

```bash
# 1. Clone the repository (first time only)
git clone https://github.com/sheikhhossainn/evoting-simulation.git
cd evoting-simulation

# 2. Start your day by syncing with main
git checkout main
git pull origin main

# 3. Create and switch to your feature branch
git checkout -b feature/add-voting-logic

# 4. Make your changes (edit files, write code, etc.)
# ... edit files in your editor ...

# 5. Stage and commit your changes
git add .
git commit -m "Add voting logic module with ballot verification"

# 6. Push your branch to remote
git push -u origin feature/add-voting-logic

# 7. If main gets updated while you're working, sync it
git merge main

# 8. When done, push final changes
git push

# 9. Create a pull request on GitHub
# Go to: https://github.com/sheikhhossainn/evoting-simulation
# Click "Pull requests" → "New pull request"
# Select your branch and main, add description, create PR

# 10. After PR is merged, delete local branch
git branch -d feature/add-voting-logic

# 11. Delete remote branch
git push origin --delete feature/add-voting-logic
```

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

Before pushing, make sure to pull any recent changes from `main` into your branch:

```bash
git merge main
```

## Need Help?

- Refer to the main [README.md](README.md) for project details and setup instructions
- Ask a team member if you're stuck or unsure about any step
- Check out [GitHub's Git documentation](https://docs.github.com/en/get-started/using-git) for more advanced Git commands
