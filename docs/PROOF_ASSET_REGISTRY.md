# Proof Asset Registry

Proof files are production data, not source code. Keep PDFs, screenshots, and other client proof files outside Git and point the agent at them with `PROOF_ASSET_ROOT`.

Recommended Contabo layout:

```text
/opt/upwork-agent/shared/proof-assets/
  profile/
    attachments/
      truly-beauty-case-study.pdf
      fly-boutique-case-study.pdf
      design-case-studies-steve-logarn.pdf
    screenshots/
      dr-rachael-klaviyo-performance.png
```

Set this in production:

```bash
PROOF_ASSET_ROOT=/opt/upwork-agent/shared/proof-assets
```

The committed manifest remains `profile/portfolio-assets.json`. Paths in that file stay relative to the proof asset root, for example `profile/attachments/fly-boutique-case-study.pdf`.

Each proof asset entry is treated as:

- `file`: a local PDF/image that can only be attached when it exists under `PROOF_ASSET_ROOT` and the manifest marks it safe.
- `mention_only`: proof that may be referenced in draft copy but must not be attached.
- `upwork_portfolio`: existing Upwork profile/portfolio proof that must be selected on the apply page before it can be claimed.
- `certificate`: existing Upwork certificate proof that must be selected on the apply page before it can be claimed.

Current page behavior:

- If Upwork shows existing selectable profile highlights, the agent may check them and only reports success when checked labels verify.
- If Upwork only shows `Add portfolio project` or `Add certificate`, the agent reports proof unavailable on page.
- The agent must not say proof was selected unless a page selection verified.
- The agent must not say files were attached unless uploaded filenames verify on the page.

Audit commands:

```bash
npm run proof:check
npm run assets:check
npm run proof:check -- --json
npm run proof:check -- --paths
```

The default audit reports available local files, missing files, mention-only proof, portfolio/certificate setup required, and files that should not be attached automatically. It does not print absolute local paths unless `--paths` is passed.
