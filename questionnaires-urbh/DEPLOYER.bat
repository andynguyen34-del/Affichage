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

set VERSION=inconnue
for /f "tokens=2 delims==; " %%v in ('findstr /c:"window.APP_BUILD" public\js\firebase-config.js') do set VERSION=%%v

echo.
echo === Deploiement Questionnaires URBH ===
echo     Dossier : %~dp0
echo     VERSION A DEPLOYER : v%VERSION%
echo     Cible   : projet questionnaires-urbh (hosting + regles Firestore)
echo.
echo     Si la version ci-dessus n'est pas la derniere livraison annoncee,
echo     fermez cette fenetre : vous etes dans un ANCIEN dossier extrait.
echo.
pause

call firebase deploy --only hosting,firestore --project questionnaires-urbh

if errorlevel 1 (
  echo.
  echo [ECHEC] Le deploiement a echoue - lisez le message ci-dessus.
  echo         Compte non connecte ?  Lancez :  firebase login
  echo         Autre erreur : envoyez une capture de ce message a Claude.
) else (
  echo.
  echo [OK] Deploiement termine : la v%VERSION% est en ligne.
  echo      Verification : ouvrez https://questionnaires-urbh.web.app/portail.html
  echo      faites Ctrl+F5 et controlez que le bas de page affiche v%VERSION%.
)

echo.
pause
