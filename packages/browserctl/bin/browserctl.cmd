@echo off
setlocal
if not defined BROWSERCTL_NODE set "BROWSERCTL_NODE=node"
set "ELECTRON_RUN_AS_NODE=1"
"%BROWSERCTL_NODE%" "%~dp0..\src\index.js" %*
exit /b %errorlevel%
