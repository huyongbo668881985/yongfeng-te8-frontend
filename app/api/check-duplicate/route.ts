import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// 轻量查重只做一次 Supabase 查询，响应很快，10 秒上限足够（对比 review 的 60s）
export const maxDuration = 10;

const UPSTREAM = process.env.N8N_CHECK_DUPLICATE_URL;
// 与 n8n 侧同步使用独立前端密钥 API_SECRET_PUBLIC；未配置时回退旧 API_SECRET 仅作过渡
// （与 /api/review、/api/register 的回退逻辑保持一致，见 DEPLOY.md 第 1 节）
const SECRET = process.env.API_SECRET_PUBLIC ?? process.env.API_SECRET;

function isValidPhone(phone: string): boolean {
  return /^1\d{10}$/.test(phone);
}

/** n8n check-duplicate 的响应结构：成功时 { ok:true, duplicate:boolean }，失败时 { ok:false, message } */
interface CheckDuplicatePayload {
  ok?: boolean;
  duplicate?: boolean;
  message?: string;
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

    const { phone } = body as { phone?: string };
    if (typeof phone !== "string" || !isValidPhone(phone.trim())) {
      return NextResponse.json(
        { ok: false, message: "请填写正确的 11 位手机号" },
        { status: 400 }
      );
    }

    if (!UPSTREAM) {
      return NextResponse.json(
        { ok: false, message: "服务未配置完成（缺少 N8N_CHECK_DUPLICATE_URL）" },
        { status: 500 }
      );
    }

    // 把真实客户端 IP 经专用信任头 x-client-ip 转发给 n8n（与 /api/review 同一套）：
    // Vercel 是代理，不转发的话 n8n 限流读到的全是 Vercel 出口 IP，查重与审核的
    // 限流桶都会被全体用户共享。刻意不复用 x-forwarded-for / x-real-ip 头名——
    // 避免与 n8n 前置反代"覆写 X-Forwarded-For/X-Real-IP"的清洗规则打架
    // （见 DEPLOY.md 第 3 节），x-client-ip 只由本代理注入、可安全信任。
    const clientIp =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      (req.headers.get("x-real-ip") ?? "").trim();

    const controller = new AbortController();
    // 上游只是查一次库（内部超时上限 5s），8s 客户端超时留出余量且小于 maxDuration
    const timer = setTimeout(() => controller.abort(), 8_000);
    const upstreamRes = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": SECRET ?? "",
        "x-client-ip": clientIp,
      },
      body: JSON.stringify({ phone: phone.trim() }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => "");
      console.error("[/api/check-duplicate] upstream error:", upstreamRes.status, text);
      return NextResponse.json(
        { ok: false, message: "查重服务暂时不可用，请稍后重试" },
        { status: 502 }
      );
    }

    const data = (await upstreamRes.json().catch(() => null)) as
      | (CheckDuplicatePayload & { error?: boolean })
      | null;

    // 任何非 ok:true 的返回（鉴权失败、活动已结束、格式错误、查询故障）
    // 都必须原样拦下并透传 message——绝不能当作 duplicate:false 放行，
    // 否则用户会带着"可能重复"的风险走完 AI 审核，最后撞 DUPLICATE 白花一次 AI 调用。
    if (!data || data.error === true || typeof data.ok !== "boolean" || !data.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: data?.message || "查重服务暂时不可用，请稍后重试",
        },
        { status: 502 }
      );
    }

    if (typeof data.duplicate !== "boolean") {
      return NextResponse.json(
        { ok: false, message: "查重结果异常，请稍后重试" },
        { status: 502 }
      );
    }

    // 只透传 duplicate 布尔值（n8n 侧本就只返回这一个业务字段）
    return NextResponse.json({ ok: true, duplicate: data.duplicate });
  } catch (e) {
    console.error("[/api/check-duplicate] error:", e);
    return NextResponse.json(
      { ok: false, message: "网络异常，请检查网络后重试" },
      { status: 500 }
    );
  }
}
