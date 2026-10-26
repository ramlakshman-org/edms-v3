@echo off
cd /d "d:\Gemini Antigravity Testing Ground\EDM\frontend"
set EDM_API_TARGET=http://127.0.0.1:5054
npx vite --port 5173 --strictPort
