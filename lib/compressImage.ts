/**
 * 图片压缩：长边不超过 1600px，转 JPEG 质量 0.75，输出不带 data: 前缀的 base64。
 * 在微信内置浏览器（iOS/Android）中通过 canvas 压缩，避免上传超大原图。
 */

const MAX_SIDE = 1600;
const QUALITY = 0.75;

export interface CompressedImage {
  base64: string; // 不含 data:image/...;base64, 前缀
  dataUrl: string; // 含前缀，供 <img> 预览
}

export function compressImageFile(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        const ratio = Math.max(width, height) / MAX_SIDE;
        if (ratio > 1) {
          width = Math.round(width / ratio);
          height = Math.round(height / ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法创建画布"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
        const base64 = dataUrl.split(",")[1] ?? "";
        resolve({ base64, dataUrl });
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败，请更换图片"));
    };
    img.src = url;
  });
}
