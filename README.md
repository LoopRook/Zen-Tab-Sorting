# Zen Tab Sorting

Zen Tab Sorting is a rules-first, hybrid, or full-AI tab organizer for Zen Browser and Sine.
It is based on [Zen Tab Wand](https://github.com/flantig/Zen-Tab-Wand) and keeps the parts that made that project better than NeuroSort: a native wand button, editable domain rules, skip domains, backup and restore, tab context-menu rule growth, local AI, Ollama, Plan Mode, and persistent collapsed groups.

This fork adds the pieces NeuroSort did better: explicit provider choice, privacy gates before remote AI, a validation and test harness, release metadata checks, and comparison evidence so the older NeuroSort implementation does not keep hidden advantages.

## What Makes This Fork Different

- **Rule-first workflow stays primary.** Domains and skip domains handle the repeatable work. AI is an optional second pass.
- **Local by default.** The built-in Firefox ML engine and Ollama stay on your machine.
- **Remote providers are explicit.** OpenAI-compatible, Gemini, and custom endpoints are available only when selected and consented to.
- **Safety harness.** Manifest, preferences, syntax, provider, and security validators are part of `npm run check`.
- **Sine identity is forked.** The public mod id is `zen-tab-sorting`; repository links point to `LoopRook/Zen-Tab-Sorting`.

## Installing

In Zen Browser, open Sine and add this repository:

```text
LoopRook/Zen-Tab-Sorting
```

After install, a wand button appears in the workspace separator. Left-click sorts the current workspace. Right-click tabs to add their hostname to a rule or skip list.

## How Sorting Works

1. **Domain rules first.** You define groups in settings, such as `Dev` matching `github.com` and `stackoverflow.com`.
2. **Skip domains.** Matching tabs are ejected from groups and parked at the top.
3. **Optional AI fallback.** Local, Ollama, OpenAI-compatible, Gemini, or custom provider modes can classify what rules missed.
4. **Plan Mode.** For AI-created groups, you can preview the plan before applying.

## Provider Modes

| Engine | Network behavior | Setup |
| --- | --- | --- |
| Off | No AI request | None |
| Local | On-device Firefox ML | None |
| Ollama | Local daemon, default `http://localhost:11434` | Install Ollama and pull a model |
| OpenAI-compatible | Sends tab metadata to configured `/v1/chat/completions` endpoint | Endpoint, API key, model, consent |
| Gemini | Sends tab metadata to Google generateContent endpoint | API key, model, consent |
| Custom | Sends tab metadata to configured OpenAI or Ollama-shaped endpoint | Endpoint, optional key, model, format, consent |

Remote provider consent is separate from provider selection. Zen Tab Sorting should not send tab titles, URLs, or snippets to remote endpoints unless consent and required config are present.

## Settings

- **Group Rules**: editable group name, color, and domain list.
- **Skip Domains**: hosts that should stay visible and ungrouped.
- **Backup & Restore**: export/import rules and skip domains as JSON.
- **Look & Feel**: minimal style and strict rule enforcement.
- **AI Sorting**: local, Ollama, and remote provider controls.
- **Sorting mode**: rules-first, hybrid, or full AI.
- **Remote Provider Settings**: OpenAI-compatible, Gemini, and custom endpoint fields.

## Development

Install dependencies:

```sh
npm install
```

Run the full gate:

```sh
npm run check
```

Run the isolated Zen Browser E2E gate:

```sh
npm run e2e:zen -- --tabs 300
```

The E2E runner creates a disposable Zen profile, copies the installed Sine engine from an existing Zen profile, installs the local checkout into that lab profile, and drives the real Sine-loaded organize handler through Marionette. It does not operate on your main Zen profile. Pass `--sine-profile <path>` if auto-detection cannot find a profile with Sine installed.

By default the runner uses a deterministic local fake OpenAI-compatible provider. To test a real OpenRouter-compatible provider and write a redacted semantic quality report:

```sh
OPENROUTER_API_KEY=... npm run e2e:zen -- --provider real --scenario full-ai --tabs 120 --quality-artifact .omo/ulw-loop/evidence/real-full-ai-quality.json
```

In real-provider mode, Zen still talks only to a local forwarding proxy with a dummy key. The proxy reads `OPENROUTER_API_KEY`, defaults to `https://openrouter.ai/api/v1` and `google/gemini-3.5-flash`, and records only redacted call metadata plus label-agnostic grouping quality metrics.

Useful focused checks:

```sh
npm test -- tests/provider-readiness.test.mjs tests/provider-requests.test.mjs tests/security.test.mjs
node scripts/validate-manifest.mjs
node scripts/validate-preferences.mjs
node scripts/compare-neurosort-advantages.mjs
```

## Relationship To Zen Tab Wand

Zen Tab Sorting preserves the MIT-licensed Zen Tab Wand product base and credits its original author. The `extensions.zen-auto-organize.*` preference prefix is intentionally retained for compatibility with existing rules and settings.

## Relationship To NeuroSort

NeuroSort proved out a stronger engineering harness and provider model, but its Zen chrome integration was thinner and more fragile. This fork uses Zen Tab Wand's product surface as the base and ports NeuroSort's useful engineering advantages into it.

## License

MIT. Original Zen Tab Wand copyright remains in `LICENSE`.
