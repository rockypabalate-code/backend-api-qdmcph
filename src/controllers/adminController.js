function dashboard(req, res) {
  return res.json({
    message: 'Welcome to the admin dashboard.',
    user: req.user,
  });
}

module.exports = {
  dashboard,
};
