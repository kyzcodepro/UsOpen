'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');

// Les photos vivent hors de public/ : elles ne sont jamais servies en statique,
// uniquement par une route qui verifie l'acces.
const UPLOAD_DIR = path.join(config.dataDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 5 * 1024 * 1024;

// On ne se fie pas au type declare par le navigateur : on relit la signature
// des premiers octets du fichier.
const SIGNATURES = [
  {
    mime: 'image/jpeg',
    ext: '.jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: '.png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: '.webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 25 },
});

// Middleware tolerant : une erreur multer (fichier trop lourd, formulaire
// malforme) devient un message affichable plutot qu'une 500.
function single(field) {
  const run = parser.single(field);
  return (req, res, next) => {
    run(req, res, (err) => {
      if (!err) return next();
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? 'La photo dépasse ' + Math.round(MAX_BYTES / (1024 * 1024)) + ' Mo.'
        : "La photo n'a pas pu être lue.";
      req.file = undefined;
      next();
    });
  };
}

function detect(buffer) {
  if (!buffer || buffer.length < 12) return null;
  return SIGNATURES.find((signature) => signature.test(buffer)) || null;
}

// Ecrit le fichier sous un nom que nous choisissons : le nom d'origine, choisi
// par l'uploadeur, ne touche jamais le disque.
function save(buffer) {
  const kind = detect(buffer);
  if (!kind) return null;
  const file = crypto.randomUUID() + kind.ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buffer);
  return { file, mime: kind.mime, size: buffer.length };
}

function resolve(photo) {
  if (!photo || typeof photo.file !== 'string') return null;
  const full = path.join(UPLOAD_DIR, path.basename(photo.file));
  return fs.existsSync(full) ? full : null;
}

function remove(photo) {
  const full = resolve(photo);
  if (full) fs.rmSync(full, { force: true });
}

module.exports = { single, save, resolve, remove, MAX_BYTES, UPLOAD_DIR };
