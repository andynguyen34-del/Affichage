@echo off
rem Lanceur de l'application Gestion LMNP - double-cliquez sur ce fichier.
title Gestion LMNP
cd /d "%~dp0"

if not exist "%~dp0Application\serveur.ps1" (
  echo.
  echo Fichier Application\serveur.ps1 introuvable.
  echo Le dossier Application doit se trouver a cote de ce lanceur.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Application\serveur.ps1" %*
if errorlevel 1 (
  echo.
  echo Le demarrage a echoue. Notez le message ci-dessus.
  pause
)
