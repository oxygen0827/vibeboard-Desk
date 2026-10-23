# ATOM 应用开发与部署

目前提供自包含 Web 应用安装、更新、卸载与设备预览。应用可由设备工作坊调用配置的模型生成，也可由自己的电脑和 agent 开发后部署；源码应用市场已有可部署实现，见 [市场服务说明](../connect/marketplace/README.md)。部署应用不需要修改内核、驱动或桌面。

## 连接

让电脑上的 coding agent 使用你已有的 SSH 配置连接设备。使用 SSH 密钥，不要把密码、私钥或 FRP token 放入应用包。服务只监听设备 loopback，不应暴露到公网。

在电脑终端建立隧道，并保持该进程运行：

```sh
ssh -N -L 127.0.0.1:8770:127.0.0.1:8770 YOUR_ATOM_SSH_HOST
```

`YOUR_ATOM_SSH_HOST` 替换为 SSH 配置中的设备别名；也可使用 `-p PORT USER@HOST`。本地端口必须为 8770，使请求 Host / Origin 和设备服务同源校验一致。若端口被占用，先查明并停止自己的旧隧道，不要改用其他端口。

## 安装与管理

安装和更新前，先在设置中手动开启开发模式。CLI 不会自动开启；关闭时安装和更新会明确报错。查看列表和卸载不要求开发模式。开发期间可通过 SSH 在设备运行命令，或在电脑通过隧道运行：

```sh
python3 atom/tools/deploy_app.py list
python3 atom/tools/deploy_app.py install atom/examples/breathe.json
python3 atom/tools/deploy_app.py install atom/examples/idea-card.json
python3 atom/tools/deploy_app.py update atom/examples/breathe.json
python3 atom/tools/deploy_app.py uninstall breathe
```

首次使用 install；同一 ID 已存在时用 update。卸载会删除该应用。内置应用不能卸载。刷新主页应用列表后进入应用，使用左上角返回箭头或 Home 退出。

设备本地也可直接调用 API：

```sh
curl -fsS http://127.0.0.1:8770/api/apps
curl -fsS -H 'Origin: http://127.0.0.1:8770' \
  -H 'Content-Type: application/json' \
  --data-binary @breathe.json http://127.0.0.1:8770/api/apps/install
```

## Bundle 格式

```json
{
  "manifest": {
    "id": "my-app",
    "name": "我的应用",
    "description": "应用说明",
    "entry": "index.html",
    "icon": "icon.svg",
    "input": {"version": 1, "profile": "five-way", "back": "root"}
  },
  "files": {
    "index.html": "<!doctype html><html lang=\"zh-CN\"><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>我的应用</title><style>html,body{margin:0;height:100%;overflow:hidden}main{padding:56px 24px 24px}button{min-height:48px}</style><main><button onclick=\"this.textContent='完成'\">开始</button></main></html>",
    "icon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><path d=\"m20 14 28 18-28 18Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"/></svg>"
  }
}
```

这是最小按钮示例；实际图标须与应用功能匹配，不能把示例当所有应用的共享图标。新应用必须满足 [五向输入强制规范](input-standard.md)，嵌套页面注册返回回调，画布应用明确声明场景并提供语义控件。参考 [运行协议](app-contract.md) 使用 `AtomApp.load/save` 保存，不能假定 opaque iframe 的 localStorage 可用。

ID 使用小写英文、数字和连字符，勿与内置应用重复。入口固定 index.html；文件内容为 UTF-8 字符串，路径不得绝对、穿越目录或覆盖 manifest.json。最多 100 个文件，请保持整个 JSON 包小于 1 MiB。

目标应用全屏480×360，无系统header/nav；根页面禁止滚动，列表只能在明确的.atom-scroll或data-atom-scroll容器中滚动；推荐按钮至少 48px、少量文本、简单 CSS/DOM 动画。示例完全自包含，不依赖外部网络、localStorage 或 WebGL。应用在 sandbox iframe 中运行，不应假定可调用父页面、直接访问设备 API 或持续后台运行。需要持久化、音频、硬件能力时，应先扩展受控的应用接口。

## 工作流程

让自己的 agent 生成 bundle → 在电脑预览布局 → 通过 SSH 隧道安装 → 在真实设备检查显示、按钮与返回 → 修改后 update。确认断网时静态界面仍可使用，应用异常不阻碍回到主页。

目前这不是任意 Linux 软件安装器，也没有为应用提供系统命令权限。服务器返回的校验错误应修正应用包；不要绕过同源校验或自动开启开发模式。

## 五向输入与发布检查

方向移动焦点，Space 短按确认、长按约 650 ms 唤醒语音/非密码字段听写，松手结束录音。返回由左上角箭头逐层处理，Home 回原桌面页；桌面 Home 回第一页。应用不得全局抢占 Space/方向键，不实现与共享运行时竞争的选框。

```sh
python3 atom/tools/check_app.py path/to/bundle.json
python3 atom/tools/prepare_icon_bundles.py
```

静态校验后必须实测方向移动、确认、返回、语音取消及后台释放。完整移植须携带图片、字体、模型、WASM 与许可证，不能仅部署入口 JSON。新安装追加末尾，更新保留图标、安装时间和位置。完整资源库发布见 [同步指南](full-library-sync-2026-10-23.md)。

应用市场封面使用真实首页截图，在 **ATOM Connect → 我的创作 → 首页截图** 上传；当前发布对话框要求封面。公开发布是明确操作，不把私人草稿自动上传。
