# Agent skills

## `glaze-solid-miniprogram`

A self-contained skill bundle for agents writing Glaze pages and components.
It covers the supported Solid 2 JSX subset, components/props/events/slots,
context, async `Loading`/`Errored`, refs, assets, styles and the build/verify
workflow.

Start at [glaze-solid-miniprogram/SKILL.md](glaze-solid-miniprogram/SKILL.md).

### Install

For OpenCode, place the directory where skills are discovered, for example:

```bash
# user-wide
cp -r skills/glaze-solid-miniprogram ~/.config/opencode/skills/

# or project-local, if the project uses .opencode
mkdir -p .opencode/skills
cp -r skills/glaze-solid-miniprogram .opencode/skills/
```

The required entry point is `glaze-solid-miniprogram/SKILL.md`; the
`references/` and `examples/` directories are supporting material.

### Keep it current

The skill is documentation, not a second implementation. When compiler
behavior or build configuration changes, update the skill in the same change as
the code/docs. The examples should stay within the supported JSX subset.
