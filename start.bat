@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   ==========================================
echo      Trends World - 全球每日热榜
echo   ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [x] 没有找到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)

rem 没有数据快照就先抓一次（有的话直接起服务，秒开）
if not exist "public\data\meta.json" (
  echo   还没有数据快照，开始抓取 176 个国家/地区...
  echo   预计 3-6 分钟，需要能访问 Google（会自动读取系统代理）
  echo.
  node tools\crawl.mjs --jobs=4
  if errorlevel 1 (
    echo.
    echo   [x] 抓取失败，请检查网络或代理后重试
    pause
    exit /b 1
  )
  echo.
)

echo   启动本地预览: http://127.0.0.1:4173
echo   (线上版本由 GitHub Actions 定时抓取并部署到 Cloudflare Pages)
echo.

node server\index.mjs %*

echo.
echo   服务已停止。
pause
