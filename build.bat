@echo off
rem Build seguro; o monolito raiz permanece intacto.
setlocal
cd /d "%~dp0"

node --version >nul 2>&1 || goto :error
node scripts\build.mjs %* || goto :error
set /a test_files=0
for /r test %%F in (*.test.mjs) do (
    set /a test_files+=1
    echo [build] test %%F
    node --test "%%F" || goto :error
)
for /r scripts %%F in (*.test.mjs) do (
    set /a test_files+=1
    echo [build] test %%F
    node --test "%%F" || goto :error
)
if %test_files% EQU 0 goto :error
node --check dist\tec_fabrica_cadernos.user.js || goto :error

rem Clipboard e best-effort: nunca invalida nem remove um build valido.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path (Get-Location) 'dist\tec_fabrica_cadernos.user.js'; try { Set-Clipboard -Value (Get-Content -LiteralPath $p -Raw -Encoding UTF8); Write-Host '[build] clipboard OK' } catch { Write-Warning ('[build] clipboard falhou: ' + $_.Exception.Message); exit 2 }"
if errorlevel 2 echo AVISO: build valido preservado, mas o clipboard falhou.
echo BUILD OK: dist\tec_fabrica_cadernos.user.js
exit /b 0

:error
echo.
echo BUILD FALHOU - veja as mensagens acima.
exit /b 1
