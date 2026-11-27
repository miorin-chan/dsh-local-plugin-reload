# 本地插件重载

[English](README.md)

在 **插件 → 本地** 页签集中管理本地安装的插件，停用可卸载插件后可直接点击红色删除图标卸载；
打开详情页展开底部 **本地重载**（或点击标题旁的 **本地** 徽章），可编辑绝对路径、
`link:` 或 `file:` 来源并执行 **破坏性重载**。

请在操作完成前保持窗口打开；本地压缩包仅检查文件是否存在，重装要求其版本与当前安装版本一致。

需要 DeepSeek Harness `0.2.2-rc.5` 或更新版本。可在 **插件模块化改良计划** 中直接开启 **本地插件重载**，
或在源码目录运行 `pnpm install` 后从 **插件 → 添加插件** 选择本目录。

## 实拍截图

![本地链接的演示插件的破坏性重载确认框](docs/assets/screenshots/main-light.png)

[深色模式主图](docs/assets/screenshots/main-dark.png) · 「本地」页签 ([浅色](docs/assets/screenshots/entry-light.png)
/ [深色](docs/assets/screenshots/entry-dark.png))

[项目文档](docs/README.md)
