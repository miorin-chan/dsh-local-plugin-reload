# 项目文档

`plugins.tab` 提供本地插件卡片，卡片用 `openPackage` 打开原生详情页。
`plugins.detail.badge` 放置详情徽章，并在标题下方以独立整行显示来源编辑和重载。
重装经过现有插件管理权限检查，进度弹窗放在 `shell.overlay` 中，因此目标插件从面板移除时，弹窗仍能显示结果。
来源和启用状态以 Host 返回的已安装清单为准，启停和卸载交给官方插件管理服务。
本地卡片可直接卸载插件。确认后重新核对目标，调用 `pluginManager/removeBundle` 并刷新清单，不切换页签。
构建时直接打包同版本官方 `Switch`、`Tag`、`Button`、`Input`、默认插件图标及其样式。
当前 `plugins.tab` 由扩展渲染卡片内容，官方卡片组件和卡片启停控制器没有通过该接口公开。

新检出后在项目根运行 `npm ci`，安装依赖并构建插件。
改动源码后用 `npm run build` 更新产物，再运行 `npm run check`。
界面验证时，打开一个本地链接的插件和一个官方插件的详情，检查徽章和重载入口。
使用一次性 profile 确认卡片卸载后仍停留在「本地」，同时检查重装、启用状态恢复，以及扩展停用后入口消失。

开发约定见 [AGENTS.md](../AGENTS.md) 与 [AGENTS.local.md](../AGENTS.local.md)。
