@echo off
rem browserctl Windows wrapper - forward args and exit code to CLI entry
node "%~dp0..\src\index.js" %*
exit /b %errorlevel%
