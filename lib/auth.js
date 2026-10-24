const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.ADMIN_SESSION_SECRET || 'manajemen-tugas-secret-key-32-chars-long';
const COOKIE_NAME = 'session_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 hari
  path: '/',
};

async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
}

async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Sesi tidak ditemukan atau telah kedaluwarsa. Silakan masuk kembali.',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Sesi tidak valid. Silakan masuk kembali.',
    });
  }
}

function ownerOnlyMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'Owner') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Akses ditolak. Fitur ini hanya dapat diakses oleh peran Owner.',
    });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  hashPassword,
  comparePassword,
  generateToken,
  authMiddleware,
  ownerOnlyMiddleware,
};
