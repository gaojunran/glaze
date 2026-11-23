# Examples

Copy these files into a Glaze project's `source` directory and register the page
entries in `glaze.config.mts`. They are patterns, not a standalone project: the
project still needs `app.js`, `app.json`, `app.wxss`, `glaze.config`, and a
build/test command.

| File | Shows |
| --- | --- |
| `Counter.tsx` | signals, `Show`, keyed `For`, functional setters |
| `TodoItem.tsx` | props, read-only props, a component event |
| `TodoPage.tsx` | keyed list, child component, append, event handler |
| `AsyncPanel.tsx` | `createMemo(async)`, `Loading on`, `Errored reset` |
| `theme.ts`, `ContextChild.tsx`, `ContextDemo.tsx` | module context, object value, reactive palette |
| `glaze.config.example.mts` | pages, static assets, static page and runtime config |

Before using an example, run `glaze build` and then the project's simulator or
e2e test. The examples intentionally avoid unsupported JSX; if you add a pattern
that the compiler rejects, check `references/language.md` instead of bypassing
the compiler.
