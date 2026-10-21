# ATOM 产品网站与使用指南

独立[应用目录](https://ldcx.tech/atom/apps/)收录 35 个现有应用与工具，并读取云端市场的新公开作品。支持分类、搜索、获取方式筛选、界面详情及公开源码包下载。大型移植必须部署完整资源，官网不代替客户端确认安装。

目录源文件为 `apps/template.html`、`build_apps.py`、`assets/apps.js`、`assets/apps.css`。构建读取受控源码的 manifest、独立图标和验收截图，生成静态 HTML 与公开元数据；不读取账号、设备状态或私有配置。发布脚本自动重建。10 个官方市场作品、18 个保留应用、4 个客户端及工作坊 / 时钟 / 计时器共 35 项；云端其他公开作品动态追加。已退役作品不展示。

页面仅匿名读取公开市场接口；源码下载只导出 bundle JSON，不执行源码、不安装应用、不发送账号 cookie 或 token。远程说明和作者使用纯文本呈现。市场离线时保留收录目录并提供重试；无 JavaScript 时仍可浏览全部静态卡片。未收录独立源码包的样机定制作品如实说明。

运行 `python3 atom/site/build_apps.py` 与 `node atom/site/apps.test.cjs` 构建和验证目录。测试覆盖四种宽度、分类/搜索/空态、加载更多、详情及焦点恢复、URL 深链接、源码下载、云端失败重试、元数据注入、无 JS 回退及图片图标资源。nginx 为 `/atom/apps/` 增加精确静态路由，保留现有 API。

公网入口：[产品首页](https://ldcx.tech/atom/) · [使用指南](https://ldcx.tech/atom/guide/)。无构建依赖，原生 HTML / CSS / JavaScript，部署在现有 nginx 静态目录；不依赖第三方字体、统计脚本或外部图片服务。

## 产品定位与内容取舍

**ATOM 是一台独立运行、可以用 AI 创造和改造应用的个人小电脑。** 创作循环是产品核心：描述需求 → 预览安装 → 拿到源码继续改 → 发布新版本。电脑伴侣提供更强的开发能力；ATOM 本地应用可以独立运行。

首页按首次访客的理解顺序组织：

1. 40 秒产品概念短片，先理解形态和创作理念。
2. 12 个精选作品自动轮播：语言炼金、共生世界、合奏伙伴、光影水池、体积流场、月光海洋、天体观测台、口袋音乐工作站、物理实验台、机器人眼睛、电路实验室、数学游乐场。覆盖 AI 创作、GPU 模拟、声音、科学与表情；每个开源项目单独标明来源。
3. 工作坊与源码市场，说明从想法到作品、从原作到新版本的过程。
4. Agent 小屋与电脑连接，说明真实任务状态和授权项目。
5. 独立运行、当前样机规格、常见问题和使用指南。

首页采用海报式构图：超大 ATOM 字标、短片中的产品插画、钴蓝与浅柠檬色，深色作品展区和纸张式创作流程。没有把日历、便签等所有功能平均堆成卡片，也不把研发计划、模型生成成功率或概念硬件当成交付承诺。指南承担配置、限制与排错细节。

### GitHub 设计资料

- [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)：先选择与产品有关的视觉方向，再审查版式与真实内容。
- [Impeccable](https://github.com/pbakaus/impeccable)：参考其产品事实、设计评审与浏览器验收方法。未安装或执行该项目的 CLI，也未引入它的运行依赖。

本轮也采用了本地 Sites 技能关于展示内容、图片真实性和响应式验收的方法。保留项目原有公开域名与自托管部署，不创建另一套托管站点。参考指导不等于复制示例网站的代码、图像或品牌。

## 文件与媒体来源

| 文件 | 用途与来源 |
| --- | --- |
| `index.html` | 产品介绍、视频章节、代表体验、创作流程与 FAQ |
| `guide/index.html` | 可搜索手册；与首页共用导航、字体和颜色 |
| `assets/site.css` / `art-direction.css` / `site.js` | 响应式样式、播放控制、键盘标签页、WebGL 预览、搜索 |
| `assets/atom-film-v3.mp4` | 用户提供的 `ATOM_v3_小应用(1).mp4`，40 秒、1920×1080、H.264/AAC；仅无损重新封装 faststart，没有裁剪、改画面或改音轨 |
| `assets/atom-film-poster.jpg` | 取自上述视频第 38 秒，1600×900 JPEG 封面 |
| `assets/language-alchemy.png` | 仓库语言炼金应用的 480×360 浏览器渲染截图，默认材质，无模型调用 |
| `assets/symbiotic-world.png` / `ai-duet.png` | 2026-10-21 样机应用验收截图 |
| `assets/agent-studio.png` | 合并版 Agent 小屋应用界面；任务来自 UI 验证数据，网页明确标记演示数据 |
| `assets/favicon.svg` | 网站品牌图形，非设备应用图标 |

短片属于**概念表达**；片中的颜色、加速度计、陀螺仪、光线传感器等不能视为当前样机标配。首页在视频旁说明，并提供文字内容说明。当前硬件与软件能力以项目 README 和指南为准。

### 播放与交互

- 案例区可见时每 **3 秒**切换一次，**600 ms** 横向淡入淡出；统一网格高度，不随文案跳动。名称导航自动居中跟随，支持手动左右、标签页方向键 / Home / End 与暂停。后台或离开案例区停止计时；交互材质开启、案例内容获得键盘焦点时暂停切换。系统偏好减少动态效果时默认暂停，主动开启后无过渡动画。
- 视频默认 `preload="none"`，不自动播放、不自动出声。访客点击后使用原生播放器，支持四个时间点跳转；JavaScript 不可用时仍保留原生控制。离开页面停止播放。
- MP4 由本站提供，nginx 支持 Range 请求；完整文件约 3.4 MiB。页面不会上传媒体或请求模型服务。
- 语言炼金的网页预览使用同一预设着色器，固定 640×480 渲染、最多约 30 fps；只在用户开启且可见时运行。支持鼠标、触摸和方向键。
- 切换体验、离开可视区或后台页面会暂停 GPU 动画；关闭预览恢复应用截图；页面退出释放资源。低动态偏好下停止时间动画，保留主动交互。
- WebGL 不可用时继续显示截图与明确说明。网页没有“假生成”输入框；实际 AI 创作在设备/电脑客户端完成。
- 本页不收集账号、配对码、邮箱或模型凭据；账号、配对、安装入口指向使用指南。没有购买表单或虚构的安装包下载。

## 本地预览与验收

```sh
python3 atom/site/preview.py --port 18944
# 打开 http://127.0.0.1:18944/atom/
node atom/site/test.cjs
```

测试单独启动 18943 端口，结束后清理。检查 1440、768、390、320 像素宽度；资源和锚点、真实 MP4 解码播放及章节跳转、不自动播放、键盘标签页、真实 WebGL 动画、方向键、低动态模式、无 WebGL 回退、FAQ、指南搜索和无 JavaScript 播放。截图保存在系统临时目录。

浏览器 QA 必须等待懒加载图片解码，再检查首屏、12 种体验、电脑连接段和移动端，不能把未加载图片的空框当作正常状态。`preview.py` 仅匹配 `/atom/` 静态路径，不转发生产 API；Python 预览服务器不提供生产 nginx 的 Range 行为，发布后另行验证。

## 部署与协作

```sh
sh atom/site/deploy/publish.sh
```

脚本使用项目既有服务器和 SSH 密钥，将首页、指南、应用目录与全部 assets 发布为新目录并切换 `static/atom` 链接。只设置精确首页/指南/应用目录路由及 `/atom/assets/`；保留 `/atom/v1/`、`/atom/market/v1/` 等既有 API 代理。**不能把整个 `/atom/` 改成静态 fallback。** 不修改数据库、模型密钥或设备配置。

首页、指南、应用目录及其公开元数据禁止长期缓存；CSS/JS 引用带版本参数，修改时同步相关页面。媒体改内容应使用新文件名，避免客户端缓存旧封面。历史静态发布目录保留，可将链接恢复到上一版。不要把本地绝对路径、原始验收日志或私有凭据打进公开 assets。

发布后必须验证：首页与指南 200；MP4 MIME 为 `video/mp4`，Range 请求返回 206；浏览器实际播放和材质交互正常；`/atom/market/v1/health` 保持正常。

## 第二轮视觉资产

`assets/atom-object-v2.png` 使用内置 imagegen 从用户短片封面提取产品概念插画；透明背景，保留造型与应用画面，非实物照片。最终提示词：

> Extract only the cream colored little desktop computer illustration from the left of the supplied ATOM video poster. Preserve the device silhouette, screen, six colored app icons and flat illustration style. Remove the blue background, ground shadow and typography. Center the complete device on an actual transparent background; no redesign or additional elements.

首页的艺术排版集中在 art-direction.css，不影响指南阅读。照片、产品外观概念及实际应用截图都有各自说明。

## 精选截图溯源

新增 `assets/showcase-*.png` 均原样复制现有运行截图，没有 AI 重绘或伪造界面。部分历史截图宽 508px，网页用 CSS 画框呈现左侧 480px 应用视口，隐藏右侧 28px 非应用区域；原始图片文件保留不改。来自不同验收阶段，网页标明界面随版本更新；性能数字只属于截图当时状态，不作为帧率承诺。

| 案例 | 原始文件（相对 atom/artifacts/） |
| --- | --- |
| 光影水池 | interiors/water-pool.png |
| 体积流场 | interiors/volume-flow.png |
| 月光海洋 | moon-ocean.png |
| 天体观测台 | ported-jupiter.png |
| 口袋音乐工作站 | interiors/pocket-studio.png |
| 物理实验台 | interiors/physics-playground.png |
| 机器人眼睛 | robo-face.png |
| 电路实验室 | circuit-lab.png |
| 数学游乐场 | interiors/math-playground.png |

筛选时也检查了模型、黏土、参数造物、材料世界等案例；本次选取操作特征明确、截图内容完整且覆盖不同用途的作品。未使用空白的材料世界截图或有图形异常的海洋截图。全部移植来源与许可见 `../ports/README.md` 及对应 `UPSTREAM.txt`。网页展示不改变这些作品的授权和完整资源部署要求。
