# ATOM App v1

系统入口、图标、主题、480×360单屏、必要局部滚动和空格/Home返回仍遵循AGENTS.md。系统会在应用脚本之前注入`AtomApp`，开发者不要自行复制、覆盖SDK，也不要用localStorage假设沙箱同源。

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

方向键移动焦点，Enter 短按确认、长按语音、松开结束。文本框聚焦时长按直接语音输入，不自动提交。
使用语义化按钮与输入框，不要全局拦截 Enter 和方向键。Canvas 核心操作应提供 DOM 按钮。
系统提供左上角返回控件，预留 48×48 空间。多级应用通过 `AtomApp.navigation.setBackHandler(fn)` 逐层返回，根页面调用 `AtomApp.home()`。
完整接入说明与阶段边界见 [五向摇杆导航](five-way-navigation.md)。
