"use client";

import { useRef, useState } from "react";
import { compressImageFile, type CompressedImage } from "@/lib/compressImage";

type Step = 1 | 2 | 3 | 4;
type RegMode = "auto" | "appeal";

interface ReviewResult {
  pass: boolean;
  token: string;
  reason?: string;
  likeCount?: number;
  prize?: "A" | "B" | null;
}

/** /api/review 的响应：成功时透传 ReviewResult，失败时带 ok:false + message */
type ReviewApiResponse = Partial<ReviewResult> & {
  ok?: boolean;
  error?: boolean;
  message?: string;
};

interface RegisterResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/** /api/check-duplicate 的响应：duplicate 仅在 ok:true 时有意义 */
interface CheckDuplicateResult {
  ok: boolean;
  duplicate?: boolean;
  message?: string;
}

export default function Home() {
  const [step, setStep] = useState<Step>(1);

  // step2（填写信息）：资料全程只填一次——查重、审核通过后自动登记都用这份缓存
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [checking, setChecking] = useState(false);

  // step3（上传截图 + AI 审核 + 自动登记）
  const [likes, setLikes] = useState<CompressedImage | null>(null);
  const [profile, setProfile] = useState<CompressedImage | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [registering, setRegistering] = useState(false);

  // step4
  const [result, setResult] = useState<{
    kind: "auto" | "appeal" | "duplicate" | "error";
    text: string;
  } | null>(null);

  const likesInputRef = useRef<HTMLInputElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);

  const pickLikes = async (file?: File) => {
    if (!file) return;
    try {
      setLikes(await compressImageFile(file));
    } catch (e) {
      alert(e instanceof Error ? e.message : "图片读取失败，请更换图片");
    } finally {
      if (likesInputRef.current) likesInputRef.current.value = "";
    }
  };

  const pickProfile = async (file?: File) => {
    if (!file) return;
    try {
      setProfile(await compressImageFile(file));
    } catch (e) {
      alert(e instanceof Error ? e.message : "图片读取失败，请更换图片");
    } finally {
      if (profileInputRef.current) profileInputRef.current.value = "";
    }
  };

  const resetToStep3 = () => {
    setReview(null);
    setReviewing(false);
    setLikes(null);
    setProfile(null);
    setStep(3);
  };

  // —— Step2：先本地校验，再调轻量查重接口拦下重复手机号（省一次 AI 调用）——
  const submitInfo = async () => {
    if (!name.trim()) {
      alert("请填写姓名");
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      alert("请填写正确的 11 位手机号");
      return;
    }
    if (address.trim().length < 5) {
      alert("请填写详细的收货地址");
      return;
    }
    if (!agreed) {
      alert("请先阅读并勾选同意活动规则");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch("/api/check-duplicate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data: CheckDuplicateResult = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        // 查重失败（服务异常/活动结束/限流/网络问题）一律不放行：
        // 绝不能当作 duplicate:false 让用户带着"可能重复"的风险继续走
        alert(data.message || "查重服务暂时不可用，请稍后重试");
        return;
      }
      if (data.duplicate) {
        // 原地报错且不清空表单：万一是看错了号码，改一下就能直接重试
        alert("该手机号已参与过本次活动，每人限参与一次");
        return;
      }
      // name/phone/address 已在本组件 state 中，进入上传截图页即可
      setStep(3);
    } catch {
      alert("网络异常，请检查网络后重试");
    } finally {
      setChecking(false);
    }
  };

  // 登记：不需要用户交互的内部函数（资料在 Step2 已收集并校验过，去掉全部表单校验）。
  // auto = 审核通过后自动调用；appeal = 审核不通过时点"申请人工审核"直接调用。
  const submitRegister = async (mode: RegMode, tokenArg?: string) => {
    const token = tokenArg ?? review?.token ?? "";
    if (!token) {
      alert("提交信息已失效，请重新上传截图审核");
      resetToStep3();
      return;
    }

    setRegistering(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          mode,
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
        }),
      });
      const data: RegisterResult = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.code === "DUPLICATE") {
          setResult({
            kind: "duplicate",
            text: "⚠️ 该手机号或微信号已参与过本次活动，每人仅限一次",
          });
          setStep(4);
          return;
        }
        alert(data.message || "登记失败，请稍后重试");
        return;
      }
      setResult({
        kind: mode,
        text:
          mode === "auto"
            ? "🎉 登记成功！我们将在7个工作日内寄出奖品"
            : "✅ 您的信息已提交人工审核，通过后将通知您，请耐心等待",
      });
      setStep(4);
    } catch {
      alert("网络异常，请检查网络后重试");
    } finally {
      setRegistering(false);
    }
  };

  // —— Step3：上传截图提交 AI 审核（逻辑不变，只是页面位置挪到 Step3）——
  const submitReview = async () => {
    if (!likes || !profile) return;
    setReviewing(true);
    setReview(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          likesImage: likes.dataUrl,
          profileImage: profile.dataUrl,
        }),
      });
      const data: ReviewApiResponse = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        // 系统/校验层面出错（鉴权失败、AI 不可用、截图保存失败）会以 502 + message 返回，
        // 这不是一次"审核结果"，不能落到下面的未通过分支去。
        alert(data.message || "审核失败，请稍后重试");
        return;
      }
      setReview({
        pass: data.pass === true,
        token: data.token ?? "",
        reason: data.reason,
        likeCount: data.likeCount,
        prize: data.prize,
      });
      // 审核通过 → 立即用 Step2 已缓存的资料自动登记，用户无需再点任何按钮
      if (data.pass === true && data.token) {
        submitRegister("auto", data.token);
      }
    } catch {
      alert("网络异常，请检查网络后重试");
    } finally {
      setReviewing(false);
    }
  };

  // —— 各步骤组件 ——
  const renderHeader = () => (
    <header className="header">
      <h1>🍶 永丰特8 · 好礼派送</h1>
      <div className="sub">纯粮酿造 · 北京二锅头</div>
    </header>
  );

  const renderSteps = () => {
    const labels = ["活动规则", "填写信息", "上传截图", "完成"];
    const activeMap: Record<Step, number> = { 1: 0, 2: 1, 3: 2, 4: 3 };
    const active = activeMap[step];
    return (
      <div className="steps">
        {labels.map((label, i) => (
          <div
            key={label}
            className={`step-item ${i < active ? "done" : i === active ? "active" : ""}`}
          >
            <span className="line" />
            <span className="dot">{i < active ? "✓" : i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderStep1 = () => (
    <>
      <div className="hero">
        <div className="wine">永丰特8 北京二锅头</div>
        <div className="slogan">喝好酒 · 选特级</div>
        <div className="tags">
          <span className="tag">纯粮酿造</span>
          <span className="tag">国标特级</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">🎁 惊喜好礼</div>
        <div className="prize-row">
          <span>
            <span className="level">A 产品</span>
          </span>
          <span>
            价值15元 · 42度168ml · 永丰特8 一瓶
            <br />
            <small>（小小规格，心意满满）</small>
          </span>
        </div>
        <div className="prize-row">
          <span>
            <span className="level">B 产品</span>
          </span>
          <span>
            价值35元 · 42度500ml · 永丰特8 一瓶
            <br />
            <small>（整瓶装，更尽兴）</small>
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">📋 参与说明</div>
        <ol className="rule-list">
          <li>
            在朋友圈分享含永丰特8产品特色的动态，即有机会获得心意好礼
          </li>
          <li>
            需上传两张截图：朋友圈动态详情页（含文案+完整互动列表）＋微信个人资料页（需显示微信号）
          </li>
          <li>每微信号每手机号仅限一次，重复提交无效</li>
          <li>系统将自动审核，如有异议可申请人工复核，通过后另行通知</li>
          <li>内容如有不实（如PS造假、审核后删除朋友圈）将取消资格</li>
          <li>信息仅用于奖品配送</li>
        </ol>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <button className="btn" onClick={() => setStep(2)}>
          我已了解，开始参与
        </button>
      </div>
    </>
  );

  // —— Step2：填写收货信息 + 即时查重 ——
  const renderStep2 = () => (
    <div className="card">
      <div className="card-title">填写收货信息</div>
      <p style={{ fontSize: 13, color: "#4a4f56", lineHeight: 1.7, marginBottom: 12 }}>
        请先填写收货信息，系统会即时查重；
        <br />
        通过后再上传截图，全程只需填写这一次。
      </p>

      <div className="form-item">
        <label>
          姓名 <b>*</b>
        </label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入收货人姓名" />
      </div>
      <div className="form-item">
        <label>
          手机号 <b>*</b>
        </label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="用于查重与奖品配送联系"
          inputMode="numeric"
          maxLength={11}
        />
      </div>
      <div className="form-item">
        <label>
          收货地址 <b>*</b>
        </label>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="请填写省市区＋详细地址"
        />
      </div>

      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>我已阅读并同意活动规则，同意收集上述信息仅用于本次活动</span>
      </label>

      <button className="btn block" disabled={checking} onClick={submitInfo}>
        {checking ? "查重中…" : "下一步：上传截图"}
      </button>
    </div>
  );

  // —— Step3：上传截图 → AI 审核 → 通过自动登记 / 不通过可一键申诉 ——
  const renderStep3 = () => {
    if (reviewing) {
      return (
        <div className="card">
          <div className="loading-box">
            <div className="spinner" />
            <div className="txt">审核中，最长可能需要 1 分钟，请勿关闭页面</div>
          </div>
        </div>
      );
    }

    if (review) {
      if (review.pass) {
        // 审核通过后不再展示任何表单：登记用 Step2 已收集的资料自动完成。
        // 直接采用后端返回的 prize 字段判定奖品，不再用 likeCount 阈值重新计算。
        const isB = review.prize === "B";
        return (
          <div className="card">
            <div className="result-big">
              <div className="icon">🎉</div>
              <h2>审核通过！</h2>
              <div className="desc">
                识别到点赞数：{review.likeCount}
                <br />
                恭喜可领{isB ? "B" : "A"}产品：
                {isB
                  ? "价值35元42度500ml永丰特8一瓶"
                  : "价值15元42度168ml永丰特8一瓶"}
                <br />
                {registering ? "正在使用您填写的收货信息自动登记…" : "登记提交异常，请点击下方按钮重试。"}
              </div>
            </div>
            {registering ? (
              <div className="loading-box">
                <div className="spinner" />
                <div className="txt">登记中…</div>
              </div>
            ) : (
              <button className="btn block" onClick={() => submitRegister("auto", review.token)}>
                重新登记
              </button>
            )}
          </div>
        );
      }
      return (
        <div className="card">
          <div className="banner error" style={{ textAlign: "center" }}>
            很遗憾，本次审核未通过
          </div>
          <div className="result-big">
            <div className="icon">😕</div>
            <div className="desc">
              AI 审核原因：
              <br />
              {review.reason || "截图不符合活动要求，请重新上传"}
            </div>
          </div>
          <div className="btn-row">
            <button className="btn btn-plain" onClick={resetToStep3}>
              重新上传截图
            </button>
          </div>
          <button className="btn block" disabled={registering} onClick={() => submitRegister("appeal")}>
            {registering ? "提交中…" : "申请人工审核"}
          </button>
        </div>
      );
    }

    return (
      <div className="card">
        <div className="card-title">上传两张截图</div>
        <p style={{ fontSize: 13, color: "#4a4f56", lineHeight: 1.7, marginBottom: 12 }}>
          请上传：
          <br />① 朋友圈<strong>点赞详情页</strong>截图（需含朋友圈文案＋完整点赞列表）
          <br />② 微信<strong>个人资料页</strong>截图（需显示微信号）
        </p>

        <div className="upload-grid">
          <div>
            <input
              ref={likesInputRef}
              className="file-input"
              type="file"
              accept="image/*"
              onChange={(e) => pickLikes(e.target.files?.[0])}
            />
            <div
              className={`upload-box ${likes ? "chosen" : ""}`}
              onClick={() => likesInputRef.current?.click()}
            >
              {likes ? (
                <>
                  <img className="preview" src={likes.dataUrl} alt="点赞截图预览" />
                  <span className="re-take">重新选择</span>
                </>
              ) : (
                <>
                  <span className="plus">＋</span>
                  <span className="tip">朋友圈点赞详情页截图</span>
                </>
              )}
            </div>
          </div>
          <div>
            <input
              ref={profileInputRef}
              className="file-input"
              type="file"
              accept="image/*"
              onChange={(e) => pickProfile(e.target.files?.[0])}
            />
            <div
              className={`upload-box ${profile ? "chosen" : ""}`}
              onClick={() => profileInputRef.current?.click()}
            >
              {profile ? (
                <>
                  <img className="preview" src={profile.dataUrl} alt="个人资料页预览" />
                  <span className="re-take">重新选择</span>
                </>
              ) : (
                <>
                  <span className="plus">＋</span>
                  <span className="tip">微信个人资料页截图</span>
                </>
              )}
            </div>
          </div>
        </div>

        <button className="btn block" disabled={!likes || !profile} onClick={submitReview}>
          提交审核
        </button>
      </div>
    );
  };

  const renderStep4 = () => {
    const kind = result?.kind ?? "error";
    const text =
      result?.text ??
      (kind === "duplicate"
        ? "⚠️ 该手机号或微信号已参与过本次活动，每人仅限一次"
        : kind === "auto"
          ? "🎉 登记成功！我们将在7个工作日内寄出奖品"
          : kind === "appeal"
            ? "✅ 您的信息已提交人工审核，通过后将通知您，请耐心等待"
            : "出现了一些问题，请稍后重试");
    return (
      <div className="card">
        <div className="result-big">
          <div className="icon">{kind === "duplicate" || kind === "error" ? "⚠️" : "🎉"}</div>
          <h2>{kind === "duplicate" ? "无法重复参与" : kind === "error" ? "出错了" : "提交成功"}</h2>
          <div className="desc">{text}</div>
        </div>
        {kind === "duplicate" || kind === "error" ? (
          <button className="btn" onClick={() => { setResult(null); setStep(1); }}>
            返回活动首页
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => {
              setResult(null);
              setReview(null);
              setReviewing(false);
              setLikes(null);
              setProfile(null);
              setStep(2);
            }}
          >
            再参加一次（同一用户仅限一次）
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="page">
      {renderHeader()}
      {renderSteps()}
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
      <div className="footer-note">本活动最终解释权归主办方所有 · 永丰特8</div>
    </div>
  );
}
