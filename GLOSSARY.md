# Software Factory Board

A self-hosted board that shows how software work moves through an automated factory. Each company runs its own copy, so nothing is shared between companies.

## Language

**Installation**:
One company's own running copy of the factory. It has its own users, settings and projects, and shares nothing with any other installation.
_Avoid_: Tenant, instance, organization, workspace

**Administrator**:
A user who manages the installation: its users, its credentials and its projects.
_Avoid_: Admin user, owner, superuser

**Member**:
A user who can see the whole board of an installation but cannot change anything.
_Avoid_: Viewer, regular user, guest

**Project**:
One GitHub repository registered with an installation, together with its stack, build and test commands, and limits. A project is enabled or disabled; removing one disables it and keeps its history.
_Avoid_: Repo, repository

**Board**:
The view of issues, across all projects of an installation, arranged in lanes.
_Avoid_: Dashboard, kanban

**Lane**:
One column of the board, marking how far an issue has progressed. The lanes are ready, building, qa, review and done.
_Avoid_: Stage, column, status

**Scheduler**:
The part of an installation that starts the lanes automatically for every enabled project, instead of an Administrator starting them by hand. It is off until an Administrator turns it on.
_Avoid_: Cron, daemon, loop, orchestrator

**Pass**:
One round of the scheduler through the lanes of every enabled project.
_Avoid_: Tick, cycle, iteration, run
