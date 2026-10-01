"""Minimal anonymous device-access request page for the frozen V5 application."""

from __future__ import annotations

from html import escape


def render_request_page(state, csrf_token) -> str:
    value = state if isinstance(state, dict) else {}
    status = str(value.get("status") or "new")
    messages = {
        "new": "此设备尚未获准访问，请提交申请。",
        "pending": "申请已提交，等待管理员审批。",
        "approved": "设备已批准，正在进入系统。",
        "rejected": "申请未获批准，请联系管理员。",
    }
    status_text = escape(str(value.get("message") or messages.get(status, messages["new"])))
    error = escape(str(value.get("error") or ""))
    csrf = escape(str(csrf_token or ""), quote=True)
    form_hidden = "hidden" if status in {"pending", "approved"} else ""
    error_markup = f'<p class="error" role="alert">{error}</p>' if error else ""
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>设备访问申请</title>
  <style>
    :root {{ color-scheme: dark; font-family: system-ui,-apple-system,"Segoe UI",sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
      color: #e7eefc; background: #0b1424; }}
    main {{ width: min(100%, 520px); padding: 30px; border: 1px solid #2c3e5d; border-radius: 18px;
      background: #142238; box-shadow: 0 18px 55px #02081780; }}
    h1 {{ margin: 0 0 8px; font-size: 25px; }}
    .hint,.status {{ color: #aebbd0; line-height: 1.65; }}
    .status {{ padding: 12px 14px; border-radius: 10px; background: #0e1a2d; }}
    form[hidden] {{ display: none; }}
    label {{ display: block; margin-top: 16px; color: #cdd7e7; }}
    input,textarea {{ width: 100%; margin-top: 7px; padding: 11px 12px; color: #f4f7fc;
      border: 1px solid #405477; border-radius: 9px; background: #0c1728; font: inherit; }}
    textarea {{ min-height: 92px; resize: vertical; }}
    button {{ width: 100%; margin-top: 20px; padding: 12px; border: 0; border-radius: 9px;
      color: white; background: #1688f8; font: inherit; font-weight: 650; cursor: pointer; }}
    .error {{ color: #ff9b9b; }}
  </style>
</head>
<body>
<main>
  <h1>项目管理系统</h1>
  <p class="hint">申请访问</p>
  <p id="accessStatus" class="status" aria-live="polite">{status_text}</p>
  {error_markup}
  <form method="post" action="/request-access" {form_hidden}>
    <input type="hidden" name="csrf_token" value="{csrf}">
    <label>申请人<input name="applicant" maxlength="20" required autocomplete="name"></label>
    <label>设备名称<input name="device_label" maxlength="40" required placeholder="例如：张三的办公电脑"></label>
    <label>申请事由<textarea name="reason" maxlength="200"></textarea></label>
    <button type="submit">提交申请</button>
  </form>
</main>
<script>
(() => {{
  if ({'true' if status == 'pending' else 'false'} !== true) return;
  const node = document.getElementById('accessStatus');
  const poll = async () => {{
    try {{
      const response = await fetch('/api/device-access/status', {{credentials:'same-origin',cache:'no-store'}});
      const data = await response.json();
      if (data.status === 'approved') {{ node.textContent = '设备已批准，正在进入系统。'; location.replace('/'); return; }}
      if (data.status === 'rejected') {{ node.textContent = '申请未获批准，请联系管理员。'; return; }}
      setTimeout(poll, 3000);
    }} catch (_) {{ setTimeout(poll, 5000); }}
  }};
  setTimeout(poll, 1200);
}})();
</script>
</body>
</html>"""
