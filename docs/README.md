# 项目文档

徽章和重载入口使用插件详情页公开的 `plugins.detail.badge` 和 `plugins.detail.actions` 槽。
重装经过现有插件管理权限检查，进度弹窗放在 `shell.overlay` 中，因此目标插件从面板移除时，弹窗仍能显示结果。
来源和启用状态以 Host 返回的已安装清单为准。

在项目根运行 `npm run build` 和 `npm run check`。
界面验证时，打开一个本地链接的插件和一个官方插件的详情，检查徽章和重载入口。
使用一次性 profile 确认卸载、重装、启用状态恢复，以及扩展停用后入口消失。

开发约定见 [AGENTS.md](../AGENTS.md) 与 [AGENTS.local.md](../AGENTS.local.md)。
