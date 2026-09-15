@echo off
REM ============================================================
REM  Deploiement de l'application Questionnaires URBH (Firebase)
REM  Double-cliquez sur ce fichier : il se place dans le bon
REM  dossier, verifie l'outillage puis deploie hosting + regles.
REM ============================================================

cd /d "%~dp0"

where firebase >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERREUR] L'outil "firebase" n'est pas installe sur ce poste.
  echo          Installez-le une fois avec :  npm install -g firebase-tools
  echo          puis connectez-vous avec  :  firebase login
  echo.
  pause
  exit /b 1
)

echo.
echo === Deploiement Questionnaires URBH ===
echo     Dossier : %~dp0
echo     Cible   : projet questionnaires-urbh (hosting + regles Firestore)
echo.

call firebase deploy --only hosting,firestore --project questionnaires-urbh

if errorlevel 1 (
  echo.
  echo [ECHEC] Le deploiement a echoue - lisez le message ci-dessus.
  echo         Compte non connecte ?  Lancez :  firebase login
  echo         Autre erreur : envoyez une capture de ce message a Claude.
) else (
  echo.
  echo [OK] Deploiement termine.
  echo      Verification : ouvrez https://questionnaires-urbh.web.app/portail.html
  echo      faites Ctrl+F5 et controlez le numero de version en bas de page.
)

echo.
pause
