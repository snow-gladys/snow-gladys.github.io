from PIL import Image, ImageDraw

def process_vinyl_record(input_path, output_path):
    # 1. 打开图片并转换为 RGBA (增加透明通道)
    try:
        img = Image.open(input_path).convert("RGBA")
    except FileNotFoundError:
        print(f"找不到文件: {input_path}")
        return

    width, height = img.size
    center = (width // 2, height // 2)
    
    # 2. 创建一个空的遮罩 (Mask)
    # "L" 模式表示灰度图，初始全为 0 (黑色/完全透明)
    mask = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(mask)

    # --- 调整参数区域 ---
    # 半径设定：根据你的图片，唱片几乎撑满全图，中间的孔大约是直径的 35% 左右
    # 如果裁剪不准确，请微调下面的两个系数
    
    # 外圆半径 (保留区域)：设为最小边长的一半，稍微减一点点以去除边缘锯齿
    outer_radius = min(width, height) // 2 * 0.99 
    
    # 内圆半径 (剔除区域 - 中间的孔)：设为大约 32% (根据你的图估算)
    inner_radius = min(width, height) // 2 * 0.70
    # --------------------

    # 3. 绘制外圆 (白色 = 255 = 不透明/保留)
    draw.ellipse((center[0] - outer_radius, center[1] - outer_radius,
                  center[0] + outer_radius, center[1] + outer_radius), fill=255)

    # 4. 绘制内圆 (黑色 = 0 = 透明/挖空)
    draw.ellipse((center[0] - inner_radius, center[1] - inner_radius,
                  center[0] + inner_radius, center[1] + inner_radius), fill=0)

    # 5. 将遮罩应用到原图的 Alpha 通道
    img.putalpha(mask)

    # 6. 保存结果 (必须保存为 PNG 以支持透明度)
    img.save(output_path, "PNG")
    print(f"处理完成！已保存为: {output_path}")

# 执行函数
# 请确保文件名与你上传的文件名一致
process_vinyl_record("cd_img.png", "vinyl_transparent.png")