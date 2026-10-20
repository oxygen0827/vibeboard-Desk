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
