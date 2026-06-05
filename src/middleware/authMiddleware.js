const authService = require('../services/authService');

function authenticate(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Authentication token is required.' });
  }

  const user = authService.verifyToken(token);

  if (!user) {
    return res.status(401).json({ message: 'Invalid or expired authentication token.' });
  }

  req.user = user.toJSON();
  return next();
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource.' });
    }

    return next();
  };
}

module.exports = {
  authenticate,
  authorize,
};
