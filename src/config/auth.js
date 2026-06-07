const crypto = require('crypto');
const path = require('path');

const tokenSecret = process.env.AUTH_TOKEN_SECRET || 'change-this-secret-in-env';
const tokenExpiresInSeconds = Number(process.env.AUTH_TOKEN_EXPIRES_IN_SECONDS || 60 * 60);


function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

  return `${salt}:${hash}`;
}

module.exports = {
  createPasswordHash,
  tokenExpiresInSeconds,
  tokenSecret,
  
};
