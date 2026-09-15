// Compression des photos avant envoi : partagée entre l'état des lieux
// (côté gérant) et les photos contradictoires (côté colocataire).

/** Réduit une photo (canvas) : au plus 1400 px de large, JPEG qualité 0,82. */
export async function compresserPhoto(fichier) {
  const image = await createImageBitmap(fichier);
  const echelle = Math.min(1, 1400 / Math.max(image.width, image.height));
  const canevas = document.createElement('canvas');
  canevas.width = Math.round(image.width * echelle);
  canevas.height = Math.round(image.height * echelle);
  canevas.getContext('2d').drawImage(image, 0, 0, canevas.width, canevas.height);
  image.close?.();
  return new Promise((resoudre) => { canevas.toBlob(resoudre, 'image/jpeg', 0.82); });
}
