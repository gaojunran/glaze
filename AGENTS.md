# AGENTS.md

Rules for agents working on Glaze.

## Documentation

- `README.md` is the front page only. Keep it short: what Glaze is, why it
  exists, current status, package names, links, and license. Do not put
  implementation details, code-level APIs, internal architecture, benchmarks,
  or design trade-offs there.
- Put implementation details under `docs/`. Link the relevant document from
  `README.md` instead of inlining it.
- After each implementation wave, add or update a document under `docs/` that
  records:
  1. the direction taken and why;
  2. the implementation details a new contributor needs;
  3. the design trade-offs and rejected alternatives;
  4. validation evidence: exact commands, environment, and results.
- Keep docs and code in sync in the same change. If behavior changes, update the
  matching doc in the same commit.

## Code and validation

- Commit messages are written in English.
- Keep a change scoped. Unrelated refactors go in a separate commit.
- Every performance claim needs a reproducible command and measured numbers;
  architecture-only claims are not enough.
- Validate with a local minidev checkout via
  `cargo run -p daemon --bin minidev -- ...`, not a globally installed binary.
- A change that only passes unit tests is not accepted for a glass-easel
  runtime change. Run it in the minidev simulator and record the result.
