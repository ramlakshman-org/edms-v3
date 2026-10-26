@echo off
REM Seed local MongoDB (mongodb://127.0.0.1:27017) with assemblies, users, telecallers, leads, and CRM threads
cd /d "%~dp0\..\backend"
node scripts\seed-local-db.mjs
pause
