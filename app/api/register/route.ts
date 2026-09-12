import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPSTREAM = process.env.N8N_REGISTER_URL;
// 与 n8n 侧同步改用独立前端密钥 API_SECRET_PUBLIC；未配置时回退旧 API_SECRET 仅作过渡
// （与 n8n like-register 的回退逻辑保持一致，见 DEPLOY.md 第 1 节）
const SECRET = process.env.API_SECRET_PUBLIC ?? process.env.API_SECRET;

function isValidPhone(phone: string): boolean {
  return /^1\d{10}$/.test(phone);
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

    const { token, mode, name, phone, address } = body as {
      token?: string;
      mode?: string;
      name?: string;
      phone?: string;
      address?: string;
    };

    if (typeof token !== "string" || token.length < 8) {
      return NextResponse.json(
        { ok: false, message: "提交信息已失效，请重新上传截图审核" },
        { status: 400 }
      );
    }
    if (mode !== "auto" && mode !== "appeal") {
      return NextResponse.json({ ok: false, message: "参数错误" }, { status: 400 });
    }
    if (!name || !name.trim()) {
      return NextResponse.json({ ok: false, message: "请填写姓名" }, { status: 400 });
    }
    if (!phone || !isValidPhone(phone)) {
      return NextResponse.json(
        { ok: false, message: "请填写正确的 11 位手机号" },
        { status: 400 }
      );
    }
    if (!address || !address.trim() || address.trim().length < 5) {
      return NextResponse.json(
        { ok: false, message: "请填写详细的收货地址" },
        { status: 400 }
      );
    }

    if (!UPSTREAM) {
      return NextResponse.json(
        { ok: false, message: "服务未配置完成（缺少 N8N_REGISTER_URL）" },
        { status: 500 }
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    const upstreamRes = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": SECRET ?? "",
      },
      body: JSON.stringify({
        token,
        mode,
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => "");
      console.error("[/api/register] upstream error:", upstreamRes.status, text);
      return NextResponse.json(
        { ok: false, message: "登记服务暂时不可用，请稍后再试" },
        { status: 502 }
      );
    }

    const data = await upstreamRes.json().catch(() => null);
    if (!data || typeof data !== "object" || typeof data.ok !== "boolean") {
      return NextResponse.json(
        { ok: false, message: "登记结果异常，请稍后重试" },
        { status: 502 }
      );
    }

    // 上游可能用 HTTP 200 返回业务失败；保留真实 ok，避免把异常包装成成功。
    return NextResponse.json(data, { status: data.ok ? 200 : 400 });
  } catch (e) {
    console.error("[/api/register] error:", e);
    return NextResponse.json(
      { ok: false, message: "网络异常，请检查网络后重试" },
      { status: 500 }
    );
  }
}
