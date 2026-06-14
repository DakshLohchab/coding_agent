# Skill: Modern Web Design & Aesthetics

## Description
This skill outlines the strict aesthetic guidelines that the agent MUST follow when creating web applications, ensuring high-quality, premium designs. Use this as a reference whenever generating CSS or component styles.

## Design Guidelines

1. **Vibrant & Premium Aesthetics:**
   - Avoid generic, plain colors (e.g., standard red, blue, green).
   - Use curated color palettes (e.g., deep dark modes, sleek pastel tones, rich gradients).
   - Recommended tools: HSL color space for dynamic shading, linear gradients for backgrounds or text highlights.

2. **Typography:**
   - Never use browser default fonts (Times New Roman, standard sans-serif).
   - Import modern Google Fonts automatically in the HTML or CSS:
     `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');`
   - Use appropriate line heights (1.5 - 1.6 for body) and varying font weights to establish visual hierarchy.

3. **Dynamic Interactivity & Micro-animations:**
   - An interface must feel alive. All buttons and interactive elements must have hover states.
   - Use CSS transitions for smooth state changes: `transition: all 0.3s ease;`
   - Add subtle entrance animations (e.g., fade-in, slide-up) for components mounting on the screen.

4. **Glassmorphism & Depth:**
   - Use subtle shadows to separate layers: `box-shadow: 0 10px 25px rgba(0,0,0,0.05);`
   - For premium cards or overlays, use glassmorphism:
     `background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2);`

5. **Completeness & No Placeholders:**
   - The design must be fully implemented.
   - Do not use generic placeholders like "Content goes here".
   - If an image is needed, use your image generation capabilities or use real-looking mock data (e.g., Unsplash source URLs or styled shapes).
