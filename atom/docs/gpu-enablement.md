# 透明板 Mali GPU 启用记录

2026-10-08，RK3566 / Debian10 BSP / Linux4.19.232 / Chromium91。

内核Mali已经加载，/dev/mali0存在，用户属于video组。厂商libmali-bifrost-g52-g2p0-x11 1.9-1已安装，无需更换内核、安装随机Mesa版本或刷机。问题是Xorg使用fbdev，厂商Chromium wrapper和ATOM launcher重复禁用了GPU。

改动：使用deploy/xorg/20-modesetting.conf启用modesetting、glamor和软件鼠标；start-atom.sh直接运行/usr/lib/chromium/chromium-bin，保留其必需的LD_LIBRARY_PATH，使用--use-gl=egl。仅ATOM启动器绕过厂商禁用GPU的wrapper，/usr/bin/chromium原文件没有改动。此样机仍沿用原有--no-sandbox配置。

验证：Xorg确认glamor X acceleration enabled on Mali-G52；glmark2-es2显示ARM / Mali-G52 / OpenGL ES3.2，短时build场景44FPS。Chrome系统信息显示ARM Mali-G52，WebGL1/2、GPU compositing和2d_canvas enabled。GLX的glxinfo仍可能显示llvmpipe；本方案使用厂商EGL/GLES，不把GLX误认为实际WebGL渲染路径。

GPU rasterization、视频解码和Vulkan未启用。图形会话重启后启动参数和桌面截图检查通过；尚未断电启动或执行小时级稳定性测试。短时着色器测试结果保存在artifacts/gpu-verification.json。

备份在设备/home/linaro/atom-backups/gpu-baseline，包含原Xorg配置和start-atom.sh。回滚：将xorg.conf复制回/etc/X11/xorg.conf.d/20-modesetting.conf，将start-atom.sh复制回/home/linaro/atom/deploy/start-atom.sh，然后sudo systemctl restart lightdm。测试阶段使用120秒systemd定时回滚，确认后停止计时器。此配置仅针对本样机，不适用于所有Rockchip板卡。

后续已接通视频硬解与GPU页面栅格化，详见hardware-capabilities.md；前述未启用项描述的是初始GPU阶段状态。

## 实体屏黑屏事件与恢复

用户报告黑屏后，首次发现Xorg截图仍有桌面，但DRM状态active=1、plane_mask=0，所有scanout plane没有framebuffer；背光187且DPMS disabled。说明截图不能作为实体屏输出正常的充分证据。重启LightDM后恢复plane_mask=1、Smart0-win0 ACTIVE、fb=123，用户确认实体桌面恢复。重新启动主浏览器未复现掉plane，初始触发原因仍未定位，不宣称已根治驱动。

补充atom-display-guard.service，作为原型兜底：只在ATOM会话运行时，连续两次检测DSI控制器active但无ACTIVE显示层，先强制DSI modeset，仍失败才重启LightDM；每分钟最多恢复一次。正常时不重启、不改GPU能力。原生NPU、硬解和应用资源不受此守护服务修改。守护判断有单元测试，但本次没有主动破坏实体scanout以验证故障注入。停用方式sudo systemctl disable --now atom-display-guard.service。

用户补充可能切到其他虚拟桌面后，核实Openbox为4桌面，默认包含滚轮GoToDesktop、Ctrl+Alt方向键、Super+F1–F4、Super+D隐藏窗口入口。ATOM会话现改用deploy/atom-openbox.xml：单个ATOM桌面、无切换/发送/隐藏/最小化快捷键、无桌面滚轮切换动作；原LXDE配置保持原样。重启LightDM后确认desktop count=1、current=0、showing_desktop=0，模拟Ctrl+Alt左右、Super+D、Super+F2后保持不变。该配置消除了已确认的误切空桌面风险；不将它直接等同于先前DRM丢plane的已证明触发原因。

## 2026-10-22 安全恢复修订

`.9` 已移除显示守护中自动重启 LightDM 的旧兜底。每次连续丢失 scanout 只尝试一次 modeset；若 Xorg 已处于内核 D 状态则不再向它发送恢复命令。故障结构信息写入 root 私有的 `/var/lib/atom/display-diagnostics.json`，不包含用户应用内容。本文早期记录中的热重启操作不应作为灰色板日常刷新方式。灰色板当前仍保持守护服务停用；该改动减少危险恢复路径，并未证明 BSP 驱动卡住的根因已修复。需要受控复现、内核堆栈和长时间运行验收后才能关闭此项。
