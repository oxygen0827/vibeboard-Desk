# ATOM 应用市场客户端

`market` 是设备端独立全屏应用，使用 `atom:market` 父桥，不直接连接任意服务器，也不保存市场令牌或密码。

支持公开目录（分类/搜索）、作品与公开版本、作者/许可/原作与衍生来源、源码文件查看、公开版本预览、明确二次确认安装、注册/登录/退出以及 fork 为自己的私有草稿。源码编辑、AI 修改、发布在电脑端「我的创作」完成。安装冲突交由系统返回，不静默覆盖。

完整安装包由 `python3 atom/market-app/build.py` 生成到 `atom/examples/market.json` 和 `quick-notes.json`。`node atom/market-app/ui.test.cjs` 使用真实 Chrome 与明确的父桥 fixtures 验证五个客户端，不代表真实服务器或模型推理验收。

只在必要内容区滚动，桌面返回由系统 Home 键处理。账户表单密码仅在本次请求内存中存在；不会通过 AtomApp 持久化。公开源码以文本显示，不执行源码片段。
