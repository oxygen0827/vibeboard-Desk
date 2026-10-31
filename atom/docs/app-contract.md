# ATOM App v1

系统入口、图标、主题、480×360单屏、必要局部滚动及五向输入仍遵循 AGENTS.md 与 [输入规范](input-standard.md)；Space 短按确认、长按语音，Home 返回桌面。系统会在应用脚本之前注入`AtomApp`，开发者不要自行复制、覆盖SDK，也不要用localStorage假设沙箱同源。

## 初始化与启动

同步应用在window.load后首次绘制时自动就绪。异步初始化在最开始调用`AtomApp.deferReady()`，完成可操作画面后调用`AtomApp.ready()`。启动8秒未就绪时系统提供继续等待、重开与返回；未捕获错误有重开入口。系统不会自动循环重启应用。

## 本机数据

```js
AtomApp.deferReady();
let state = await AtomApp.load({ count: 0 });
render(state);
AtomApp.ready();
async function increment() {
  const next = { count: state.count + 1 };
  const result = await AtomApp.save(next);
  state = next;
  render(state); // 保存成功后才声称已保存
  // result.mode === 'preview': 临时预览；'device': 设备持久保存
}
```

每个已安装应用只能访问自己的一个JSON槽，UTF-8数据最多64KiB；更新应用不改槽，其他应用和旧iframe不能读写。数据在当前设备浏览器配置中保存，不是云同步或远程备份。预览使用临时槽，安装不会把预览测试数据自动带入正式应用。保存和读取失败必须显示可理解的状态，不要假装成功；初始化期间阻止冲突写入。

## 退出与资源

`AtomApp.onSuspend(fn)`注册退出清理，停止音频、计时器与GPU循环，回调应可以安全重复。退出时系统发送suspend并拆除iframe。必要时监听document.visibilitychange暂停隐藏期间的工作，回到可见状态再恢复。设备Home短按回到第一页，长按进入语音需求；应用不抢占这个按键。文本输入保留空格。

## 主题与反馈

使用bg/ink/accent/action/muted/line/card或对应atom别名；图标为透明currentColor字形，主题提供外观。正文优先16px，主要点击目标至少44px，一屏一个主要任务。状态用真实数据驱动，不能以表情或虚假进度替代录音、网络或模型检查结果。动画应尊重prefers-reduced-motion。

### 相册能力

声明 `capabilities: ["photos"]` 后，通过 `atom:photos` / `atom:photos-result` 消息使用账号私有相册，消息包括 `id`、`action`、`data`。系统按安装实例、账号、能力显式授权并校验当前 iframe；预览不获得权限。设备支持 state、list、get、update、delete、generate、jobs、job；`generate` 必须有幂等 request_id，删除必须带当前 revision 和 confirm。图片不保存在 AtomApp 的 64 KiB 状态中。照片由服务器保存与处理，不能宣称端到端加密；发起改图前必须告知用户参考照片会发送给模型服务。电脑导入、原图导出通过受保护的本机后台完成，app 不持有账号或模型凭据。

## 验证

结构检查tools/check_app.py；生命周期和保存协议tests/app-host.test.cjs。真机需检查初始化、空/失败状态、保存重开、单屏尺寸、局部列表滚动、Home/长按、主题和资源退出。静态检查不能保证审美或所有运行行为。

## 五向摇杆导航

方向键移动焦点，Space 短按确认、长按语音、松开结束。文本框聚焦时长按直接语音输入，不自动提交。
使用语义化按钮与输入框，不要全局拦截 Space 和方向键。Canvas 核心操作应提供 DOM 按钮。
系统提供左上角返回控件，预留 48×48 空间。多级应用通过 `AtomApp.navigation.setBackHandler(fn)` 逐层返回，根页面调用 `AtomApp.home()`。
完整接入说明与阶段边界见 [五向摇杆导航](five-way-navigation.md)。

新生成、安装/更新、发布应用必须遵守 [五向输入强制规范 v1](input-standard.md)，声明 `manifest.input` 并通过共享准入校验。声明不等同于实际操作验收。

## 同步应用启动与身份状态（必须）

账号未查询时是 checking，不是 signed-out。启动先显示应用内“正在连接／同步”及加载反馈；收到明确未登录结果或认证失效（401）才显示登录。网络超时、服务错误、权限拒绝不得误作退出登录，应显示重试并保留已有内容。后台刷新不重建编辑中的表单，不清空草稿；跨账号缓存须隔离。首次等待不得泄露上个账号的缓存。此规则适用于设备、Mac、工作坊生成和市场移植的同步应用。测试须人为延迟账号响应，覆盖已登录、未登录、离线三种分支，确认登录表单不闪现。

返回控件必须融入应用标题栏或场景工具栏，标注 data-atom-back。场景 header 即便 pointer-events:none，返回按钮也必须 pointer-events:auto，鼠标与五向输入均须实测；编辑/详情先返回上层，根页面才回桌面。

## 可选感知输入

应用声明 `capabilities: ["sensors"]` 后可使用 `AtomApp.sensors.subscribe(callback)`。系统仅向已授权的前台安装应用提供只读快照；预览不授予硬件访问。未连接、采样过期均为未知，不能当作无人。退出取消订阅，保留鼠标与五向完整玩法。字段、单位、适配器和测试要求见 [传感器契约](sensors.md)。传感器型号尚未选定，模拟通过不代表真机接入完成。
