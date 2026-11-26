# Frame-token measurements (2026-11-26)

`frame-overhead.json` holds the raw runs behind
`docs/assets/frame-commit-overhead.png`. Each case has:

- `data`: run values before the gating change, excluding the empty
  `setData({})` token;
- `frame`: the token wait measured separately;
- `after`: the same action after pages without an async boundary returned to
  microtask commits.

The benchmark harness classifies the empty token as `frame` and everything else
as `data`; see `bench/frameworks/run.mjs --precise`. Values are three real-tap
runs on one minidev simulator, not a phone.
