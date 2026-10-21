# Agent 小屋

原创 Canvas 等距像素工作室。只根据经过授权的 atom:task-state 实际任务状态显示工作、待确认、完成及失败。没有任务时保持安静，不编造思考或进度。任务支持逐项分页，不滚动页面。

需要 manifest task-state 能力和用户首次授权。权限拒绝后停止自动请求，用户点刷新才重试。点击任务进入系统已有「我的电脑」查看/确认/接收作品；小屋不直接执行命令。

构建 `python3 atom/experiences/agents/build.py`。240×180 Canvas，最高10fps，减少动态效果关闭动作，退出释放动画和定时器。
