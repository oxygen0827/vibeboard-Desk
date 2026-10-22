# ATOM 应用设计约定

界面应像一个具体的小工具，而不是通用 AI 展示页。统一外壳与基础控件，让内容和交互表达创意。避免无用途的营销标题、装饰性状态徽章、统计卡片、渐变和阴影。

## 基础样式

暖白 `#f3f0e8` 为底，墨黑 `#242622` 为正文，朱红 `#df5038` 为图形强调，深朱红 `#b53c28` 为主按钮背景，深灰 `#62665d` 为辅助文字，灰 `#787a70` 仅用于非文字装饰，线 `#d5d3c8` 为分隔。间距以 8px 为单位。按钮圆角 6px，面板默认直角，可按用途在 0–8px 范围调整。正文 16px，辅助标签 12px；中文用系统无衬线字体，数字用等宽字体。不要使用外网字体。

`static/atom-ui.css` 提供 `.atom-app`、`.atom-button`、`.atom-button-primary`、`.atom-row`、`.atom-panel`、`.atom-label`、`.atom-number`、`.atom-message`。`static/atom-ui.js` 提供 `window.AtomUI.escape(text)`、`button(text, options)`、`label(text)`、`row(componentHTMLArray)`。button options 支持 id、primary、disabled。row 接受可信组件 HTML；用户文本必须先 escape。

tokens 的机器可读源为 `design-system/tokens.json`。修改 token 后需同步 CSS 和模板的内嵌版本，避免样式漂移。

## 可安装模板

- `templates/tool.json`：饮水计数，支持增加与撤销，使用AtomApp保存并在重开时恢复。
- `templates/info.json`：今日计划示例，可点击完成，明确内容是样例且未连接日历。
- `templates/playful.json`：点阵角色，可切换三种状态。
- `templates/music.json`：固定的音乐主页面、可返回的歌曲列表子页，列表局部滚动；所有曲目为示例，没有音源，不假装播放。

模板内嵌同版 CSS 和 JS，并附紧凑布局覆盖。应用全屏480×360，不显示系统header/nav；模板16px内边距，按钮至少48px高，主要操作一屏可见。根html/body固定viewport并overflow:hidden，.atom-app高度100vh。长列表仅在.atom-scroll或data-atom-scroll区域内滚动，使用flex:1、min-height:0和overscroll-behavior:contain。无外网、localStorage或设备权限依赖；保存数据使用系统注入的AtomApp v1接口，可在 sandbox iframe 中离线运行。修改 manifest.id 后即可作为自己的应用，安装方法见 developer-guide.md。

一致性约束针对按钮、文字层级、间距和操作反馈；角色、绘画、游戏画面允许自由配色和布局。不要让约定把所有应用变成相同的卡片。按应用用途保留一个明显主操作，并使用真实数据或清楚标记样例。

## 给 coding agent 的生成提示

> 为 ATOM 全屏480×360的桌面设备生成一个可安装 Web bundle JSON。先读取 atom/templates 中最接近的模板，保留自包含 CSS/JS 与 manifest/files 结构。使用当前主题的语义token；暖白、墨黑、朱红只是默认主题参考，8px 间距、16px 正文、12px标签、至少48px高的按钮。应用功能是：[填写一个具体用途]。避免营销文案、渐变、阴影和无用途的卡片。manifest.layout必须为fullscreen，根页面固定viewport禁止滚动，主操作一屏可见，长列表仅在显式局部滚动容器中；所有操作必须有真实行为及状态反馈；静态样例明确标注。应用在 allow-scripts sandbox 内离线运行，不依赖 localStorage、外网字体、未声明的父页面接口或系统命令。需要保存的数据使用AtomApp.load/await AtomApp.save，保存失败有明确反馈；退出释放音频和动画，不承诺应用在退出后后台运行。输出 JSON 文件，说明测试步骤与实际能力边界。

## 验收

1. 480×360 全屏应用区域下主要操作可见，文本不被截断；必要滚动有明确内容。
2. 按钮至少48px高，键盘焦点可见，禁用状态与行为一致。
3. 数字变化、切换、撤销等交互真的工作，重复点击不破坏状态。
4. 不显示虚构的实时天气、联网状态、用户任务或持久保存成功。
5. 断网能运行；sandbox 内没有存储异常，只有声明的AtomApp接口。
6. manifest.layout 为 fullscreen；应用无系统header/nav，子页按需提供返回。系统退出由设备外壳处理。
7. 有动画时尊重 prefers-reduced-motion，避免持续高频计时与 GPU 依赖。
8. 通过开发模式安装与更新验证，而不是只看生成的截图。

## 生命周期与数据

新应用遵循 [AtomApp v1](app-contract.md)：异步初始化显式就绪，数据有独立64KiB JSON槽，预览为临时数据。保存成功后才能显示已保存。操作页面表情由真实工作坊状态驱动，不覆盖应用。固定配色仅用于内容场景；界面与图标遵循当前主题。

## 菜单导航栏

系统菜单与子页面采用左上角「左箭头 + 上一级名称」、顶部居中的当前页面标题，沿用当前标题字号。标题按屏幕中线定位，不随左右按钮宽度偏移；右侧仅保留真实操作。返回必须指向实际父层级，根页面返回桌面。五向焦点框继续适用于返回按钮。
