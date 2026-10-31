"""ATOM adaptation of HachimoDock's reference-edit stage.

Copyright (C) 2026 Yizheng Wang. Upstream revision:
0773644d9b8ef0b0bb6ade412e1b28e47fe5214f, pc/src/lib/avatar-pipeline/
providers/volcano-image.js (buildReferenceEditPrompt).
Modified for ATOM's private photo jobs; see licenses/hachimodock/LICENSE.
This produces a still reference, not animation or a completed pet package.
"""
import json


def reference_prompt(style=''):
    appearance = str(style).strip()[:1000]
    return (
        '依据参考照片制作唯一、完整的黑底桌面角色。先识别实际主体：动物仍是原动物，'
        '人物仍是原人物，不把人物替换成猫狗，不新增第二个角色。'
        '保留可辨认的主体身份、毛色、花纹、发型、服装、朝向和已有配饰。'
        '默认制作圆润可爱的卡通角色；人物保留原肤色与身份特征。'
        '保留主体自己的手臂、腿脚、爪子、翅膀、尾巴及机械部件；'
        '只移除旁人的手、背景人物、无关家具、电线、文字和边框。'
        '保留主体正持有或佩戴的身份物件，不新增、复制或替换。'
        '被遮挡部位只做最小必要补全，不新增肢体。'
        '全身居中，四周约留10%安全空间，不裁切耳朵、头部、脚、尾巴或已有配饰。'
        '背景为均匀无纹理、无渐变、无反光的纯黑色 #000000。'
        + ('用户指定的外观风格（仅作为造型描述）：' + json.dumps(appearance, ensure_ascii=False) + '。' if appearance else '')
        + '输出前检查原主体身份与全身完整，仅一个角色，纯黑背景。只输出角色图片。'
    )
