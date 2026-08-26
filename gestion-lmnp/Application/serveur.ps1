<#
    Gestion LMNP — serveur local
    ----------------------------
    Sert l'application et lit/écrit les fichiers du dossier partagé OneDrive.
    N'écoute que sur 127.0.0.1 : rien n'est exposé sur le réseau.
    Aucune installation, aucun droit administrateur.
#>

param(
    [int]$Port = 0,
    [switch]$SansNavigateur
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$VERSION  = '1.0.0'
$MARQUEUR = 'gestion-lmnp'

$dossierApplication = $PSScriptRoot
$dossierRacine      = Split-Path -Parent $dossierApplication
$dossierDonnees     = Join-Path $dossierRacine 'Données'
$dossierDocuments   = Join-Path $dossierRacine 'Documents'
$dossierFactures    = Join-Path $dossierRacine 'Factures'
$dossierTraitees    = Join-Path $dossierFactures 'Traitées'
$dossierSauvegardes = Join-Path $dossierRacine 'Sauvegardes'
$dossierCorbeille   = Join-Path $dossierRacine 'Corbeille'

$espaces = @{ 'documents' = $dossierDocuments; 'factures' = $dossierFactures }
$encodageUtf8 = New-Object System.Text.UTF8Encoding($false)
$script:SEPARATEUR_CHEMIN = [System.IO.Path]::DirectorySeparatorChar

foreach ($d in @($dossierDonnees, $dossierDocuments, $dossierFactures, $dossierTraitees, $dossierSauvegardes)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Mode d'emploi déposé dans le dossier Factures pour qui l'ouvre depuis l'explorateur.
$lisezMoiFactures = Join-Path $dossierFactures 'LISEZ-MOI.txt'
if (-not (Test-Path -LiteralPath $lisezMoiFactures)) {
    $texteLisezMoi = @"
Déposez ici les factures et justificatifs de dépense (PDF, photo, scan).

L'application les détecte au démarrage et propose de les intégrer en
comptabilité. Une fois intégrées, elles sont rangées automatiquement dans
le sous-dossier « Traitées » par année.

Pour que la lecture automatique fonctionne au mieux, nommez le fichier
ainsi :

    2026-03-15 EDF 84,20.pdf
    2026-02-01 Taxe fonciere 1250.pdf
    2026-04-22 Leroy Merlin 137,90 robinetterie.pdf

soit : date, fournisseur, montant. Ce n'est pas obligatoire : vous pourrez
toujours compléter à la main.
"@
    [System.IO.File]::WriteAllText($lisezMoiFactures, $texteLisezMoi, $encodageUtf8)
}

$TAILLE_MAX_ENVOI = 60MB

# --------------------------------------------------------------------------
# Utilitaires
# --------------------------------------------------------------------------

function ConvertTo-JsonChaine([string]$valeur) {
    if ($null -eq $valeur) { return 'null' }
    $s = $valeur -replace '\\', '\\'
    $s = $s -replace '"', '\"'
    $s = $s -replace "`r", '\r'
    $s = $s -replace "`n", '\n'
    $s = $s -replace "`t", '\t'
    return '"' + $s + '"'
}

function Get-Empreinte([byte[]]$octets) {
    if ($null -eq $octets) { return '' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $condense = $sha.ComputeHash($octets)
        $hexa = ($condense | ForEach-Object { $_.ToString('x2') }) -join ''
        return $hexa.Substring(0, 16)
    } finally { $sha.Dispose() }
}

function Resoudre-Chemin([string]$base, [string]$relatif) {
    if ([string]::IsNullOrWhiteSpace($relatif)) { return $null }
    if ($relatif -match '[:\*\?"<>\|]') { return $null }
    $net = $relatif.Replace('/', $script:SEPARATEUR_CHEMIN).Replace('\', $script:SEPARATEUR_CHEMIN).TrimStart($script:SEPARATEUR_CHEMIN)
    if ([string]::IsNullOrWhiteSpace($net)) { return $null }
    try {
        $complet = [System.IO.Path]::GetFullPath((Join-Path $base $net))
    } catch { return $null }
    $baseComplet = [System.IO.Path]::GetFullPath($base)
    if (-not $baseComplet.EndsWith($script:SEPARATEUR_CHEMIN)) { $baseComplet += $script:SEPARATEUR_CHEMIN }
    if (-not $complet.StartsWith($baseComplet, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $complet
}

function Get-TypeMime([string]$chemin) {
    switch ([System.IO.Path]::GetExtension($chemin).ToLower()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.js'   { 'text/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.svg'  { 'image/svg+xml' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.gif'  { 'image/gif' }
        '.webp' { 'image/webp' }
        '.pdf'  { 'application/pdf' }
        '.txt'  { 'text/plain; charset=utf-8' }
        '.csv'  { 'text/csv; charset=utf-8' }
        '.ico'  { 'image/x-icon' }
        default { 'application/octet-stream' }
    }
}

function Get-LibelleStatut([int]$code) {
    switch ($code) {
        200 { 'OK' } 201 { 'Created' } 204 { 'No Content' }
        400 { 'Bad Request' } 403 { 'Forbidden' } 404 { 'Not Found' }
        405 { 'Method Not Allowed' } 409 { 'Conflict' }
        413 { 'Payload Too Large' } 500 { 'Internal Server Error' }
        default { 'OK' }
    }
}

function Nouvelle-Reponse([int]$code, [string]$type, $corps) {
    $octets = $null
    if ($corps -is [byte[]]) { $octets = $corps }
    elseif ($null -ne $corps) { $octets = $encodageUtf8.GetBytes([string]$corps) }
    else { $octets = New-Object byte[] 0 }
    return @{ Code = $code; Type = $type; Corps = $octets }
}

function Nouvelle-ReponseJson([int]$code, [string]$json) {
    return Nouvelle-Reponse $code 'application/json; charset=utf-8' $json
}

function Nouvelle-ReponseErreur([int]$code, [string]$message) {
    return Nouvelle-ReponseJson $code ('{"erreur":' + (ConvertTo-JsonChaine $message) + '}')
}

# --------------------------------------------------------------------------
# Écriture des données : sauvegarde du jour puis remplacement atomique
# --------------------------------------------------------------------------

function Archiver-Version([string]$chemin) {
    if (-not (Test-Path -LiteralPath $chemin)) { return }
    $jour = Get-Date -Format 'yyyy-MM-dd'
    $dossierJour = Join-Path $dossierSauvegardes $jour
    if (-not (Test-Path -LiteralPath $dossierJour)) { New-Item -ItemType Directory -Path $dossierJour -Force | Out-Null }
    $cible = Join-Path $dossierJour ([System.IO.Path]::GetFileName($chemin))
    if (-not (Test-Path -LiteralPath $cible)) { Copy-Item -LiteralPath $chemin -Destination $cible -Force }
}

function Purger-Sauvegardes {
    $limite = (Get-Date).AddDays(-180)
    Get-ChildItem -LiteralPath $dossierSauvegardes -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' -and $_.CreationTime -lt $limite } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

function Ecrire-Atomique([string]$chemin, [byte[]]$octets) {
    $temporaire = "$chemin.tmp"
    [System.IO.File]::WriteAllBytes($temporaire, $octets)
    if (Test-Path -LiteralPath $chemin) {
        Remove-Item -LiteralPath $chemin -Force
    }
    Move-Item -LiteralPath $temporaire -Destination $chemin -Force
}

# --------------------------------------------------------------------------
# Points d'entrée de l'API
# --------------------------------------------------------------------------

function Api-Etat {
    $inattendus = @()
    $connus = @('parametres.json','biens.json','locataires.json','baux.json','loyers.json',
                'charges.json','immobilisations.json','emprunts.json','exercices.json')
    Get-ChildItem -LiteralPath $dossierDonnees -Filter '*.json' -File -ErrorAction SilentlyContinue |
        ForEach-Object { if ($connus -notcontains $_.Name) { $inattendus += $_.Name } }

    $morceaux = @()
    $morceaux += '"marqueur":' + (ConvertTo-JsonChaine $MARQUEUR)
    $morceaux += '"version":'  + (ConvertTo-JsonChaine $VERSION)
    $morceaux += '"dossier":'  + (ConvertTo-JsonChaine $dossierRacine)
    $morceaux += '"dossierFactures":' + (ConvertTo-JsonChaine $dossierFactures)
    $morceaux += '"poste":'    + (ConvertTo-JsonChaine $env:COMPUTERNAME)
    $morceaux += '"utilisateur":' + (ConvertTo-JsonChaine $env:USERNAME)
    $listeInattendus = ($inattendus | ForEach-Object { ConvertTo-JsonChaine $_ }) -join ','
    $morceaux += '"fichiersInattendus":[' + $listeInattendus + ']'
    return Nouvelle-ReponseJson 200 ('{' + ($morceaux -join ',') + '}')
}

function Api-LireDonnees([string]$nom) {
    if ($nom -notmatch '^[a-z0-9\-]+$') { return Nouvelle-ReponseErreur 400 'Nom de collection invalide.' }
    $chemin = Join-Path $dossierDonnees "$nom.json"
    if (-not (Test-Path -LiteralPath $chemin)) {
        return Nouvelle-ReponseJson 200 '{"version":"","contenu":null}'
    }
    $octets = [System.IO.File]::ReadAllBytes($chemin)
    $texte = $encodageUtf8.GetString($octets).TrimStart([char]0xFEFF)
    if ([string]::IsNullOrWhiteSpace($texte)) { $texte = 'null' }
    $version = Get-Empreinte $octets
    return Nouvelle-ReponseJson 200 ('{"version":' + (ConvertTo-JsonChaine $version) + ',"contenu":' + $texte + '}')
}

function Api-EcrireDonnees([string]$nom, [string]$versionAttendue, [byte[]]$corps) {
    if ($nom -notmatch '^[a-z0-9\-]+$') { return Nouvelle-ReponseErreur 400 'Nom de collection invalide.' }
    if ($null -eq $corps -or $corps.Length -eq 0) { return Nouvelle-ReponseErreur 400 'Contenu vide.' }
    $chemin = Join-Path $dossierDonnees "$nom.json"

    if (Test-Path -LiteralPath $chemin) {
        $actuels = [System.IO.File]::ReadAllBytes($chemin)
        $versionActuelle = Get-Empreinte $actuels
        if ($versionAttendue -ne $versionActuelle) {
            $texte = $encodageUtf8.GetString($actuels).TrimStart([char]0xFEFF)
            if ([string]::IsNullOrWhiteSpace($texte)) { $texte = 'null' }
            return Nouvelle-ReponseJson 409 ('{"erreur":"conflit","version":' + (ConvertTo-JsonChaine $versionActuelle) + ',"contenu":' + $texte + '}')
        }
        Archiver-Version $chemin
    }
    Ecrire-Atomique $chemin $corps
    return Nouvelle-ReponseJson 200 ('{"version":' + (ConvertTo-JsonChaine (Get-Empreinte $corps)) + '}')
}

function Resoudre-Espace([string]$nom) {
    if ([string]::IsNullOrWhiteSpace($nom)) { return $dossierDocuments }
    $cle = $nom.ToLower()
    if ($espaces.ContainsKey($cle)) { return $espaces[$cle] }
    return $null
}

function Api-ListerFichiers([string]$espace) {
    if ([string]::IsNullOrWhiteSpace($espace)) { $espace = 'documents' } else { $espace = $espace.ToLower() }
    $base = Resoudre-Espace $espace
    if (-not $base) { return Nouvelle-ReponseErreur 400 'Espace de fichiers inconnu.' }
    $elements = @()
    if (Test-Path -LiteralPath $base) {
        $prefixe = [System.IO.Path]::GetFullPath($base)
        if (-not $prefixe.EndsWith($script:SEPARATEUR_CHEMIN)) { $prefixe += $script:SEPARATEUR_CHEMIN }
        Get-ChildItem -LiteralPath $base -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notlike '~$*' -and $_.Name -ne 'LISEZ-MOI.txt' -and $_.Extension -ne '.tmp' } |
            Sort-Object FullName |
            ForEach-Object {
                $relatif = $_.FullName.Substring($prefixe.Length).Replace($script:SEPARATEUR_CHEMIN, '/')
                $elements += '{"espace":' + (ConvertTo-JsonChaine $espace.ToLower()) +
                             ',"chemin":' + (ConvertTo-JsonChaine $relatif) +
                             ',"nom":' + (ConvertTo-JsonChaine $_.Name) +
                             ',"taille":' + $_.Length +
                             ',"modifie":' + (ConvertTo-JsonChaine $_.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')) + '}'
            }
    }
    return Nouvelle-ReponseJson 200 ('{"elements":[' + ($elements -join ',') + ']}')
}

function Nom-Disponible([string]$complet) {
    if (-not (Test-Path -LiteralPath $complet)) { return $complet }
    $dossier = [System.IO.Path]::GetDirectoryName($complet)
    $sansExtension = [System.IO.Path]::GetFileNameWithoutExtension($complet)
    $extension = [System.IO.Path]::GetExtension($complet)
    for ($indice = 1; $indice -le 200; $indice++) {
        $essai = Join-Path $dossier ("$sansExtension ($indice)$extension")
        if (-not (Test-Path -LiteralPath $essai)) { return $essai }
    }
    return $null
}

function Chemin-Relatif([string]$base, [string]$complet) {
    $prefixe = [System.IO.Path]::GetFullPath($base)
    if (-not $prefixe.EndsWith($script:SEPARATEUR_CHEMIN)) { $prefixe += $script:SEPARATEUR_CHEMIN }
    return $complet.Substring($prefixe.Length).Replace($script:SEPARATEUR_CHEMIN, '/')
}

function Api-DeposerFichier([string]$espace, [string]$chemin, [byte[]]$corps) {
    if ([string]::IsNullOrWhiteSpace($espace)) { $espace = 'documents' } else { $espace = $espace.ToLower() }
    $base = Resoudre-Espace $espace
    if (-not $base) { return Nouvelle-ReponseErreur 400 'Espace de fichiers inconnu.' }
    if ($null -eq $corps -or $corps.Length -eq 0) { return Nouvelle-ReponseErreur 400 'Fichier vide.' }
    if ($corps.Length -gt $TAILLE_MAX_ENVOI) { return Nouvelle-ReponseErreur 413 'Fichier trop volumineux (60 Mo maximum).' }
    $complet = Resoudre-Chemin $base $chemin
    if (-not $complet) { return Nouvelle-ReponseErreur 400 'Chemin de fichier invalide.' }

    $dossier = [System.IO.Path]::GetDirectoryName($complet)
    if (-not (Test-Path -LiteralPath $dossier)) { New-Item -ItemType Directory -Path $dossier -Force | Out-Null }
    $complet = Nom-Disponible $complet
    if (-not $complet) { return Nouvelle-ReponseErreur 400 'Trop de fichiers de même nom.' }
    [System.IO.File]::WriteAllBytes($complet, $corps)

    return Nouvelle-ReponseJson 200 ('{"espace":' + (ConvertTo-JsonChaine $espace.ToLower()) +
        ',"chemin":' + (ConvertTo-JsonChaine (Chemin-Relatif $base $complet)) + '}')
}

function Api-DeplacerFichier($parametres) {
    $base = Resoudre-Espace ([string]$parametres['espace'])
    $baseCible = Resoudre-Espace ([string]$parametres['espaceCible'])
    if (-not $base -or -not $baseCible) { return Nouvelle-ReponseErreur 400 'Espace de fichiers inconnu.' }
    $source = Resoudre-Chemin $base ([string]$parametres['chemin'])
    $cible = Resoudre-Chemin $baseCible ([string]$parametres['cible'])
    if (-not $source -or -not (Test-Path -LiteralPath $source -PathType Leaf)) {
        return Nouvelle-ReponseErreur 404 'Fichier introuvable.'
    }
    if (-not $cible) { return Nouvelle-ReponseErreur 400 'Destination invalide.' }

    $dossier = [System.IO.Path]::GetDirectoryName($cible)
    if (-not (Test-Path -LiteralPath $dossier)) { New-Item -ItemType Directory -Path $dossier -Force | Out-Null }
    $cible = Nom-Disponible $cible
    if (-not $cible) { return Nouvelle-ReponseErreur 400 'Trop de fichiers de même nom.' }
    Move-Item -LiteralPath $source -Destination $cible -Force

    return Nouvelle-ReponseJson 200 ('{"espace":' + (ConvertTo-JsonChaine ([string]$parametres['espaceCible']).ToLower()) +
        ',"chemin":' + (ConvertTo-JsonChaine (Chemin-Relatif $baseCible $cible)) + '}')
}

function Api-SupprimerFichier([string]$espace, [string]$chemin) {
    $base = Resoudre-Espace $espace
    if (-not $base) { return Nouvelle-ReponseErreur 400 'Espace de fichiers inconnu.' }
    $complet = Resoudre-Chemin $base $chemin
    if (-not $complet -or -not (Test-Path -LiteralPath $complet)) { return Nouvelle-ReponseErreur 404 'Fichier introuvable.' }
    if (-not (Test-Path -LiteralPath $dossierCorbeille)) { New-Item -ItemType Directory -Path $dossierCorbeille -Force | Out-Null }
    $cible = Join-Path $dossierCorbeille ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [System.IO.Path]::GetFileName($complet))
    Move-Item -LiteralPath $complet -Destination $cible -Force
    return Nouvelle-ReponseJson 200 '{"ok":true}'
}

function Servir-Fichier([string]$base, [string]$relatif, [string]$disposition) {
    $complet = Resoudre-Chemin $base $relatif
    if (-not $complet -or -not (Test-Path -LiteralPath $complet -PathType Leaf)) {
        return Nouvelle-ReponseErreur 404 'Fichier introuvable.'
    }
    $octets = [System.IO.File]::ReadAllBytes($complet)
    $reponse = Nouvelle-Reponse 200 (Get-TypeMime $complet) $octets
    if ($disposition) { $reponse.Entetes = @("Content-Disposition: $disposition") }
    return $reponse
}

# --------------------------------------------------------------------------
# Routage
# --------------------------------------------------------------------------

function Traiter-Requete([string]$methode, [string]$chemin, $parametres, [byte[]]$corps) {
    if ($chemin -eq '/' -or $chemin -eq '') { $chemin = '/index.html' }

    if ($chemin -eq '/api/etat' -and $methode -eq 'GET') { return Api-Etat }

    if ($chemin -eq '/api/arret' -and $methode -eq 'POST') {
        $script:continuer = $false
        return Nouvelle-ReponseJson 200 '{"ok":true}'
    }

    if ($chemin -like '/api/donnees/*') {
        $nom = $chemin.Substring('/api/donnees/'.Length)
        if ($methode -eq 'GET') { return Api-LireDonnees $nom }
        if ($methode -eq 'PUT') { return Api-EcrireDonnees $nom ([string]$parametres['version']) $corps }
        return Nouvelle-ReponseErreur 405 'Méthode non autorisée.'
    }

    if ($chemin -eq '/api/fichiers/deplacer' -and $methode -eq 'POST') {
        return Api-DeplacerFichier $parametres
    }

    if ($chemin -eq '/api/fichiers') {
        $espace = [string]$parametres['espace']
        if ($methode -eq 'GET')    { return Api-ListerFichiers $espace }
        if ($methode -eq 'POST')   { return Api-DeposerFichier $espace ([string]$parametres['chemin']) $corps }
        if ($methode -eq 'DELETE') { return Api-SupprimerFichier $espace ([string]$parametres['chemin']) }
        return Nouvelle-ReponseErreur 405 'Méthode non autorisée.'
    }

    if ($chemin -like '/fichier/*' -and $methode -eq 'GET') {
        $reste = $chemin.Substring('/fichier/'.Length)
        $position = $reste.IndexOf('/')
        if ($position -lt 1) { return Nouvelle-ReponseErreur 400 'Chemin de fichier invalide.' }
        $base = Resoudre-Espace $reste.Substring(0, $position)
        if (-not $base) { return Nouvelle-ReponseErreur 404 'Espace de fichiers inconnu.' }
        return Servir-Fichier $base $reste.Substring($position + 1) 'inline'
    }

    if ($methode -ne 'GET') { return Nouvelle-ReponseErreur 405 'Méthode non autorisée.' }
    return Servir-Fichier $dossierApplication $chemin.TrimStart('/') $null
}

# --------------------------------------------------------------------------
# Lecture d'une requête HTTP
# --------------------------------------------------------------------------

# Attend que des données arrivent, sans bloquer indéfiniment : renvoie $false si
# le client n'a rien envoyé dans le délai imparti.
function Attendre-Donnees($client, $flux, [int]$limiteMs) {
    $chrono = [System.Diagnostics.Stopwatch]::StartNew()
    while ($chrono.ElapsedMilliseconds -lt $limiteMs) {
        if ($flux.DataAvailable) { return $true }
        try {
            if ($client.Client.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead)) { return $true }
        } catch { return $true }
        Start-Sleep -Milliseconds 5
    }
    return $false
}

function Lire-Requete($client, $flux) {
    $tampon = New-Object System.Collections.Generic.List[byte]
    $bloc = New-Object byte[] 16384
    $finEntete = -1
    $dejaExamine = 3

    while ($finEntete -lt 0) {
        if (-not (Attendre-Donnees $client $flux 3000)) { return $null }
        $lu = $flux.Read($bloc, 0, $bloc.Length)
        if ($lu -le 0) { return $null }
        $morceau = New-Object byte[] $lu
        [Array]::Copy($bloc, 0, $morceau, 0, $lu)
        $tampon.AddRange($morceau)
        if ($tampon.Count -gt 131072) { return $null }
        for ($i = $dejaExamine; $i -lt $tampon.Count; $i++) {
            if ($tampon[$i] -eq 10 -and $tampon[$i-1] -eq 13 -and $tampon[$i-2] -eq 10 -and $tampon[$i-3] -eq 13) {
                $finEntete = $i; break
            }
        }
        $dejaExamine = [Math]::Max(3, $tampon.Count - 3)
    }

    $tableau = $tampon.ToArray()
    $texteEntete = [System.Text.Encoding]::ASCII.GetString($tableau, 0, $finEntete - 3)
    $lignes = $texteEntete -split "`r`n"
    $premiere = $lignes[0] -split ' '
    if ($premiere.Count -lt 2) { return $null }

    $entetes = @{}
    for ($i = 1; $i -lt $lignes.Count; $i++) {
        $sep = $lignes[$i].IndexOf(':')
        if ($sep -gt 0) {
            $entetes[$lignes[$i].Substring(0, $sep).Trim().ToLower()] = $lignes[$i].Substring($sep + 1).Trim()
        }
    }

    $longueur = 0
    if ($entetes.ContainsKey('content-length')) { [void][int]::TryParse($entetes['content-length'], [ref]$longueur) }
    if ($longueur -gt $TAILLE_MAX_ENVOI) { return @{ Trop = $true } }

    $flot = New-Object System.IO.MemoryStream
    $restant = $tableau.Length - ($finEntete + 1)
    if ($restant -gt 0) { $flot.Write($tableau, $finEntete + 1, $restant) }
    while ($flot.Length -lt $longueur) {
        if (-not (Attendre-Donnees $client $flux 30000)) { break }
        $aLire = [int][Math]::Min([long]$bloc.Length, [long]$longueur - $flot.Length)
        $lu = $flux.Read($bloc, 0, $aLire)
        if ($lu -le 0) { break }
        $flot.Write($bloc, 0, $lu)
    }

    $cible = $premiere[1]
    $parametres = @{}
    $cheminSeul = $cible
    $interrogation = $cible.IndexOf('?')
    if ($interrogation -ge 0) {
        $cheminSeul = $cible.Substring(0, $interrogation)
        foreach ($couple in $cible.Substring($interrogation + 1) -split '&') {
            if (-not $couple) { continue }
            $egal = $couple.IndexOf('=')
            if ($egal -ge 0) {
                $cle = [System.Uri]::UnescapeDataString($couple.Substring(0, $egal))
                $parametres[$cle] = [System.Uri]::UnescapeDataString($couple.Substring($egal + 1).Replace('+', ' '))
            }
        }
    }

    return @{
        Methode    = $premiere[0].ToUpper()
        Chemin     = [System.Uri]::UnescapeDataString($cheminSeul)
        Parametres = $parametres
        Corps      = $flot.ToArray()
    }
}

function Envoyer-Reponse($flux, $reponse) {
    $corps = $reponse.Corps
    if ($null -eq $corps) { $corps = New-Object byte[] 0 }
    $entete = "HTTP/1.1 $($reponse.Code) $(Get-LibelleStatut $reponse.Code)`r`n"
    $entete += "Content-Type: $($reponse.Type)`r`n"
    $entete += "Content-Length: $($corps.Length)`r`n"
    $entete += "Cache-Control: no-store`r`n"
    $entete += "X-Content-Type-Options: nosniff`r`n"
    if ($reponse.Entetes) { foreach ($e in $reponse.Entetes) { $entete += "$e`r`n" } }
    $entete += "Connection: close`r`n`r`n"
    $octetsEntete = [System.Text.Encoding]::ASCII.GetBytes($entete)
    $flux.Write($octetsEntete, 0, $octetsEntete.Length)
    if ($corps.Length -gt 0) { $flux.Write($corps, 0, $corps.Length) }
    $flux.Flush()
}

# --------------------------------------------------------------------------
# Démarrage
# --------------------------------------------------------------------------

function Tester-InstanceExistante([int]$port) {
    try {
        $reponse = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/etat" -TimeoutSec 2 -UseBasicParsing
        return ($reponse.Content -like "*$MARQUEUR*")
    } catch { return $false }
}

function Ouvrir-Navigateur([string]$url) {
    $candidats = @(
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($c in $candidats) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            Start-Process -FilePath $c -ArgumentList "--app=$url" | Out-Null
            return
        }
    }
    Start-Process $url | Out-Null
}

$portsCandidats = if ($Port -gt 0) { @($Port) } else { 8787..8796 }
$ecouteur = $null
$portRetenu = 0

foreach ($p in $portsCandidats) {
    try {
        $essai = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $essai.Start()
        $ecouteur = $essai
        $portRetenu = $p
        break
    } catch {
        if (Tester-InstanceExistante $p) {
            Write-Host "Gestion LMNP tourne déjà sur le port $p — ouverture de la fenêtre."
            if (-not $SansNavigateur) { Ouvrir-Navigateur "http://127.0.0.1:$p/" }
            exit 0
        }
    }
}

if (-not $ecouteur) {
    Write-Host ''
    Write-Host "Impossible de démarrer : aucun port libre entre 8787 et 8796." -ForegroundColor Red
    Write-Host 'Fermez les autres applications puis réessayez.'
    Read-Host 'Appuyez sur Entrée pour fermer'
    exit 1
}

Purger-Sauvegardes

$adresse = "http://127.0.0.1:$portRetenu/"
$hote = $Host.UI.RawUI
try { $hote.WindowTitle = 'Gestion LMNP — serveur (ne pas fermer pendant l''utilisation)' } catch { }

Write-Host ''
Write-Host '  Gestion LMNP' -ForegroundColor Cyan
Write-Host '  ------------'
Write-Host "  Dossier   : $dossierRacine"
Write-Host "  Adresse   : $adresse"
Write-Host ''
Write-Host '  L''application s''ouvre dans votre navigateur.'
Write-Host '  Laissez cette fenêtre ouverte tant que vous utilisez l''application.'
Write-Host '  Pour quitter : bouton « Quitter » dans l''application, ou fermez cette fenêtre.'
Write-Host ''

if (-not $SansNavigateur) { Ouvrir-Navigateur $adresse }

# Boucle d'événements : les connexions acceptées sont mises en attente et ne sont
# traitées qu'une fois qu'elles ont envoyé quelque chose. Sans cela, une connexion
# ouverte à l'avance par le navigateur — Edge et Chrome en ouvrent systématiquement —
# bloquerait tout le serveur jusqu'à expiration du délai de lecture.

$script:continuer = $true
$enAttente = New-Object System.Collections.Generic.List[object]
$DELAI_CONNEXION_INACTIVE = 30

function Traiter-Client($client) {
    try {
        $flux = $client.GetStream()
        $requete = Lire-Requete $client $flux
        if ($null -eq $requete) { return }
        if ($requete.Trop) {
            Envoyer-Reponse $flux (Nouvelle-ReponseErreur 413 'Envoi trop volumineux (60 Mo maximum).')
            return
        }
        try {
            $reponse = Traiter-Requete $requete.Methode $requete.Chemin $requete.Parametres $requete.Corps
        } catch {
            Write-Host "  Erreur sur $($requete.Chemin) : $($_.Exception.Message)" -ForegroundColor Yellow
            $reponse = Nouvelle-ReponseErreur 500 $_.Exception.Message
        }
        Envoyer-Reponse $flux $reponse
    } catch {
        # connexion interrompue par le navigateur : sans conséquence
    }
}

while ($script:continuer) {
    $activite = $false

    while ($ecouteur.Pending()) {
        $nouveau = $ecouteur.AcceptTcpClient()
        $nouveau.ReceiveTimeout = 15000
        $nouveau.SendTimeout = 60000
        $enAttente.Add([PSCustomObject]@{ Client = $nouveau; Depuis = [DateTime]::UtcNow })
        $activite = $true
    }

    for ($i = $enAttente.Count - 1; $i -ge 0; $i--) {
        $entree = $enAttente[$i]
        $pret = $false
        try {
            $pret = $entree.Client.Client.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead)
        } catch {
            $pret = $true
        }
        $expire = ([DateTime]::UtcNow - $entree.Depuis).TotalSeconds -gt $DELAI_CONNEXION_INACTIVE
        if (-not $pret -and -not $expire) { continue }

        $enAttente.RemoveAt($i)
        $activite = $true
        if ($pret) { Traiter-Client $entree.Client }
        try { $entree.Client.Close() } catch { }
    }

    if (-not $activite) { Start-Sleep -Milliseconds 5 }
}

foreach ($entree in $enAttente) { try { $entree.Client.Close() } catch { } }

$ecouteur.Stop()
Write-Host '  Application fermée. À bientôt.' -ForegroundColor Cyan
Start-Sleep -Milliseconds 800
