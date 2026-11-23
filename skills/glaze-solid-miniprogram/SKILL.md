---
name: glaze-solid-miniprogram
description: Write, review or migrate a WeChat mini-program that uses Glaze (Solid 2 JSX compiled to native WXML on glass-easel). Use before creating or editing .tsx pages/components, glaze.config files, or fixing Glaze compile errors. Covers the supported JSX subset, signals/stores, For/Show/Switch, props/components/events/slots, context, async Loading/Errored, refs, assets/styles and the build/test workflow.
---

# Glaze Solid mini-program

Glaze compiles Solid 2 JSX to WXML and runs only reactive JavaScript at runtime.
It is **not** React, not Solid web, not Taro/uni-app, and not a DOM runtime.
Business code must stay inside the supported subset; unsupported JSX is a
compile error rather than a silent fallback.

Read this file first, then open the matching reference when the task needs the
details:

| Need | Read |
| --- | --- |
| exact JSX/expression/loop rules and compile errors | [references/language.md](references/language.md) |
| props, components, events, slots, context, refs | [references/components.md](references/components.md) |
| signals, stores, async Loading/Errored, list updates | [references/state-and-async.md](references/state-and-async.md) |
| project config, assets, styles, build and verification | [references/project-and-build.md](references/project-and-build.md) |
| copyable page/component patterns | [examples/](examples/) |

## First: inspect the project

Before writing code:

1. Read `glaze.config.mts` (or `.ts` / `.mjs`) and the existing `src/`.
2. Find the page/component you are changing and the nearest working sibling;
   follow its state, component and naming conventions.
3. Confirm the mini-program is configured for glass-easel:
   `app.json` has `"componentFramework": "glass-easel"` and
   `window.glassEaselWebview: true`. The WebView renderer needs base library
   **3.8.12+**.
4. Never edit generated output (`miniprogram/`, `.tmp/glaze-build/`). Change
   `src/` or the config and rebuild.

## Non-negotiable rules

1. **A page/component is one default-exported function.**
   ```tsx
   export default function Page(props: PageProps) {
     return <view>...</view>
   }
   ```
   Named helper functions and type aliases are fine. Keep module-level runtime
   work out of components; components can be inlined into their parent.

2. **Use mini-program tags, not HTML tags.**
   `view`, `text`, `button`, `image`, `input`, `textarea`, `scroll-view`,
   `swiper`, `picker`, `slot`. There is no `div`/`span`/`p`.

3. **Signals are functions.** Read `count()`, not `count`; write
   `setCount(next)` or the functional form
   `setCount((value) => value + 1)`. In a burst of events use the functional
   setter: `setCount(count() + 1)` reads a stale value and can lose updates.

4. **Do not destructure props.** Read `props.title`; use `omit(props, ...)` for
   a rest object. Props are read-only; never assign or delete a prop.

5. **Lists are `<For>` or `<Repeat>`, never `.map()` in JSX.**
   ```tsx
   <For each={todos()} keyed={(todo) => todo.id}>
     {(todo) => <TodoItem title={todo().title} />}
   </For>
   ```
   Use a stable `keyed` function for object lists. `keyed={false}` is for
   primitive/positional lists and intentionally emits no `wx:key`.

6. **Conditions are `<Show>` / `<Switch>` / `<Match>`.**
   Prefer explicit branches over returning JSX from `&&` inside arbitrary
   expressions. Do not use React `&&` UI patterns.

7. **Events are JSX props:** `onClick`, `onInput`, `onChange`, `onConfirm`,
   `onLongPress`, etc. Use `onClickCatch`, `onClickCapture`,
   `onClickCaptureCatch` or `onClickMutBind` when the event semantics require
   it. Never write `bindtap`, `catchtap` or `@click` in TSX.

8. **Component events are `onSomething` props.** The child triggers `something`;
   the parent handler receives `event.detail` as one argument. Use the
   `Catch`/`Capture`/`MutBind` suffix on component events the same way as
   native events.

9. **Use `class` and `style`, not React `className` conventions.** Object and
   array forms are supported:
   ```tsx
   <view class={{ active: props.active, done: props.done }} />
   <view style={{ marginTop: 2, color: props.color }} />
   ```

10. **Context must be importable from a module.** Define it in a shared
    `.ts` file with `createContext`, then `useContext` it. A same-file
    `createContext` cannot cross a component boundary. Object context values
    stay reactive; primitive values are captured when the provider runs.

11. **Async state is a memo under a boundary.** Use `createMemo(async () => ...)`
    (or a memo that throws `NotReadyError`), not a React effect or resource
    pattern. Wrap the reading subtree in `<Loading>`; use `<Errored>` for
    errors:
    ```tsx
    <Loading fallback={<text>loading</text>} on={route()}>
      <text>{profile()}</text>
    </Loading>
    ```

12. **A ref is a node handle, not a DOM node.** It exposes measurement,
    descendant queries, `focus`/`blur`, attributes and `scrollIntoView`. Do not
    expect `appendChild`, `innerHTML`, `style` mutation or a real HTMLElement.

13. **Assets are imported or declared in `static`.** Use
    `import logo from './assets/logo.png'` or a static `src="./assets/logo.png"`
    literal. Dynamic `src={value}` is not rewritten: use a package-absolute
    path (`/assets/logo.png`), a remote URL, or runtime data.

14. **Do not use unsupported JSX.** No arbitrary `.map()`, dynamic components,
    render props/HOCs, `Portal`, `Transition`, dynamic JSX spread, or
    `innerHTML`/`textContent`. If a design needs one, propose a supported shape
    (For/Show/a component boundary) instead of forcing it.

## Recommended workflow

1. **Model the data first.** Put mutable state in `createSignal`/`createStore`;
   derive with `createMemo`; keep handlers as plain functions.
2. **Write the smallest page/component tree.** Use native tags for layout;
   import a child component only when it has its own state, slot or lifecycle.
3. **Compile early.** Run the project's `glaze build` (or `pnpm build`) after
   the first small edit, not after a large rewrite.
4. **Fix the first compile error before adding more.** Glaze errors name the
   unsupported node or expression; see the quick map below.
5. **Verify behavior in the simulator** with the project's e2e/test command.
   A build passing is not evidence that a list, event or async transition works.

## Quick compile-error map

| Error | Fix |
| --- | --- |
| `<For>` / `<Show>` inside a loop is unsupported in a particular form | Follow the exact restriction in `references/language.md`; flatten the loop or move logic to a component |
| `ref` inside `For`/`Show`/`Match` | Move the ref to a non-loop element, or use a callback/event |
| component event collides with a native event | Rename the custom event, e.g. `onPick` not `onTap` |
| `Event handler cannot be JSX` | Return a handler function, not JSX |
| `"props" is read-only` | Copy to a local signal/store |
| `JSX spread` rejected | Write static attributes or an object-literal spread with known keys |
| template literal inside a loop | Build the string with `+`, or precompute it |
| `Destination ... outside` / route/path build error | Fix `glaze.config` paths; output/source must be project subdirectories |
| `Output path collision` | Rename the page route, static path or component |
| dynamic asset URL did not load | Use an imported asset, `static` + package-absolute URL, or a remote URL |

## Before you finish

- `glaze build` succeeds from the project root.
- The changed page renders in minidev or the project's real-device workflow.
- Every new button has a reachable handler; every list has a stable key where
  the data is object-shaped.
- No prop mutation, no `.map()` JSX, no `@solidjs/web`/`solid-js/store`
  imports, no hand-edited generated files.
- If behavior changed, update the project documentation in the same change.
