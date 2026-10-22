# 五向摇杆输入：第一阶段实现

## 硬件和操作协议

唯一输入硬件为五向摇杆。Linux 应提供四个方向键和 Space 的按下、松开事件。
USB HID 可直接映射；GPIO 接线确定后再配置对应输入驱动。本阶段用键盘模拟，没有变更真机系统输入配置。

- 方向：按空间位置移动焦点，列表只在自身区域内滚动。
- Space 短按：松手时激活控件。滑块、选择器短按进入调整，方向调整，再短按退出。
- Space 长按 650 ms：非密码可编辑字段进入语音输入；其他位置调用现有语音助手。
- 松开结束录音；已经触发长按的操作不会再次触发短按。
- 返回：左上角可聚焦的返回按钮。应用顶层返回原桌面页，长按不执行返回。
- Home 保留既有兼容返回行为；Space 为摇杆中心键。中文输入法 composition 期间不拦截按键。

## 实现位置

- `static/input-navigation.js`：独立运行于系统页面和每个 opaque sandbox 应用，管理空间导航、模态范围、焦点身份、调整模式和文本选区。
- `static/app.js`：桌面边界翻页、设置/工作坊返回层级、可信录音代理和临时状态浮层。
- `static/app-runtime.js`：提供 `AtomApp.navigation.setBackHandler(fn)` 与 `back()`。
- `server.py`：为安装应用注入导航运行时；预览通过同样的运行时接入。
- `workshop.py`：生成规范要求语义控件、画布操作按钮、返回回调与左上角 48×48 安全区域。

录音复用 `/api/voice/start` (`quiet_fan:true`)、`stop`、`transcribe`。不向应用下发模型凭据。
输入代理只接受当前 iframe 的请求；以请求编号关联结果。录音启动前松手会排队停止，导航离开会取消转写写入。
文本插入保留选区外内容并触发 `input`，不会自动提交。字段已变化或消失时显示转写恢复框，避免覆盖用户新内容。
密码字段不启用语音文本写入。

## 应用接入

使用原生 button/input/textarea/select，或提供 `tabindex="0"` 与明确语义。
自定义可点击容器必须支持 `.click()`；推荐直接使用 button。
隐藏/禁用控件不得作为导航目标；弹窗使用 `role="dialog" aria-modal="true"`。
可选 `data-atom-default` 指定默认控件，稳定 id 或 `data-atom-focus` 用于重绘后恢复焦点。
保留左上角 48×48 区域给统一返回按钮；按钮不是常驻系统栏。

```js
AtomApp.navigation.setBackHandler(() => {
  if (detailOpen) {
    detailOpen = false;
    render();
  } else {
    AtomApp.home();
  }
});
```

Canvas、WebGL、游戏和第三方应用不会自动获得内部语义导航，必须逐个补充 DOM 控件及页面返回回调。
当前自动返回后备行为是回桌面，不能推断第三方应用的内部历史。

## 验证和边界

```sh
node atom/tests/input-navigation.integration.cjs
node atom/tests/joystick-shell.integration.cjs
node atom/tests/app-runtime.test.cjs
node atom/tests/app-host.test.cjs
node atom/tests/app-host-async.test.cjs
python3 -m unittest discover -s atom/tests -p test_server.py -q
```

浏览器集成测试运行真实 DOM、键盘和 opaque iframe，音频 API 为明确的模拟响应。
覆盖空间移动、模态范围、重绘恢复、短长按互斥、文本选区、过期结果、转写恢复、慢速录音启动、跨 iframe 输入与返回原桌面页。
尚未验证真实摇杆抖动、真机录音/风扇和全部第三方应用；不应据此宣称全应用适配完成。

## 强制准入

本实现的应用声明及发布规则以 [五向输入强制规范 v1](input-standard.md) 为准。共享校验位于 `atom/app_input.py`，缺少声明的新安装/更新和新发布版本会被拒绝；历史种子兼容不代表完整适配。
