# Skill: Create React Application

## Description
This skill provides instructions for scaffolding and building a modern React web application. Use this when the user asks for a complex web app, a React app, or a Next.js/Vite project.

## Execution Steps

1. **Scaffold the App:**
   Instead of manually creating files, use the `native_shell` tool to bootstrap the project using Vite.
   - Command: `npx -y create-vite@latest . --template react-ts`
   - This command will initialize a React TypeScript project in the current directory.

2. **Install Dependencies:**
   - Command: `npm install`
   - If the user needs specific libraries (like `framer-motion` for animations, or `react-router-dom` for routing), install them via `npm install <package-name>`.

3. **Modify the Default Template:**
   Once Vite finishes scaffolding, use your dedicated file tools to build the app:
   - Use `read_file` to inspect `src/App.tsx` and `src/index.css`.
   - Use `write_file` to completely overwrite `src/App.tsx` with your custom, premium design.
   - Use `patch_file` to make surgical adjustments to configuration files if needed.

4. **Component Architecture:**
   - Use the `make_directory` tool to create a `src/components` folder.
   - Write reusable components inside this folder using the `write_file` tool.
   - Use modern React patterns: Functional components, Hooks (useState, useEffect).

5. **Verification & Dev Server:**
   - Use the `native_shell` tool to run `npm run dev` in the background (set `background: true`).
   - The user will now be able to see the live app on localhost.

## Rules
- Always use Vite for modern React scaffolding unless specified otherwise.
- Never use `echo` to write React code. Use `write_file`.
- Write clean, strongly typed TypeScript code.
