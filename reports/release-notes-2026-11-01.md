# Software Factory v1.0.0

## What's new

23 Oct – 01 Nov 2026

### New features
- The factory turns GitHub issues into pull requests: it builds each issue with Claude Code on its own branch, tests it, reviews it, and opens a pull request only when the review approves. A person always does the final merge.
- A scheduler runs the build, test and review steps automatically for every project you switch on. It is off by default.
- A web board shows every issue in its lane, from `ready` to `done`, with each card tinted in its project's color. You can create an issue from the board.
- You can add a project by pasting a GitHub address, and archive or restore projects from the admin screen.
- The board sits behind a login: roles, an admin screen for users, an audit log, and optional two-factor sign-in (MFA).
- Email verification and "forgot password" by email, if you switch them on.
- The board works on phones and has a light and dark theme.
- You can now install it from Docker Hub without the source code. The image supports both Intel/AMD and ARM computers.

### Improvements
- Pages meet the WCAG 2.2 AA accessibility standard, and form errors are linked to the fields they belong to.
- Sign-in cards are centered, and the theme and account buttons stay on screen on narrow phones.
- Imported projects start switched off, and the runner waits until the board is ready before it starts.
- Cards that the review step already approved are no longer reviewed again.

### Under the hood
- Hardened Docker setup, automated build and tests on every change, and expanded documentation.

### Changes to be aware of
- The setting `ISSUE_GITHUB_TOKEN` is renamed to `CREATE_ISSUE_GITHUB_TOKEN`. Update your `.env` if you used it.
