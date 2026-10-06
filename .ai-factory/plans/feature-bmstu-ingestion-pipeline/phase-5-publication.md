# Phase 5 — New public GitHub repository

## Goal

Create a distinct public repository under `artemnoor` and upload the verified
project. This step is explicitly authorized by the user.

## Before publishing

- Inspect `git status`, staged paths, tracked/untracked inventory, and exact
  commit diff.
- Scan tracked content and staged changes for credential patterns, `.env`
  files, applicant names/IDs/emails/phones, raw PDFs/source bodies, PostgreSQL
  dumps, temporary checkouts, and generated virtual environments.
- Verify `.gitignore` covers local capture artifacts, raw docs, build outputs,
  caches, and `.venv`.
- Verify the final bundle has no applicant PII and no raw source bytes; compare
  its file/hash inventory to the audited original BMSTU-2026 export.
- Check the selected repository slug does not already exist; never overwrite
  `andromeda-prod` or source repositories.

## Publish operation

- Create a new repository as `public` under the authenticated `artemnoor`
  account using GitHub CLI.
- Preserve the existing `origin` remote; add a separate named remote for the
  newly created repository.
- Push the verified local `main` branch and set the new repository's default
  branch to `main`.
- Verify remote URL, visibility, branch head SHA, and repository file listing.

## Error handling and acceptance

- If the name is taken, select another unique Andromeda/BMSTU-specific slug;
  do not reuse an existing repo.
- If auth is unavailable, stop before push and report the precise GitHub CLI
  auth condition. Do not expose tokens.
- Do not add unrelated source repositories as submodules or upload the external
  temporary audit clones.
- Acceptance is the new public repository URL with remote `main` matching the
  locally verified commit and the prior repositories unchanged.
