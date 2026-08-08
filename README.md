# Zen Tab Sorting

A tab organizer for [Zen Browser](https://zen-browser.app), installed through the [Sine](https://github.com/CosmoCreeper/Sine) mod loader. You define domain rules, click the wand button in the workspace separator, and your open tabs drop into groups. An AI pass is available for whatever the rules don't cover, and it stays off until you turn it on.

## Installing

In Zen, open Sine and add this repository:

```text
LoopRook/Zen-Tab-Sorting
```

There's one setting to change first. Sine only runs a mod's JavaScript if the mod came from its official store, unless you enable "Enable installing JS from unofficial sources" in Sine's settings. Without it this mod's stylesheet loads but none of its behavior does, so you get no wand button and no settings editors. Turn it on, restart Zen, then install.

Don't run this alongside Zen Tab Wand or OpenTabSort Zen. All three share the same toolbar button, command, and preference keys, so two of them installed at once will fight over the same DOM.

After installing, a wand button appears in the workspace separator. Left-click sorts the current workspace. Right-click any tab to add its hostname to a rule or to the skip list.

## How sorting works

1. Domain rules run first. You define groups in settings, say a `Dev` group matching `github.com` and `stackoverflow.com`, and every open tab whose hostname matches lands in that group.
2. Skip domains are pulled out. Anything matching the skip list gets ejected from its group and parked at the top of the workspace, on every click.
3. The AI pass handles the rest, if you've enabled one. It can file leftover tabs into existing groups or invent new ones.

Three sorting modes control how much work the AI does. Rules first shows it only what the rules missed, hybrid does the same but re-runs on every click, and full AI ignores your rules and re-clusters everything.

When the AI creates new groups you can have it save them as rules, create them once without saving, open Zen's rename dialog for each, or preview the whole plan first and pick what to keep.

## AI engines

| Engine | Where the data goes | What you need |
| --- | --- | --- |
| None | No request | Nothing |
| Local | Firefox's built-in model, on your machine | Nothing |
| Ollama | A local daemon, `http://localhost:11434` by default | Ollama installed and a model pulled |
| OpenAI-compatible | Your configured `/v1/chat/completions` endpoint | Endpoint, API key, model, consent |
| Gemini | Google's generateContent endpoint | API key, model, consent |
| Custom | Any OpenAI- or Ollama-shaped endpoint | Endpoint, model, format, consent |

The three remote engines send tab titles, URLs and optional page snippets to whichever service you point them at. That only happens after you tick the consent checkbox, which is separate from picking the engine and off by default. Until it's ticked, the remote code paths refuse to make a request. With Local and Ollama nothing leaves your machine, so neither asks for consent.

There's a Test connection button under Remote Provider Settings. It runs one small request through the same checks a real sort uses and reports back what happened, so a wrong key or model shows you the actual error instead of a sort that quietly does nothing.

Gemini model names are forgiving: `gemini-2.5-flash`, `models/gemini-2.5-flash` and `Gemini 2.5 Flash` all work, and stray whitespace around keys and endpoints is trimmed.

## Settings

Group Rules holds the group name, color and domain list for each rule, and you can drag rows to reorder them. Skip Domains lists the hosts the wand should leave alone. Backup & Restore exports or imports both lists as JSON.

Look & Feel covers minimal styling, strict rule enforcement, and the collapsed-group marker options described below. AI Sorting has the engine, the consent checkbox, the sorting mode, and what happens when the AI matches or creates a group. Remote Provider Settings holds the endpoint, key and model fields for whichever remote engine you picked.

## What this fork changes

The visual side is reskinned after [Advanced Tab Groups](https://github.com/Vertex-Mods/Advanced-Tab-Groups). Groups get a colored accent bar down the side of their tabs and a tidier label row, all keyed to Zen's own theme variables so it follows your theme rather than fighting it.

Collapsed groups get a different treatment. Firefox paints a collapsed group's label as a filled colored chip, which reads as a heavy box in Zen's vertical sidebar, so this mod strips it back to a plain label with a small colored marker beside the name. You can set the marker to a circle or a rounded square, or turn it off entirely. Each shape keeps its own size, and you choose whether the marker shrinks, stays the same, or disappears when you open the group.

Two fixes carried over from Zen Tab Wand patch things Zen still gets wrong. Collapsing a group actually hides its tabs, which sounds obvious until you try it: Zen's vertical sidebar never shipped the CSS for it, so the chevron toggled a state that changed nothing ([#11134](https://github.com/zen-browser/desktop/issues/11134), [#11739](https://github.com/zen-browser/desktop/issues/11739)). Collapsed groups also stay collapsed across restarts, because Zen's session store drops that state and the mod saves the collapsed group names separately and reapplies them when groups are restored.

Right-clicking a group header gives you a Dissolve group option, which removes the group and leaves its tabs in place at the top of the workspace.

## Credits

This is based on [Zen Tab Wand](https://github.com/flantig/Zen-Tab-Wand) by flantig, by way of [OpenTabSort Zen](https://github.com/nggurbanov/OpenTabSort-Zen) by nggurbanov, which added the remote provider support and the test harness. Both are MIT licensed and their copyright stands.

Preferences are still stored under the `extensions.zen-auto-organize.*` prefix from the original, so rules and settings carry over if you're coming from either of those mods.

## Development

```sh
npm install
npm run check
```

`npm run check` runs the manifest, preferences and security validators, then the test suite. There's also an end-to-end runner that drives a real Sine-loaded Zen in a throwaway profile:

```sh
npm run e2e:zen -- --tabs 300
```

It builds its own profile, copies the Sine engine from an existing one, and never touches your main profile. By default it talks to a local fake provider rather than a real API.

## License

MIT. The original Zen Tab Wand copyright remains in `LICENSE`.
