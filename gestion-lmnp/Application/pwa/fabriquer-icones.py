# Fabrique les icônes de l'application (PNG) sans bibliothèque graphique.
# - proprietaire : carré arrondi vert, maison blanche (« Gestion LMNP »)
# - colocataire  : carré arrondi bleu, deux silhouettes blanches (« Résidence ANIKA »)
# Tailles : 512, 192, 180.
import zlib, struct, math, os

BLANC = (255, 255, 255)

def png(largeur, hauteur, pixels):
    brut = b''.join(b'\x00' + bytes(sum((pixels[y][x] for x in range(largeur)), ())) for y in range(hauteur))
    def bloc(nom, donnees):
        return struct.pack('>I', len(donnees)) + nom + donnees + struct.pack('>I', zlib.crc32(nom + donnees) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + bloc(b'IHDR', struct.pack('>IIBBBBB', largeur, hauteur, 8, 6, 0, 0, 0))
            + bloc(b'IDAT', zlib.compress(brut, 9)) + bloc(b'IEND', b''))

def maison(u, v):
    toit = (0.30 <= v <= 0.52) and abs(u - 0.5) <= (v - 0.30) / 0.22 * 0.36
    corps = (0.52 <= v <= 0.78) and 0.22 <= u <= 0.78
    porte = (0.60 <= v <= 0.78) and 0.44 <= u <= 0.56
    cheminee = (0.30 <= v <= 0.44) and 0.62 <= u <= 0.70
    return (toit or corps or cheminee) and not porte

def personnes(u, v):
    # deux silhouettes côte à côte : tête (disque) + buste (demi-ellipse), séparées par un jour
    def silhouette(cx, echelle):
        tete = math.hypot(u - cx, v - 0.37) <= 0.075 * echelle
        buste = (v >= 0.49) and (((u - cx) / (0.135 * echelle)) ** 2 + ((v - 0.49) / (0.27 * echelle)) ** 2 <= 1) and v <= 0.74
        return tete or buste
    return silhouette(0.355, 1.0) or silhouette(0.645, 1.0)

def dessiner(taille, fond, motif):
    r = taille * 0.22
    cx = taille / 2
    pixels = []
    for y in range(taille):
        ligne = []
        for x in range(taille):
            px, py = x + 0.5, y + 0.5
            dx = max(abs(px - cx) - (taille / 2 - r), 0)
            dy = max(abs(py - cx) - (taille / 2 - r), 0)
            if math.hypot(dx, dy) > r:
                ligne.append((0, 0, 0, 0)); continue
            ligne.append((BLANC if motif(px / taille, py / taille) else fond) + (255,))
        pixels.append(ligne)
    return png(taille, taille, pixels)

ici = os.path.dirname(os.path.abspath(__file__))
for prefixe, fond, motif in (('icone', (0x1d, 0x6a, 0x5a), maison), ('icone-colocataire', (0x2f, 0x5f, 0xa8), personnes)):
    for taille in (512, 192, 180):
        with open(os.path.join(ici, 'icones', f'{prefixe}-{taille}.png'), 'wb') as f:
            f.write(dessiner(taille, fond, motif))
        print(prefixe, taille)
