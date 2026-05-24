@echo off

node -v >nul 2>&1
IF %ERRORLEVEL% EQU 0 GOTO :NODE_INSTALLED

echo Node.js is not installed. Downloading Node.js 18 installer...
powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.17.1/node-v18.17.1-x64.msi' -OutFile 'nodejs_installer.msi'"
echo Running Node.js silent installer... Please wait, this may take a minute.
start /wait msiexec /i nodejs_installer.msi /qn
del nodejs_installer.msi

echo Node.js installation finished!
set "PATH=%PATH%;C:\Program Files\nodejs"

:NODE_INSTALLED
echo Node.js is detected!
echo Installing project dependencies...
call npm install --silent --no-audit --no-fund

pkg --version >nul 2>&1
IF %ERRORLEVEL% EQU 0 GOTO :PKG_INSTALLED

echo Installing pkg bundler...
call npm install -g pkg

:PKG_INSTALLED
echo Building executables for Windows...
call pkg sender.js -t node18-win-x64 -o sender.exe
call pkg verifier.js -t node18-win-x64 -o verifier.exe

set DESKTOP=%USERPROFILE%\Desktop
set DATADIR=%DESKTOP%\verifier-data

echo Setting up Desktop files...
if not exist "%DATADIR%" mkdir "%DATADIR%"
move /y sender.exe "%DESKTOP%\sender.exe"
move /y verifier.exe "%DESKTOP%\verifier.exe"

copy config.json "%DATADIR%\" >nul 2>&1
copy subject.txt "%DATADIR%\" >nul 2>&1
copy template.txt "%DATADIR%\" >nul 2>&1

echo ==============================================
echo Installation Complete!
echo You can now run sender.exe and verifier.exe from your Desktop.
echo Your config and data files are located in Desktop\verifier-data.
echo ==============================================
pause
