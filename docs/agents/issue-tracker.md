# Issue tracker

Use GitHub Issues in the private repository `DrBushyTop/research-capture-knowledge-base` through the authenticated `gh` CLI. GitHub is the canonical location for planning questions, status, assignments, dependencies, and resolutions.

## Wayfinding operations

The map is [Plan the research capture and knowledge base MVP](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/1), labelled `wayfinder:map`. Its body contains Destination, Notes, Decisions so far, Not yet specified, and Out of scope. It indexes resolved decisions; open tickets are native child issues.

Each child has a type label, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. The `wayfinder:afk` and `wayfinder:hitl` labels distinguish agent-driven research from work requiring the human. The issue body states the question and resolution requirements; answers belong in resolution comments.

Use GitHub's native sub-issue and blocked-by relationships. Read the current map children and each child's blockers, following pagination:

```sh
gh api repos/DrBushyTop/research-capture-knowledge-base/issues/1/sub_issues --paginate
gh api repos/DrBushyTop/research-capture-knowledge-base/issues/NUMBER/dependencies/blocked_by --paginate
```

The frontier is the open, unassigned children whose blockers are all closed. Query the live relationships each session. Local planning files and copied status checklists are unnecessary.

Claim a ticket by assigning `DrBushyTop` before work:

```sh
gh issue edit NUMBER --repo DrBushyTop/research-capture-knowledge-base --add-assignee DrBushyTop
```

On resolution, post a dated answer as an issue comment, link its research or prototype assets, and close it as completed. Append a linked one-line gist to the map's Decisions so far. Refer to issues by linked titles in prose; numbers are API lookup keys.

Create new issues before wiring their relationships. The REST API adds a child through `POST /repos/{owner}/{repo}/issues/{parent_number}/sub_issues` with the child's database ID in `sub_issue_id`. It adds a blocker through `POST /repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by` with the blocker's database ID in `issue_id`. These IDs differ from issue numbers. [Sub-issue API](https://docs.github.com/en/rest/issues/sub-issues), [Dependency API](https://docs.github.com/en/rest/issues/issue-dependencies).

Remove newly ticketed questions from Not yet specified. Close questions that prove out of scope and link them from Out of scope rather than Decisions so far.

On 2026-10-05 the user authorized implementation, working through the tickets, and delegated judgement. For this effort, continue across tickets and record decisions without stopping for the former one-decision-per-session or HITL confirmation defaults. Human-only acceptance checks still need honest, separate status.

The user requires prototype creation to run in background subagents. Delegate each prototype to a subagent applying the prototype skill, link its artifact from the GitHub ticket, and record the adopted direction under the delegated judgement. Continue independent work while the prototype is being built.

Research findings live in `docs/research/`, link back to their GitHub question, and are linked as assets from resolution comments. The initial research happened before repository history existed; its reports were subsequently published with the brief and glossary during the GitHub migration. Future research sessions can use throwaway `research/<name>` branches.

For multiline issue bodies and comments, use structured API JSON or `gh --body-file` with an actual file. Keep real newlines. When creating or working on a pull request, register its full URL with this thread's `link_pull_request` tool.
