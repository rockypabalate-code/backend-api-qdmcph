const authService = require('../services/authService');

function normalizeText(value) {
  return String(value || '').trim();
}

async function login(req, res, next) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: 'Email and password are required.' });
  }

  try {
    const session = await authService.login(email, password);
    return res.json(session);
  } catch (error) {
    return next(error);
  }
}

async function createAccount(req, res, next) {
  const {
    firstName,
    middleName,
    lastName,
    name,
    email,
    password,
    role,
    status,
  } = req.body;

  const hasNameParts = normalizeText(firstName) && normalizeText(lastName);
  const hasFullName = normalizeText(name);

  if ((!hasNameParts && !hasFullName) || !email || !password) {
    return res
      .status(400)
      .json({ message: 'First name and last name or full name, email, and password are required.' });
  }

  try {
    const result = await authService.createAccount({
      firstName,
      middleName,
      lastName,
      name,
      email,
      password,
      role,
      status,
      createdBy: req.user,
    });

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

function me(req, res) {
  return res.json({ user: req.user });
}

module.exports = {
  createAccount,
  login,
  me,
  register: createAccount,
};
