import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// AI 审核最长约 15 秒，放宽到 60 秒上限
export const maxDuration = 60;

const UPSTREAM = process.env.N8N_REVIEW_URL;
// 与 n8n 侧同步改用独立前端密钥 API_SECRET_PUBLIC；未配置时回退旧 API_SECRET 仅作过渡
// （与 n8n like-review 的回退逻辑保持一致，见 DEPLOY.md 第 1 节）
const SECRET = process.env.API_SECRET_PUBLIC ?? process.env.API_SECRET;

/** n8n like-review 成功返回的报文结构 */
interface ReviewPayload {
  pass: boolean;
  token: string;
  reason?: string;
  likeCount?: number;
  prize?: "A" | "B" | null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, message: "请求格式不正确，请重试" },
        { status: 400 }
      );
    }

    const { likesImage, profileImage } = body as {
      likesImage?: string;
      profileImage?: string;
    };
    if (
      typeof likesImage !== "string" ||
      !likesImage.startsWith("data:image") ||
      typeof profileImage !== "string" ||
      !profileImage.startsWith("data:image")
    ) {
      return NextResponse.json(
        { ok: false, message: "请先上传两张截图（朋友圈点赞页＋个人资料页）" },
        { status: 400 }
      );
    }

    if (!UPSTREAM) {
      return NextResponse.json(
        { ok: false, message: "服务未配置完成（缺少 N8N_REVIEW_URL）" },
        { status: 500 }
      );
    }

    // 把真实客户端 IP 经专用信任头 x-client-ip 转发给 n8n：
    // Vercel 是代理，不转发的话 n8n 限流读到的全是 Vercel 出口 IP，所有用户共享
    // 同一个限流桶（前几个正常、后面全被拒）。刻意不复用 x-forwarded-for /
    // x-real-ip 头名——避免与 n8n 前置反代"覆写 X-Forwarded-For/X-Real-IP"的
    // 清洗规则打架（见 DEPLOY.md 第 3 节），x-client-ip 只由本代理注入、可安全信任。
    const clientIp =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      (req.headers.get("x-real-ip") ?? "").trim();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    const upstreamRes = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": SECRET ?? "",
        "x-client-ip": clientIp,
      },
      body: JSON.stringify({ likesImage, profileImage }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => "");
      console.error("[/api/review] upstream error:", upstreamRes.status, text);
      return NextResponse.json(
        { ok: false, message: "AI 审核服务暂时不可用，请稍后再试" },
        { status: 502 }
      );
    }

    const data = (await upstreamRes.json().catch(() => null)) as
      | (ReviewPayload & { error?: boolean })
      | null;

    // n8n 的 fail() 会带 error:true，代表「系统/校验层面出错」
    // （鉴权失败、AI 不可用、截图保存失败、系统繁忙），而不是 AI 判定的"不通过"。
    // 两者必须区分：否则前端会把"鉴权失败"当成一次审核结果，
    // 渲染成"很遗憾，本次审核未通过"并给出根本走不通的申诉入口（token 为空）。
    if (
      !data ||
      data.error === true ||
      typeof data.pass !== "boolean" ||
      typeof data.token !== "string" ||
      !data.token
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: data?.reason || "AI 审核结果异常，请重新提交",
        },
        { status: 502 }
      );
    }

    // 透传 { ok, pass, token, reason, likeCount, prize }
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    console.error("[/api/review] error:", e);
    return NextResponse.json(
      { ok: false, message: "网络异常，请检查网络后重试" },
      { status: 500 }
    );
  }
}
