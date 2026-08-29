'use strict';

const multer = require('multer');
const config = require('./config');

// Rien ne touche le disque : la photo transite en memoire puis part en base.
const SIGNATURES = [
  {
    mime: 'image/jpeg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPhotoBytes, files: 1, fields: 25 },
});

// Middleware tolerant : une erreur multer (fichier trop lourd, formulaire
// malforme) devient un message affichable plutot qu'une 500.
function single(field) {
  const run = parser.single(field);
  return (req, res, next) => {
    run(req, res, (err) => {
      if (!err) return next();
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? 'La photo dépasse ' + Math.round(config.maxPhotoBytes / (1024 * 1024)) + ' Mo.'
        : "La photo n'a pas pu être lue.";
      req.file = undefined;
      next();
    });
  };
}

// On ne se fie pas au type declare par le navigateur : on relit la signature
// des premiers octets du fichier.
function accept(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const kind = SIGNATURES.find((signature) => signature.test(buffer));
  if (!kind) return null;
  return { buffer, mime: kind.mime, size: buffer.length };
}

module.exports = { single, accept };
