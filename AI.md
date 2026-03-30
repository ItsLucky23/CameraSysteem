# AI Assistant Guide

Welcome! When working on this project, this is your entry point. This repository is a socket-first React 19 full-stack framework using raw Node.js + Socket.io (no Express) with file-based routing.

To maintain a clean codebase and avoid wasting context tokens on unnecessary details, **you must strictly follow these instructions before and during your tasks**.

## 1. High-Priority Strict Rules

- **NEVER use Emojis**: Do not use emojis in code, comments, UI text, or conversational responses.
- **Always Ask if Unclear**: If a request is ambiguous, stop and ask the user questions to clarify. Provide multiple-choice options for easier answering whenever possible.
- **i18n is Mandatory**: NEVER hardcode text strings in the UI. You **must** use the `useTranslator` hook for all text.
  ```tsx
  import { useTranslator } from "src/_functions/translator";
  const translate = useTranslator();
  {
    translate({ key: "your.key.here" });
  }
  ```
- **Error Handling is Mandatory**: NEVER use raw `try/catch` blocks. You **must** always use our custom `tryCatch` wrapper for all async operations.
  ```typescript
  // Client usage:
  import tryCatch from "src/_functions/helper";
  // Server usage:
  import { tryCatch } from "server/functions/helper";
  // Usage: const [error, result] = await tryCatch(myAsyncFunc());
  ```
- **Terminal Commands**: NEVER run terminal commands that mutate state or update code (like file creation scripts or servers) without first asking the user for permission and explaining exactly what the command does. Running commands strictly to retrieve data or check status is fine. Check exceptions below.
- **Code Quality & ESLint**: The codebase uses ESLint with strict plugins. You MUST ask the user to run `npm run lint` and resolve ALL errors and warnings. Do not ignore them.
- **SOLID Principles**: Adhere strictly to SOLID principles in all code you write (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion). Each function/file should do one thing, and logic should be modular.

## 2. Components & Styling Rules

Detailed UI logic, color tokens, and styling guidelines live in the **`.claude/`** folder (e.g., `.claude/CLAUDE.md` and `.claude/DESIGN.md`).
**When doing ANY UI or styling work, you MUST read `.claude/DESIGN.md` before writing code.**

- **Tailwind Only**: Use TailwindCSS for all styling. Rely strictly on the custom colors defined in `src/index.css`.
- **Component Priority**: Always check if a custom component exists in `src/_components/` before using native HTML elements.
  - _Example:_ **NEVER** use `<select>`; you must use `<Dropdown />` instead.
  - We have custom inputs, dialogs, dropdowns, menus, and layout containers. Use them.

## 3. Documentation & Context Gathering

Do not guess architecture or assume things from other frameworks. If you need deep knowledge of the backend, routing, APIs, or auth, looking blindly will waste time. Instead, **you MUST read the relevant markdown file inside the `docs/` folder before writing code**.

- **Need to know how API works?** Read `docs/ARCHITECTURE_API.md`
- **Need to know how Routing works?** Read `docs/ARCHITECTURE_ROUTING.md`
- **Working with sockets/sync?** Read `docs/ARCHITECTURE_SOCKET.md` & `docs/ARCHITECTURE_SYNC.md`

### ⚠️ RULE: Updating Documentation

The AI (you) are responsible for keeping our documentation up to date as the project grows.

- **When modifying core files or variables**: If you add, remove, or change the name of design tokens in `index.css`, OR if you change global constants, types, or routing paths that are mapped/documented in `.claude/` or `docs/`, you MUST update the corresponding markdown file to ensure terminology and mappings stay perfectly in sync. Do not let documentation rot.
- **When adding new reusable UI components (like a custom input or button)**: You MUST update the styling/component guidelines in the `.claude/` folder to document its purpose, props, and design rules so future AI sessions will know about it.
- **When creating fundamentally new architecture or full pages**: Advise the user if a specific architectural file in `docs/` needs updating, or proactively update it to reflect the new state of the project.

## 4. Architectural Context via Config Files

When you need to understand the shape of the app's environment, ports, integrations, or session rules, you **MUST** read `.env` and `config.ts` (or their templates `.env_template` / `.env.local_template` / `configTemplate.txt`).

- **`.env`**: Contains safe architecture context (IPs, Ports, flags, mock keys) designed for you to read. Think of this as the AI-readable template. Placeholder values such as `ID_IN_ENV_LOCAL` and `SECRET_IN_ENV_LOCAL` are intentional.
- **`.env.local`**: Contains the **actual** production/secret keys. It is `.gitignored`. The Node `dotenv` server handles merging these files automatically (`.env.local` overrides `.env`). **NEVER read or request to read `.env.local`**, as it contains actual sensitive secrets.
- **Updating Configs**: If you update `config.ts` or `.env`, you **MUST** also update `configTemplate.txt`, `.env_template`, and `.env.local_template` when relevant. Furthermore, if you add a new variable to `.env`, you **MUST** explicitly tell the user to add it to their `.env.local` as well, since the local environment is the main true source that overrides it.

## 5. Proactive Suggestions (Your Role as an Engineer)

You are an active participant in this project, not just a code-monkey. When working on features:

- **Suggest Reusable Components**: If you notice a UI pattern repeating, suggest abstracting it into a global component in `src/_components/`.
- **Suggest Design Token Updates**: If you feel like a specific use-case justifies a new color variable in `src/index.css` (for example, a new status color not currently in the palette), propose adding it globally rather than hardcoding.
- **REPL Commands for Testing**: When creating new backend features or making major changes to the system (like Redis integration), suggest or add new commands to our REPL instance to improve our ability to test, debug, and gain insight into the state of the app.
- **No Random/Arbitrary Files**: Do not start creating random test files, `todo.md` lists, scratchpads, or similar arbitrary files. Only create documentation or code files explicitly required by the user, or ask for permission first explaining why it would be beneficial.
- **Post-Task Summary**: After each task/prompt, you MUST summarize what you did and why. Provide clear instructions on how the user can test the changes themselves, state whether a server restart is needed, and provide any other useful operational info.
- **Next Steps**: Always provide suggestions on what the user should do next, whether it's testing a flow, refactoring a related piece of code, or updating docs.
