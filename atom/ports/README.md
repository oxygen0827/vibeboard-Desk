# ATOM 成熟视觉项目移植

## 流体画布 / fluid-atlas

上游：https://github.com/PavelDoGreat/WebGL-Fluid-Simulation，提交a2d292931f19d9b3b9f564e23e6c32729d2121c3，MIT，版权Pavel Dobryakov，LICENSE及源码版权声明保留。

保留上游WebGL2/半浮点流体、压力迭代、染料、旋涡、辉光、光束和着色器。移除推广DOM、停用desktop dat.GUI与统计调用，增加适配480×360的迸发/暂停/画质/清空。纹理使用anonymous跨域加载，与ATOM opaque-origin sandbox兼容。浏览器必须具备支持的浮点渲染格式，不以Canvas动画冒充流体求解。

Mali-G52未暴露OES_texture_float_linear，但WebGL2的RGBA16F核心线性过滤实测有效：两像素黑白纹理在中点采样读取[128,128,128,255]，glError=0。适配因此对WebGL2半浮点路径启用线性过滤，恢复辉光/光束；WebGL1仍沿用上游扩展检测。染料分辨率512/256，压力12次，辉光4级，染料衰减0.3、色彩强度0.45。本样机精细模式短时约45–46FPS。较低档位以真机实时FPS为准。

## 天体观测台 / planetarium

上游：https://github.com/typpo/spacekit，提交aa93d3f21c3bd983e8c55af88a175f06c3d32fc8，MIT，LICENSE保留。离线包含上游预构建Spacekit（包含Three.js）、Yale星表与示例Earth/Jupiter/Saturn纹理、环纹理和上游assets。素材来源为上游examples；商业发布前应逐项补齐原始素材署名与授权，代码MIT不自动覆盖所有图片来源。

使用原引擎的球面、光源、大气、星表、相机控制和行星环，不重新手绘假星球。3个独立观察场景不是按相对大小模拟完整太阳系。默认近景，鼠标拖动环绕、滚轮缩放，自动巡航可暂停。修正上游ring shader写死的0.0389259903阴影半径，以匹配本场景unitsPerAu=1；修正资源basePath尾部斜杠和默认相机环面视角。真机三场景约60FPS。

## 接入与验证

server.py只对/user-apps/公开静态资源GET/HEAD添加Access-Control-Allow-Origin:*，让隔离iframe可加载WebGL纹理/星表；设备API没有增加跨域权限。安装应用仍无allow-same-origin，空格Home共享中继不变。

资源部署在设备/home/linaro/atom/apps/fluid-atlas和planetarium。bundle.json只含安装入口，完整部署还必须复制同目录的JS、纹理、数据和LICENSE；不能把入口JSON误当成独立离线应用包。大资源的正式应用市场包协议仍需后续扩展。目前原型直接部署完整目录。

tools/build_visual_ports.py基于atom/vendor中的固定上游源码生成ports，vendor仅作为本地源码缓存被.gitignore排除。生产构建应按上述提交固定来源。

真机验证：6项资源/渲染问题修正后无脚本异常，WebGL error=0，星表和纹理完全离线；全屏360px无根滚动；画质切换、迸发、暂停、清空、相机拖动/滚轮和空格返回检查。30项后端自动化测试通过，包含公开素材CORS与API无CORS回归。短时性能不是小时级稳定性验收。

## 光影水池与颜料画室

`water-pool` 移植 Evan Wallace 的 evanw/webgl-water；`fluid-paint` 移植 David Li 的 dli/paint。各自 UPSTREAM.txt 保存来源及提交，原源码版权说明和许可证保留。水池图片的来源/署名见原 index.html，商业分发仍须单独确认素材权限。

构建：`python3 atom/tools/build_water_paint.py`。依赖忽略缓存目录中的两份上游源码。与前两款大型移植应用一样，需要部署完整目录，bundle.json 仅注册入口，不能单独作为完整离线安装包。

`webgl2-compat.js` 为两个旧 WebGL1 项目提供局部 WebGL2 入口：GLSL300 转换、RGBA16F 模拟纹理、内建实例化操作和浮点帧缓冲支持；不修改系统 GPU 驱动。RGBA16F 采用半精度，与上游 float32 存储有所不同。保留原模拟与渲染主体。

水池支持拖动波纹、球体与相机，以及暂停、重力、雨滴按钮。颜料画室支持三种颜色、两档画笔、滚轮调整笔刷、撤销、重做和清空；原大型控制面板被替换。空格由 ATOM 用于返回首页。绘画保存在当前会话中，退出后不保留；未实现作品导出。应用页面无全局滚动。

2026-10-08 真机 Chromium/EGL 测试：在 ATOM 沙箱 iframe 中，以 5 秒 requestAnimationFrame 窗口测量，水池约 20 FPS、绘画约 34 FPS；均 gl.getError()=0、无 pageerror，短按空格返回 home，scrollHeight=innerHeight=360。水池内部384×288放大至480×360，波纹纹理128²；绘画模拟分辨率0.75倍、48根笔毛、6次约束迭代。此为短时测试，不代表所有交互状态或持续运行性能。原始结果见 atom/artifacts/water-paint-verification.json。

## 体积流场、生命纹理、月光海洋

构建：`python3 atom/tools/build_more_ports.py`。完整资源目录随应用部署，各目录 `UPSTREAM.txt` 记录上游提交，各自许可证保留。

- `volume-flow`：dli/flow 的原版 curl noise、粒子排序与体积切片渲染。RK3566 采用4096/8192/16384粒子三档、32切片、256²不透明度缓冲区、每帧12次排序步进。WebGL2兼容层不修改系统驱动。
- `living-pattern`：piellardj/reaction-diffusion-webgl 的预构建程序和全部本地着色器。GPU Gray-Scott反应扩散、鼠标播种、六种预设、暂停、重新生长；隐藏网页导航和原宽控制栏。速度默认及预设切换后限制为20，保持小屏性能。保留WebGL1的RGBA8编码算法。沙箱中 history.replaceState 失败时跳过保存URL状态。
- `moon-ocean`：jbouny/fft-ocean 的FFT波浪、反射、天空和天气。FFT128²、几何网格64²、云纹理128²；移除可选船模型、桌面dat.GUI和jQuery依赖，用原生键盘事件及小屏按钮，保留摄像机/场景/原模拟算法。波浪/雨声资源保留但不自动播放。支持月夜、白昼、日落和风力。WebGL2兼容层转换旧GLSL（包括texture2DProj/gl_FragData[0]/自定义tanh）并使用RGBA16F模拟纹理。海洋天空图片、船/音频的独立来源见上游README；代码许可不能代替素材许可，商业分发须核对素材。

## 物理实验台、口袋音乐工作站、模型检视台

这三款是为ATOM开发的小屏应用，使用原开源引擎，并非完整上游编辑器的移植。

- `physics-playground`：Matter.js 0.20.0（MIT）。碰撞堆、多米诺、悬索桥、弹弓四个实验；鼠标/触摸拖动物体，增添形状、切换重力、暂停和重置。限制最多140个刚体（含边界）。不保存场景。引擎时间按每帧固定步长推进，低帧率下模拟会减速。
- `pocket-studio`：Tone.js 14.8.49（MIT），WebAudio离线合成、7轨16步音序、旋律与底鼓/军鼓/踩镲、60–180BPM、预设/变奏/清空、波形显示。本机单份存档通过专用parent bridge，只有匹配来源iframe的本应用可读写；验证7×16布尔矩阵与BPM，其他应用不能访问。退出停止音频；无录音、WAV导出或完整DAW编辑功能。
- `model-viewer`：Three.js 0.128.0（MIT）及原版OrbitControls/STLLoader/OBJLoader。离线读取STL/OBJ，不上传；旋转/缩放、线框、巡航、归位、三角面数与轴向包围盒尺寸；附扭结/齿轮/结构件三种样例。限制8MiB/15万三角面；尺寸为文件坐标单位，不推断毫米。无MTL外部纹理、CAD编辑、切片或自动修复。退出不保留导入文件。

所有应用是全屏固定视口，空格返回ATOM首页，新安装应用追加桌面末尾。入口JSON不能单独携带这些完整资源包，部署必须复制整个目录。

### 2026-10-08 真机验收

在480×360的ATOM实际沙箱iframe中，短时3秒rAF测量：体积流场21FPS、生命纹理28FPS、月光海洋47FPS、物理实验台62FPS、模型检视台62FPS；音乐界面62FPS不代表音频性能。所有WebGL应用glError=0，所有六款无pageerror/资源404/着色器错误，scrollHeight=innerHeight=360，空格返回home。

已操作体积换色/流场与相机、生命纹理预设/播种/暂停、海洋日落/风力、三种物理场景及弹弓真实释放（launched=true/elasticRemoved=true）、音乐播放/保存/退出后恢复/拒绝非法存档、OBJ四边形解析成2面、二进制STL解析成1面并显示10×20×30模型单位。音乐走PulseAudio硬件sink，3秒loopback采样261380个s16样本，peak1049、RMS115.59，确认有非零音频输出；不替代用户对扬声器音质的实际听感验证。结果见 `atom/artifacts/complex-apps-verification.json`。此为短时功能测试，不保证任意大模型或持续高负载时的帧率。

## 2026-10-23 生活与仪式应用

新增 `moon-letter` 月亮来信、`rain-radio` 雨夜电台、`personality-planet` 我的人格星球、`natal-whispers` 星盘密语、`glass-ecosystem` 玻璃生态瓶、`element-sandbox` 掌心造物沙盘；以及前一轮 `oracle-tarot`、`zodiac-atlas`、`echo-book`。

各目录包含完整文本资源、独立主题图标、五向声明和 SOURCE.md。用 `python3 atom/tools/rebuild_life_bundles.py` 重建九项 JSON 包，然后运行图标准备、check_app.py 和真实流程测试。改编范围、三端部署与完整资源同步记录见 [交付说明](../docs/life-apps-delivery-2026-10-23.md)。
