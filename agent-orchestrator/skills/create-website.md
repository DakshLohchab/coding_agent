# Skill: Create Vanilla Website

## Description
This skill provides the exact steps for creating a standard, modern vanilla HTML/CSS/JS website. 
Use this skill when the user asks to "build a website", "create a landing page", or "make a simple web app".

## Execution Steps

1. **Scaffold Directory Structure:**
   Use the `make_directory` tool to create the core directories:
   - `public`
   - `src`
   - `src/css`
   - `src/js`

2. **Create Core Files:**
   Use the `write_file` tool to create the base files.

   **index.html**:
   Create a modern, semantic HTML5 structure. Include a responsive viewport meta tag. Link to the CSS and JS files.
   
   **src/css/style.css**:
   Implement modern styling. Prioritize:
   - CSS Variables for color theming
   - Flexbox and Grid for layout
   - A clean, modern font family (e.g., system-ui, Inter, Roboto)
   - Smooth transitions for hover effects

   **src/js/main.js**:
   Add interactivity. Ensure DOM elements are loaded before attaching event listeners (e.g., using `DOMContentLoaded`).

3. **Verification:**
   Use the `native_shell` tool to verify the structure:
   - Run `dir` or `ls` to ensure the files were created successfully.
   - If requested by the user, you can start a simple static file server (e.g., `npx serve .` or `python -m http.server`) in the background.

## Rules
- Never use a raw shell command (`echo "..." > file`) to write multi-line code. ALWAYS use the `write_file` tool.
- Always implement responsive design (use media queries).
- Do not output placeholders. Provide fully working code.
