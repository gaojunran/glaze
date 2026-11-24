# Glaze

[English](README.md) | 简体中文

**让 Solid 和 Svelte 原生运行在 glass-easel 上。**

Glaze 将现代 Web 框架编译为原生小程序 WXML，运行时只运行它们的响应式逻辑。
没有虚拟 DOM，没有通用递归模板，也不会为无关状态调用 `setData`。

第一个目标是 **Solid 2**。Svelte 5 计划复用同一套编译器。

## glass-easel 是什么？

[glass-easel](https://github.com/wechat-miniprogram/glass-easel) 是微信小程序
开源的新一代组件框架。它是新组件模型背后的运行时：组件、模板、数据更新、
事件和 slot 都由 glass-easel 处理，而不是旧的 Exparser 层。WebView 渲染器从
基础库 **3.8.12** 起支持它；Skyline 只支持 glass-easel。启用它需要
`componentFramework: "glass-easel"` 和 `window.glassEaselWebview: true`
（见 [构建](docs/build.md)）。

Glaze 直接面向 glass-easel。它生成 WXML/WXSS/JSON 和少量 JS 模块来定义
glass-easel 组件，不替换平台渲染器。

## 为什么叫 Glaze？

釉（glaze）是熔在玻璃表面的一层薄、硬、透明的层：它不替换玻璃，而是改变
表面的行为。Glaze 对 glass-easel 也是同样的意思：一层薄薄的编译与响应式层，
覆盖在平台渲染器之上。

这个名字也保留了家族关系：**glass**-easel 是基底，**Glaze** 是运行在它上面的层。

## 项目特点

- **编译优先生成模板。** Solid JSX 在构建期变成 WXML。运行时没有 Taro 风格的
  DOM shim，也没有通用递归模板。
- **组件边界是有意设计的。** 框架组件会被内联进页面树；只有页面和真正需要与
  小程序互操作的位置才成为 glass-easel 组件。不是每个 Solid 组件都有一个
  props/data 桥。
- **signal 更新变成数据路径。** 一次 signal 更新会通过 glass-easel 的
  `DataGroup` 写入绑定路径（如 `b3[0].done`）或列表 splice；无关状态不会被
  序列化。
- **共享 runtime。** 组件共享 `glaze-runtime/index.js`；只有
  `independent: true` 的独立分包才携带自己的副本。
- **工具链属于编译器的一部分。** `glaze build`、`glaze watch`、
  `glaze snippet`、Vite 桥接、可选 Tailwind 4 和构建期 SCSS/Less 编译都在
  同一条流水线里。
- **有意收窄范围。** 当前目标是微信 + glass-easel + Solid 2。动态组件、
  render props/HOC、任意 `.map()` JSX、Portal、Transition 和完整 DOM-like ref
  都是明确的非目标。
- **没有静默降级。** 不支持的 JSX 会编译报错，而不是悄悄切到另一条运行时路径。

## 当前状态

可工作的 spike，不是生产框架。已覆盖：

- Solid 2 控制流：`For`（全部 keyed 模式、`fallback`、嵌套）、`Show`
  （含回调与 `fallback`）、`Switch`/`Match`、`Repeat`、解构、静态 spread、
  `class`/`style` 辅助函数；
- 组件：props、默认与具名 slot、自定义事件（含 `catch`/`capture`/`mut-bind`）、
  递归内联保护、跨组件边界的 context（对象值保持响应式）、ref 测量、节点查询、
  focus/blur 与属性访问；
- 异步：memo 化的 async binding、带嵌套边界的 `Loading`/`Errored`、
  `Loading on`、`Errored` reset、pending/error 投影；
- 构建：页面、分包（含独立分包）、页面级配置、共享 runtime、静态资源、
  Tailwind 4、SCSS/Less、增量 `watch`、Vite 桥接和单文件 snippet；
- 数据：keyed 列表只把 WXML 真正读取的字段投影进视图层，未使用的行数据
  不再穿过 `setData` 边界；Glaze 到 Glaze 的子组件 props 以单个内部对象
  属性穿过组件边界；
- 验证：604 个单元测试（shared 2、runtime 189、compiler 291、build 122）、
  glass-easel 渲染测试和 10 个 minidev e2e 用例。

已知限制记录在 [编译器](docs/compiler.md)、[构建](docs/build.md) 和
[优化](docs/optimizations.md) 中。编译器与运行时的结构重构记录在
[代码质量](docs/code-quality-refactor.md)。

## 基准测试

这些是**同一 harness** 下的数字：Glaze 对比手写 WXML/WXSS/JS 页面，在
minidev 模拟器中通过 automator 测量。它们包含页面路由和 automator 往返，
因此适合比较同一会话内两个页面的相对表现；它们不是真机耗时，也不能和
其他项目的手机 benchmark 直接比较。

扁平 1000 行列表（三轮，`minidev` 0.18.0，基础库 3.17.3，headless
Chromium 1248）：

| 场景 | Glaze | 原生 WXML |
| --- | ---: | ---: |
| 首屏 | 3210-3250 ms | 3196-3212 ms |
| 单标量更新 | 92-96 ms | 92-93 ms |
| keyed reverse | 65-71 ms | 67-68 ms |

组件密集页面：1000 个纯行组件 + 1000 个有状态行组件（三轮均值）：

| 场景 | Glaze | 原生 WXML | 解读 |
| --- | ---: | ---: | --- |
| 首屏（2000 个组件宿主） | 3584 ms | 3595 ms | 运行波动范围内 |
| 首个纯行字段更新 | 30 ms | 32 ms | 轮询地板 |
| 切换全部 1000 行 | 58 ms | 73 ms | 此 harness 下更快 |
| 有状态行点击 | 25 ms | 26 ms | 轮询地板 |
| 追加一个纯行 | 269 ms | 253 ms | Glaze 更慢，不算胜利 |
| 删除首个纯行 | 191 ms | 180 ms | Glaze 更慢，不算胜利 |
| reverse 1000 行 | 417 ms | 451 ms | 此 harness 下更快 |

边界页面（10 条链 × 10 层嵌套组件、20 个独立输入框、100 张 slot 卡片、
100 个自定义事件行；三轮均值）增加了一个合并首屏数字和贴地板的更新数字：

| 场景 | Glaze | 原生 WXML | 解读 |
| --- | ---: | ---: | --- |
| 首屏（四类内容全部就绪） | 3280 ms | 3209 ms | Glaze +2.2% |
| 深树叶子更新 | 22 ms | 22 ms | 轮询地板 |
| 表单：最后一个输入框输入 10 字符 | 32 ms | 35 ms | 轮询地板 |
| slot：首张卡片文本更新 | 69 ms | 71 ms | 轮询地板 |
| 自定义事件：一次点击往返 | 23 ms | 22 ms | 轮询地板 |

首屏数字覆盖的是整个合并页面，不是每个场景单独的首屏。原生侧的深树使用
100 个普通嵌套 view，因为 WXML 不能递归；Glaze 侧是 100 个组件实例，因此
不是实例对实例完全同构。完整协议、每轮原始值和注意事项（`reLaunch` 后可能
残留旧 DOM、`input()` 不是真实键盘输入、没有 `setData` 字节数）在
[优化](docs/optimizations.md) 中。

## 横向对比

这是架构对比，不是跨框架实测性能对比。Taro、uni-app 和 Vue Mini 是成熟的
项目，目标不同；Glaze 是一个范围很窄的单平台 spike。这里不对其他框架
声称任何 apples-to-apples 的性能数字。

| 框架 | 模型 | 运行时执行什么 | 边界 / 更新 | 官方平台 |
| --- | --- | --- | --- | --- |
| [Taro 4.3.3](https://github.com/NervJS/taro) | 编译 + 运行时（Taro 3 模型）；可选 CompileMode | React/Vue + Taro DOM/BOM；序列化模板 + `setData` | 页面级 `setData`；用 `baseLevel`/`CustomWrapper` 做局部更新 | H5、RN、多个小程序、ASCF |
| [uni-app](https://github.com/dcloudio/uni-app) | 编译 + 每端运行时 | 小程序版 Vue runtime；`.vue` 拆成 WXML/WXSS/JS | 需要拆组件才能局部更新，否则是页面级 | iOS、Android、HarmonyOS Next、Web、多个小程序 |
| [Vue Mini 1.2.16](https://github.com/vue-mini/vue-mini) | 纯运行时 | `@vue/reactivity` + 宿主 `setData`；无 VDOM、无编译器 | 响应式绑定到宿主页面/组件的 `setData` | 仅微信 |
| **Glaze（spike）** | Solid JSX → WXML 编译 + binding runtime | 每个有状态组件一个 Solid root；只运行 binding effect | 纯组件内联；有状态子组件是原生组件；路径/splice 的 `DataChange` 队列 | glass-easel WebView（微信）；Skyline 未验证 |
| 原生 glass-easel | 手写 WXML/WXSS/JS | 平台组件框架 | 手动 `setData`；每个组件独立的 Shadow 树 | 微信 WebView（基础库 3.8.12+）/ Skyline |

以上版本于 2026 年 11 月对照 npm/GitHub release 核验。平台列表和内部实现
来自厂商文档，这里没有实测。取舍是刻意的：Taro 和 uni-app 优化的是框架
覆盖率、多端能力和生态兼容性，因此运行时层是实际选择；Glaze 优化的是一个
很窄、可以在构建期决定组件树的目标。如果 Glaze 之后需要任意动态组件树或
第三方 React/Vue 组件库，它需要显式的运行时 fallback，而不是假装编译器能
覆盖一切。

## 包

| 包 | 作用 |
| --- | --- |
| `@glaze/compiler` | Solid JSX 到 WXML + binding runtime |
| `@glaze/build` | `glaze build`：项目、页面和分包输出 |
| `@glaze/shared` | 少量共享辅助函数（字符串/路径命名） |
| `@glaze/runtime` | 每个实例的 Solid root 与 binding 桥 |
| `@glaze/vite-plugin` | Vite 构建桥接 |
| `examples/solid-todo` | counter、todo、async/context/Tailwind 探针和 benchmark |

## 文档

- [架构](docs/architecture.md)
- [源码布局](docs/source-layout.md)
- [编译器](docs/compiler.md)
- [运行时边界行为](docs/runtime.md)
- [实现计划](docs/plan.md)
- [构建](docs/build.md)
- [单文件 snippet](docs/snippet.md)
- [Tailwind CSS](docs/tailwind.md)
- [minidev 之下的测试](docs/glass-easel-testing.md)
- [使用 minidev 运行](docs/minidev.md)
- [性能待办](docs/optimizations.md)
- [为什么 external component 不可行](docs/findings-external-component.md)
- [面向 Agent 的 Glaze 写法 skill](skills/glaze-solid-miniprogram/SKILL.md)

## License

MIT
