# ATOM 应用开发与部署

目前提供自包含 Web 应用安装、更新、卸载与设备预览。应用可由设备工作坊调用配置的模型生成，也可由自己的电脑和 agent 开发后部署；源码应用市场已有可部署实现，见 [Studio 交付说明](studio-delivery.md)。部署应用不需要修改内核、驱动或桌面。

## 连接

让电脑上的 coding agent 使用你已有的 SSH 配置连接设备。使用 SSH 密钥，不要把密码、私钥或 FRP token 放入应用包。服务只监听设备 loopback，不应暴露到公网。

在电脑终端建立隧道，并保持该进程运行：

```sh
ssh -N -L 127.0.0.1:8770:127.0.0.1:8770 YOUR_ATOM_SSH_HOST
```

`YOUR_ATOM_SSH_HOST` 替换为 SSH 配置中的设备别名；也可使用 `-p PORT USER@HOST`。本地端口必须为 8770，使请求 Host / Origin 和设备服务同源校验一致。若端口被占用，先查明并停止自己的旧隧道，不要改用其他端口。

## 安装与管理

ATOM 0.2 安装和更新前，先在设置中手动开启开发模式。CLI 不会自动开启；关闭时安装和更新会明确报错。查看列表和卸载不要求开发模式。开发期间可通过 SSH 在设备运行命令，或在电脑通过隧道运行：

```sh
python3 atom/tools/deploy_app.py list
python3 atom/tools/deploy_app.py install atom/examples/breathe.json
python3 atom/tools/deploy_app.py install atom/examples/idea-card.json
python3 atom/tools/deploy_app.py update atom/examples/breathe.json
python3 atom/tools/deploy_app.py uninstall breathe
```

首次使用 install；同一 ID 已存在时用 update。卸载会删除该应用。内置应用不能卸载。刷新主页应用列表后进入应用，使用主界面返回控件退出。

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
    "entry": "index.html"
  },
  "files": {
    "index.html": "<!doctype html><html><h1>Hello ATOM</h1></html>"
  }
}
```

ID 使用小写英文、数字和连字符，勿与内置应用重复。入口固定 index.html；文件内容为 UTF-8 字符串，路径不得绝对、穿越目录或覆盖 manifest.json。最多 100 个文件，请保持整个 JSON 包小于 1 MiB。

目标应用全屏480×360，无系统header/nav；根页面禁止滚动，列表只能在明确的.atom-scroll或data-atom-scroll容器中滚动；推荐按钮至少 48px、少量文本、简单 CSS/DOM 动画。示例完全自包含，不依赖外部网络、localStorage 或 WebGL。应用在 sandbox iframe 中运行，不应假定可调用父页面、直接访问设备 API 或持续后台运行。需要持久化、音频、硬件能力时，应先扩展受控的应用接口。

## 工作流程

让自己的 agent 生成 bundle → 在电脑预览布局 → 通过 SSH 隧道安装 → 在真实设备检查显示、按钮与返回 → 修改后 update。确认断网时静态界面仍可使用，应用异常不阻碍回到主页。

目前这不是任意 Linux 软件安装器，也没有为应用提供系统命令权限。服务器返回的校验错误应修正应用包；不要绕过同源校验或自动开启开发模式。

### 临时实体 Home 键映射

主页鼠标滚轮向下/右翻下一页、向上/左翻上一页，应用内部滚动不受影响。空格短按返回桌面，持续650ms打开工作坊并启动录音；松开长按不会再次返回。输入框和可编辑内容中的空格保留输入功能。当前转写需配置STT，独立语音聊天尚未接入。安装应用和预览通过共享home-key.js中继，未来实体按键可替换输入来源，沿用atom:return-home / atom:voice-wake事件。
