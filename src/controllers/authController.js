const authService = require('../services/authService');

function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const session = authService.login(email, password);

  if (!session) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  if (session.error === 'invalid_credentials') {
    return res.status(401).json({ message: session.message });
  }

  if (session.error === 'pending_employee_verification') {
    return res.status(403).json({ message: session.message });
  }

  return res.json(session);
}

function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required.' });
  }

  const session = authService.register({ name, email, password });

  if (!session) {
    return res.status(409).json({ message: 'Email is already registered.' });
  }

  return res.status(201).json(session);
}

function me(req, res) {
  return res.json({ user: req.user });
}

module.exports = {
  login,
  me,
  register,
};
