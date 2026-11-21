# Local plugin reload

[简体中文](README.zh.md)

Open **Plugins → Local** to browse locally installed bundles.
Each card and detail page title shows a **Local** badge.
On the detail page of a removable bundle, use the pencil icon to edit the source.
Choose **Destructive reload** and confirm to check the source, uninstall the bundle,
and reinstall from the selected path with the same enablement.
Enter an absolute local path, optionally with a `link:` or `file:` prefix.

Keep the window open until the operation finishes.
If reinstalling fails after removal, retry the installation or restore from the original source.
Local archives must still contain the installed version because the source check only verifies that the archive exists.

Requires DeepSeek Harness 0.2.2-rc.5 or newer.
Install this directory through **Plugins** > **Add plugin**.

[Project documentation](docs/README.md)
