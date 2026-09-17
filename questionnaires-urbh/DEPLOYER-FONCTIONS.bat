@echo off
REM ============================================================
REM  Deploiement des FONCTIONS SERVEUR (SMS automatiques).
REM  A lancer uniquement apres :
REM    1. passage du projet au plan Blaze (console Firebase) ;
REM    2. cle Brevo enregistree une fois avec :
REM         firebase functions:secrets:set BREVO_API_KEY
REM  Les pages et les regles se deploient toujours avec DEPLOYER.bat.
REM ============================================================

cd /d "%~dp0"

where firebase >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] L'outil "firebase" n'est pas installe : npm install -g firebase-tools
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] npm introuvable : installez Node.js (nodejs.org, version LTS).
  pause
  exit /b 1
)

echo.
echo === Deploiement des fonctions serveur (SMS) ===
echo     Prerequis : plan Blaze actif + cle BREVO_API_KEY enregistree.
echo.
pause

echo --- Installation des dependances (premiere fois : ~1 minute) ---
cd functions
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ECHEC] npm install a echoue - verifiez la connexion internet.
  cd ..
  pause
  exit /b 1
)
cd ..

call firebase deploy --only functions --project questionnaires-urbh

if errorlevel 1 (
  echo.
  echo [ECHEC] Le deploiement des fonctions a echoue.
  echo         Plan Blaze non actif ? Cle BREVO_API_KEY absente ?
  echo         Enregistrez-la avec : firebase functions:secrets:set BREVO_API_KEY
) else (
  echo.
  echo [OK] Fonctions deployees : le SMS automatique de desistement est actif.
)

echo.
pause
