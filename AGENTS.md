# Relaykit-proto – Cursor rules

# TOP PRIORITY: GIT (NON-NEGOTIABLE)
- **NEVER run `git commit` or `git push`.** Not even when asked to "get this into prod" or when a commit seems like the obvious next step. Stage changes at most; the user always commits and pushes themselves.

# TOP PRIORITY: RESPONSE LENGTH (NON-NEGOTIABLE)
- Keep responses very short by default: 1-4 sentences.
- Use as few sentences as possible unless explicitly asked to go into detail. Terse fragments > full sentences.
- Do not restate the question.
- Prefer direct yes/no + one-line reason when possible.
- For implementation updates, use at most 3 bullets.
- If you violate this, correct immediately in the next message with a shorter answer.
- NEVER write report/essay-style answers: no multi-section headers, no numbered "here's how it all works" walls of text, even for analysis/assessment/"how does this work" questions. Give the answer + the fix in a few lines. Lead with the conclusion; add detail only if asked.
- **Plans:** Keep plans short too. A plan is a checklist of what to do and where, not an architecture document. No "why not X" sections, no data model definitions, no mermaid diagrams unless asked. Max ~30 lines.
- Assume the user is an expert. Skip explanations of concepts they didn't ask about.

- Answer concisely. No pointless markdown docs, no braindead AI essays. Talk like a normal human.
- Prefer short answers and small edits unless the user explicitly asks for more.
- Do not make changes unrelated to the user’s request: no “fixing” style, capitalization, naming, or structure unless the user asked for it. Only edit what is exactly needed for the task.
- Stack: Vite/React frontend, Node + tRPC backend, Dokploy. Presets under `app/presets/`.
- **Package manager: Yarn.** Use `yarn` / `yarn add` in repo roots (e.g. `app/frontend`); do not use `npm install` or create `package-lock.json`.
- Do not run lint/typecheck after every small edit. Run validation only when requested, before commit, or when needed to verify a risky/substantial change.
- Edit existing code over adding files. One shared reverse proxy for the stack, not per-container.
- Style: define functions as const arrow, e.g. `const fn = async (x: T) => { ... }` not `async function fn(x: T) { ... }`.
- Use maintainable UI styling: use Mantine variants/theme overrides/component props first, and avoid repeated inline style objects unless truly one-off.
- **UI copy:** Lowercase for user-visible labels and status (buttons, badges, tooltips).
- Do not plan for failure: build features that work. No conditionals or fallback UIs for "when X fails". If something cannot be made to work, say so and we will change direction.
- **Surface errors, never cover them up.** When something breaks, find and fix the root cause. Do NOT add `onError` fallbacks, try/catch that swallows, default/placeholder values, retries, or graceful-degradation UI to hide a failure. Masking a bug is worse than the bug — let it fail loudly so it's visible and fixable. If you can't determine the cause, say so and ask for the concrete error (logs, network status, stack trace) rather than guessing or papering over it.
- Put shared constants, enums, and config values in `app/backend/src/constants.ts` rather than scattering them in trpc or other modules.
- Production runtime requires Playwright + Chromium for setup automation. Do not remove browser runtime dependencies from the prod image during optimizations.
