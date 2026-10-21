# ATOM 新系统外观 · 2026-10-19

根据用户要求删除旧的 paper / terminal / sunshine / blueprint 与当时已安装的自定义主题。ThemeStore 将旧状态迁移为 appearance_generation=2，迁移后不会重新出现旧主题；此后新导入的主题仍可正常保存。唯一内置外观 system 是运行基础，不保留旧主题兼容入口；已安装应用引用旧固定主题时回退当前系统外观。

本版借鉴 Apple HIG 的层级、留白、分组控件和一致反馈，使用原创 CSS 和原有语义 SVG，未复制 Apple UI Kit 素材或字体。480×360 全屏，统一浅灰背景、白色分组、蓝色主操作、13px控件圆角、16px面板圆角。桌面使用柔和渐变背景、74px图标底板与13px标签；应用和生成内容保持必要区域滚动、Home回原页、按住说话/松手转写。

语音页面使用独立环境光形态与状态指示，装饰条不表示实测音量；只有实际录音链路就绪后显示“我在听”。模拟器/物理GPU画布保留内容色彩，移植控件通过原有theme-controls.css跟随系统。本轮不是重写全部上游应用的内部界面。

代码：static/system-appearance.css、themes.py、design-system/tokens.json、atom-ui.css、模板及workshop.py生成提示。

官方参考：
- https://developer.apple.com/design/human-interface-guidelines/
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://developer.apple.com/design/human-interface-guidelines/typography
- https://developer.apple.com/design/human-interface-guidelines/buttons
- https://developer.apple.com/design/human-interface-guidelines/materials

真机验证截图：artifacts/system-home.png、system-settings.png、system-workshop.png、system-voice.png。页面布局与错误记录：artifacts/system-appearance-verification.json。

## 桌面全页一致性与切换修正

所有应用入口通过系统外观的语义配色分组获得一致的图标底板与前景色，匹配应用用途，未知应用用稳定ID分配配色；不修改或烘焙SVG颜色。移除只针对第一页的图标样式。桌面分页尺寸、间距与字体一致。

修正返回时 navigate 先绘制、loadApps 无条件再次绘制的问题：仅应用清单真正变化时更新DOM；移除每次重建都从透明开始的grid动画；当前页重复翻页不重绘。应用加载层等待ready消息后的两个动画帧，再150ms淡出，避免直接消失造成硬切。不同应用自身的初始化/渲染耗时仍由它们自己的引擎决定。

## 应用内部统一

新增static/app-appearance.css用于普通应用的排版、分组面板、按钮与表单；server在原应用HTML末尾注入，使已安装作品不用重装即可采用系统控件。theme_ui=controls应用使用单独的theme-controls.css，只调整控制区，不改Canvas/WebGL/点阵数据。原生时钟、计时器、便签另有专门排版。SDK共享CSS、四个模板、工作坊生成规则与预览同步更新。

真机逐个检查当前54个入口，均完成加载，无脚本错误、无根页面滚动。应用管理列表中未显示的卸载按钮属于必要局部滚动区，不算页面溢出；其他应用未发现可见按钮越出视口。此检查覆盖打开、布局和加载，不代表逐一验收全部上游应用的每个业务功能。48项Python测试通过。截图在artifacts/interiors，检查清单在artifacts/app-interiors-verification.json。


## 白天 / 暗黑 · 2026-10-21

现在使用同一套设计系统的两种外观：`system`（白天）与 `system-dark`（暗黑）。不恢复已删除的旧主题。小电脑在「设置 → 桌面与常驻」直接点击白天或暗黑，写入设备 `themes.json`；刷新和重启后保留。切换不改变桌面排序、字号、分页或返回来源页行为。首屏使用已验证外观的本地缓存，再以设备 API 状态为准。

暗色桌面采用静态调色盘色场：蓝色、紫色、青绿色光晕从四周融入深色中央，配合深灰图标底板和柔和彩色图形。背景仅使用固定 CSS 渐变，没有模糊滤镜、动画循环或额外 Canvas/GPU 绘制；明亮色场只出现在桌面，应用内继续使用安静的暗底。应用外观通过现有七个语义 token 注入；原生输入控件同步设置 `color-scheme`。相册照片、Canvas/WebGL 场景与内容颜色不做整体反相。明确选择固定主题的应用继续保留自己的选择。

电脑端 ATOM Connect 在侧栏「设置 → 外观」切换白天 / 暗黑，原生 App 使用 macOS UserDefaults 的 `ATOMAppearance` 保存，浏览器使用本机存储 `atom.connect.appearance.v1`；初次未选择时跟随电脑系统。原生窗口和标题栏同步切换，保存收到原生确认后才提示成功。两端各自记住自己的偏好，尚未提供跨设备同步外观。电脑端相册及 Studio 预览使用仅包含 `light` / `dark` 的父窗口消息继承外观，接收端验证消息来自 parent；不通过主题消息传递账号或设备权限。源代码预览原有 sandbox、网络禁用及临时存储边界不变。

验证：`PYTHONPATH=atom python3 -m unittest atom.tests.test_themes`，`node atom/tests/appearance.test.cjs`，以及 `node --test atom/connect/computer/test/studio.test.mjs`。截图见 `artifacts/appearance/`。

2026-10-21 补充：实际 macOS 包已重新编译并替换，启动后的真实电脑后端与浏览器界面通过暗色持久化及相册继承测试；原生 UserDefaults 确认消息使用浏览器桥 fixture 验证，原生窗口内点击与跨重启偏好尚未通过系统 UI 自动化实测。设备端白天 / 暗黑切换和暗色调色盘已有真机截图，设备随后由用户关闭。
