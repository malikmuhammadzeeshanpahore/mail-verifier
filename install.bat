@echo off

node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Node.js is not installed. Downloading Node.js 18 installer...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.17.1/node-v18.17.1-x64.msi' -OutFile 'nodejs_installer.msi'"
    echo Running Node.js installer... Please follow the setup prompts to install Node.js.
    start /wait nodejs_installer.msi
    del nodejs_installer.msi
    
    echo ==============================================
    echo Node.js installation finished!
    echo Please RESTART this install.bat file so the newly installed Node.js can be detected.
    echo ==============================================
    pause
    exit /b
)

echo Installing project dependencies...
call npm install --silent --no-audit --no-fund

pkg --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Installing pkg bundler...
    call npm install -g pkg
)

echo Building executables for Windows...
call npx pkg sender.js -t node18-win-x64 -o sender.exe
call npx pkg verifier.js -t node18-win-x64 -o verifier.exe

set DESKTOP=%USERPROFILE%\Desktop
set DATADIR=%DESKTOP%\verifier-data

echo Setting up Desktop files...
if not exist "%DATADIR%" mkdir "%DATADIR%"
move sender.exe "%DESKTOP%\sender.exe"
move verifier.exe "%DESKTOP%\verifier.exe"

copy config.json "%DATADIR%\" >nul 2>&1
copy subject.txt "%DATADIR%\" >nul 2>&1
copy template.txt "%DATADIR%\" >nul 2>&1

echo ==============================================
echo Installation Complete!
echo You can now run sender.exe and verifier.exe from your Desktop.
echo Your config and data files are located in Desktop\verifier-data.
echo ==============================================
pause
