# Fabrique les icônes de l'application (PNG) sans bibliothèque graphique :
# carré arrondi vert, pictogramme maison blanc. Tailles : 512, 192, 180.
import zlib, struct, math, os

VERT = (0x1d, 0x6a, 0x5a)
BLANC = (255, 255, 255)

def png(largeur, hauteur, pixels):
    brut = b''.join(b'\x00' + bytes(sum((pixels[y][x] for x in range(largeur)), ())) for y in range(hauteur))
    def bloc(nom, donnees):
        return struct.pack('>I', len(donnees)) + nom + donnees + struct.pack('>I', zlib.crc32(nom + donnees) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + bloc(b'IHDR', struct.pack('>IIBBBBB', largeur, hauteur, 8, 6, 0, 0, 0))
            + bloc(b'IDAT', zlib.compress(brut, 9)) + bloc(b'IEND', b''))

def dessiner(taille):
    r = taille * 0.22  # rayon des coins
    cx = taille / 2
    pixels = []
    for y in range(taille):
        ligne = []
        for x in range(taille):
            px, py = x + 0.5, y + 0.5
            # carré arrondi
            dx = max(abs(px - cx) - (taille / 2 - r), 0)
            dy = max(abs(py - cx) - (taille / 2 - r), 0)
            dedans = math.hypot(dx, dy) <= r
            if not dedans:
                ligne.append((0, 0, 0, 0)); continue
            couleur = VERT
            # maison : toit (triangle) + corps (rectangle) + porte (rectangle vert)
            u, v = px / taille, py / taille
            toit = (0.30 <= v <= 0.52) and abs(u - 0.5) <= (v - 0.30) / 0.22 * 0.36
            corps = (0.52 <= v <= 0.78) and 0.22 <= u <= 0.78
            porte = (0.60 <= v <= 0.78) and 0.44 <= u <= 0.56
            cheminee = (0.30 <= v <= 0.44) and 0.62 <= u <= 0.70
            if (toit or corps or cheminee) and not porte:
                couleur = BLANC
            ligne.append(couleur + (255,))
        pixels.append(ligne)
    return png(taille, taille, pixels)

ici = os.path.dirname(os.path.abspath(__file__))
for taille in (512, 192, 180):
    with open(os.path.join(ici, 'icones', f'icone-{taille}.png'), 'wb') as f:
        f.write(dessiner(taille))
    print('icône', taille)
