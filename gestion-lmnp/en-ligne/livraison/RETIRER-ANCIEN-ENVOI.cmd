@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Retrait de l'ancienne fonction d'envoi des e-mails (envoiMail, europe-west9) ===
echo.
echo Depuis la v42, c'est la fonction expedierCourriel de cette livraison qui expedie les
echo e-mails. Tant que l'ancienne fonction envoiMail existe, chaque courriel peut partir
echo en double. A lancer UNE SEULE FOIS, apres avoir verifie que l'e-mail de test
echo (Parametres ^> Envoi des e-mails) arrive bien.
echo.
echo Le terminal demande confirmation avant la suppression.
pause
call firebase functions:delete envoiMail --region europe-west9 --project gestion-lmnp-anika --account andynguyen34@gmail.com
echo.
echo Si le message indique que la fonction n'existe pas, c'est deja fait : rien d'autre a faire.
pause
