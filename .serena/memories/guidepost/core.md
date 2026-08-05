`plugins/guidepost` (0.1.1-dev) — turns a commit range or PR diff into an AI-guided code-reading
tour in a browser viewer, with reader questions routed back into the live session. Targets the
"AI wrote it, it works, nobody can explain it" gap as a post-hoc review experience.
Design: `plugins/guidepost/DESIGN.md`; plan: `plugins/guidepost/docs/PLAN.md`.
Workspace pkg `guidepost-scripts`. Node stdlib + `git`/`gh` only.

## What differentiates it from a diff viewer

(a) stops are ordered by **comprehension dependency** (types/data model → core logic → callers →
tests), not by filename; (b) a question asked mid-read reaches the session and its answer is
appended back into the tour.

## Flow

1. Skill `guidepost` (`/guidepost [range|#PR]`, default `HEAD~1..HEAD`) analyses the diff in the
   **main session** and writes `.guidepost/tours/<tour-id>/tour.json`
   (`<tour-id>` = `YYYYMMDD-HHmmss-<sha7>`). No API, no subagent LLM call.
2. `scripts/serve.mjs` serves a self-contained `ui.html` (no CDN, hand-rolled syntax highlighting)
   on port 4870, retrying up to 10 ports from 4871. `src/serve.ts` only does argv/listen/retry/exit;
   routing lives in `src/lib/http-handler.ts` so it is testable without a socket.
3. A submitted question becomes `.guidepost/queue/questions/<ts>.md` (YAML frontmatter carrying
   `tourId`/`stopId`; the queue is shared across tours). `PreToolUse` (`inject-pre-tool-use.mjs`)
   delivers it mid-turn; `Stop` (`inject-stop.mjs`) delivers leftovers at the turn boundary.
   Delivery **atomically moves the file to `processed/`**, giving at-most-once semantics; questions
   asked while no session is open are delivered late on the next session.
4. Claude's answer is written to `.guidepost/tours/<id>/answers/<stop-id>-<ts>.md`; the viewer polls
   every 2s and appends it to the stop without losing view state.

All writes (questions, answers, tour) are temp-file + rename, because hook / server / session touch
the same tree concurrently.

## Limits (v0.1.x)

Max 20 stops (overflow folded into a final summary stop); refuses diffs over 10,000 lines and asks
the user to split the range; `diffText` is stored in the tour so rebases don't break rendering, but
there is no SHA-mismatch warning yet; no tour sharing, comprehension tracking, or history.

`.guidepost/` is runtime state — gitignore-recommended, and agents must not write into it by hand.
