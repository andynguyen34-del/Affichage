@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Deploiement LMNP vers gestion-lmnp-anika ===
echo.

echo [1/3] Controle des fichiers de la livraison
set MANQUE=0
for %%F in ("firebase.json" ".firebaserc" "firestore.rules" "storage.rules" "public\index.html" "public\manifest.webmanifest" "public\manifest-colocataire.webmanifest" "public\sw.js" "public\icones\icone-192.png" "public\icones\icone-colocataire-192.png" "functions-appel-loyer\index.js" "functions-appel-loyer\relais-fichiers.js" "functions-appel-loyer\signature-distante.js" "functions-appel-loyer\package.json" "functions-appel-loyer\lib\appel-loyer.js" "functions-appel-loyer\lib\contradictoire.js") do (
  if not exist "%%~F" (echo   MANQUANT %%~F & set MANQUE=1)
)
if "%MANQUE%"=="1" (
  echo.
  echo Des fichiers manquent : ouvrez Securite Windows ^> Historique de protection ^(quarantaine^), ou re-extrayez le zip.
  echo Deploiement annule.
  pause
  exit /b 1
)
echo   Tous les fichiers sont presents.
echo.

echo [2/3] Bibliotheques de la fonction
if exist "functions-appel-loyer\node_modules\firebase-functions\package.json" (
  echo   Deja installees, rien a faire.
) else (
  echo   Installation ^(une seule fois par dossier, 1 a 2 minutes^)...
  pushd functions-appel-loyer
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    popd
    echo.
    echo ECHEC de npm install : verifiez que Node.js est installe et que le reseau autorise registry.npmjs.org.
    echo Deploiement annule.
    pause
    exit /b 1
  )
  popd
  echo   Bibliotheques installees.
)
echo.

echo [3/3] Deploiement ^(hebergement, regles, fonctions^)
call firebase deploy --project gestion-lmnp-anika --account andynguyen34@gmail.com
echo.
echo Termine. Verifiez la ligne "Deploy complete!" ci-dessus.
pause
