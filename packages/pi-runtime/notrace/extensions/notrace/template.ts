export const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<style>
  :root {
    --bg: #0c0b0a;
    --panel: rgba(255,255,255,0.04);
    --panel-strong: rgba(255,255,255,0.06);
    --text: #ece3da;
    --muted: rgba(236,227,218,0.68);
    --accent: #d88462;
    --accent-soft: rgba(216,132,98,0.12);
    --border: rgba(255,255,255,0.08);
    --code: #090807;
    --err: #ef7f7f;
  }
  * { box-sizing: border-box; }
  html { color-scheme: dark; }
  body {
    margin: 0;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    background-image: radial-gradient(circle at 50% -10%, rgba(216,132,98,0.14), transparent 45%);
    background-attachment: fixed;
  }
  .container { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; }

  /* Header */
  .hero {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 24px;
    padding: 28px;
    margin-bottom: 24px;
    backdrop-filter: blur(10px);
  }
  .hero h1 { margin: 0 0 8px; font-size: 1.6rem; }
  .hero .subtitle { color: var(--muted); font-size: 0.9rem; }

  /* Stats */
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 16px; margin: 24px 0; }
  .metric-card {
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 18px;
  }
  .metric-card small { display: block; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; font-weight: 700; }
  .metric-card strong { display: block; margin-top: 8px; font-size: clamp(1rem, 2vw, 1.55rem); }

  /* Sections */
  .section {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 18px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  .section-type {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .type-user { color: #8ec5ff; background: rgba(142,197,255,0.1); border: 1px solid rgba(142,197,255,0.22); }
  .type-assistant { color: var(--accent); background: var(--accent-soft); border: 1px solid rgba(216,132,98,0.24); }
  .type-tool { color: #b9b4ae; background: rgba(185,180,174,0.12); border: 1px solid rgba(185,180,174,0.2); }
  .type-header { color: var(--muted); background: rgba(255,255,255,0.03); border: 1px solid var(--border); }
  .type-compaction { color: #f3be8a; background: rgba(243,190,138,0.12); border: 1px solid rgba(243,190,138,0.26); }
  .type-branch { color: #a78bfa; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.24); }
  .section-time { color: var(--muted); font-size: 0.82rem; white-space: nowrap; }
  .section-body {
    padding: 16px 20px;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 0.84rem;
    line-height: 1.6;
    max-height: 600px;
    overflow-y: auto;
  }

  /* Footer */
  .footer {
    margin-top: 22px;
    text-align: center;
    color: var(--muted);
    font-size: 0.82rem;
  }

  @media (max-width: 600px) {
    .container { padding: 16px 12px 40px; }
    .hero { padding: 20px; }
    .metrics { grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); }
  }
</style>
</head>
<body>
<div class="container">
  <div class="hero">
    <h1>{{title}}</h1>
    <div class="subtitle">{{subtitle}}</div>
  </div>

  <div class="metrics">
    {{stats}}
  </div>

  {{sections}}

  <div class="footer">{{footer}}</div>
</div>
</body>
</html>`;
